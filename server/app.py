"""Local audio library and fly-curated playlists for Dr. Stun."""

from __future__ import annotations

import asyncio
import base64
import binascii
from contextlib import asynccontextmanager, contextmanager
import hashlib
import hmac
import json
import math
import os
from pathlib import Path
import random
import re
import shutil
import sqlite3
import subprocess
import tempfile
import threading
import time
import unicodedata
from urllib.parse import parse_qs, urlparse
import uuid

from fastapi import Depends, FastAPI, File, Form, Header, HTTPException, Request, UploadFile
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field


MAX_UPLOAD_BYTES = 150 * 1024 * 1024
MAX_DURATION_SECONDS = 20 * 60
SESSION_SECONDS = 12 * 60 * 60
FEATURE_KEYS = ("bass", "groove", "energy", "treble", "vocal", "motion")
DEFAULT_FEATURES = {name: 0.5 for name in FEATURE_KEYS}
DEFAULT_PREFERENCES = {
    "bass": 0.26,
    "groove": 0.32,
    "energy": 0.18,
    "treble": -0.04,
    "vocal": 0.12,
    "motion": 0.16,
}
MEDIA_SLOTS = threading.BoundedSemaphore(2)
LOGIN_LOCK = threading.Lock()
LOGIN_FAILURES: dict[str, list[float]] = {}


def _clamp(value: float, minimum: float, maximum: float) -> float:
    return max(minimum, min(maximum, value))


def _json(value):
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"))


def _settings() -> dict:
    password = os.getenv("ADMIN_PASSWORD", "")
    secret = os.getenv("SESSION_SECRET", "")
    if not password or not secret:
        raise RuntimeError("ADMIN_PASSWORD and SESSION_SECRET are required")
    if len(secret) < 32:
        raise RuntimeError("SESSION_SECRET must contain at least 32 characters")
    data_dir = Path(os.getenv("DATA_DIR", "./data")).expanduser().resolve()
    data_dir.mkdir(parents=True, exist_ok=True)
    (data_dir / "audio").mkdir(exist_ok=True)
    (data_dir / "tmp").mkdir(exist_ok=True)
    return {"password": password, "secret": secret.encode(), "data_dir": data_dir}


@contextmanager
def _db(app: FastAPI):
    conn = sqlite3.connect(app.state.config["data_dir"] / "library.sqlite3", timeout=15)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys=ON")
    conn.execute("PRAGMA busy_timeout=15000")
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def _init_db(app: FastAPI):
    with _db(app) as db:
        db.execute("PRAGMA journal_mode=WAL")
        db.executescript(
            """
            CREATE TABLE IF NOT EXISTS artists (
                id INTEGER PRIMARY KEY,
                name TEXT NOT NULL COLLATE NOCASE UNIQUE,
                slug TEXT NOT NULL UNIQUE,
                created_at REAL NOT NULL
            );
            CREATE TABLE IF NOT EXISTS tracks (
                id TEXT PRIMARY KEY,
                artist_id INTEGER NOT NULL REFERENCES artists(id),
                title TEXT NOT NULL,
                duration REAL NOT NULL,
                filename TEXT NOT NULL UNIQUE,
                source TEXT NOT NULL,
                source_url TEXT,
                features_json TEXT NOT NULL,
                created_at REAL NOT NULL
            );
            CREATE INDEX IF NOT EXISTS tracks_artist_idx ON tracks(artist_id);
            CREATE TABLE IF NOT EXISTS playlist_state (
                slug TEXT PRIMARY KEY,
                mood REAL NOT NULL DEFAULT 0,
                preferences_json TEXT NOT NULL,
                recent_json TEXT NOT NULL DEFAULT '[]',
                updated_at REAL NOT NULL
            );
            CREATE TABLE IF NOT EXISTS playlist_track_stats (
                slug TEXT NOT NULL,
                track_id TEXT NOT NULL REFERENCES tracks(id) ON DELETE CASCADE,
                plays INTEGER NOT NULL DEFAULT 0,
                affinity REAL NOT NULL DEFAULT 0,
                last_played_at REAL,
                PRIMARY KEY(slug, track_id)
            );
            """
        )
        _ensure_state(db, "all")


@asynccontextmanager
async def lifespan(app: FastAPI):
    app.state.config = _settings()
    _init_db(app)
    yield


app = FastAPI(title="Dr. Stun Library", docs_url=None, redoc_url=None, lifespan=lifespan)


def _ensure_state(db: sqlite3.Connection, slug: str):
    db.execute(
        "INSERT OR IGNORE INTO playlist_state(slug, preferences_json, recent_json, updated_at) VALUES(?,?,?,?)",
        (slug, _json(DEFAULT_PREFERENCES), "[]", time.time()),
    )


_CYRILLIC = str.maketrans(
    {
        "а": "a", "б": "b", "в": "v", "г": "g", "д": "d", "е": "e", "ё": "yo",
        "ж": "zh", "з": "z", "и": "i", "й": "y", "к": "k", "л": "l", "м": "m",
        "н": "n", "о": "o", "п": "p", "р": "r", "с": "s", "т": "t", "у": "u",
        "ф": "f", "х": "h", "ц": "ts", "ч": "ch", "ш": "sh", "щ": "sch",
        "ъ": "", "ы": "y", "ь": "", "э": "e", "ю": "yu", "я": "ya",
    }
)


def _slugify(value: str) -> str:
    value = unicodedata.normalize("NFKD", value.strip().lower().translate(_CYRILLIC))
    value = value.encode("ascii", "ignore").decode()
    return re.sub(r"-+", "-", re.sub(r"[^a-z0-9]+", "-", value)).strip("-")[:70] or "artist"


def _clean_text(value: str, field: str, limit: int = 140) -> str:
    value = re.sub(r"\s+", " ", value).strip()
    if not value or len(value) > limit or any(ord(char) < 32 for char in value):
        raise HTTPException(422, f"Invalid {field}")
    return value


def _artist(db: sqlite3.Connection, name: str) -> sqlite3.Row:
    name = _clean_text(name, "artist", 100)
    for existing in db.execute("SELECT * FROM artists"):
        if existing["name"].casefold() == name.casefold():
            return existing
    base = _slugify(name)
    slug = base
    suffix = 2
    while slug == "all" or db.execute("SELECT 1 FROM artists WHERE slug=?", (slug,)).fetchone():
        slug = f"{base[:65]}-{suffix}"
        suffix += 1
    db.execute("INSERT INTO artists(name,slug,created_at) VALUES(?,?,?)", (name, slug, time.time()))
    _ensure_state(db, slug)
    return db.execute("SELECT * FROM artists WHERE slug=?", (slug,)).fetchone()


def _playlist(db: sqlite3.Connection, slug: str) -> dict:
    if slug == "all":
        count = db.execute("SELECT COUNT(*) FROM tracks").fetchone()[0]
        return {"slug": "all", "name": "Все треки", "kind": "global", "trackCount": count, "minSwitchSeconds": 35}
    row = db.execute(
        "SELECT a.slug,a.name,COUNT(t.id) AS count FROM artists a LEFT JOIN tracks t ON t.artist_id=a.id "
        "WHERE a.slug=? GROUP BY a.id", (slug,)
    ).fetchone()
    if not row:
        raise HTTPException(404, "Playlist not found")
    return {"slug": row["slug"], "name": row["name"], "kind": "artist", "trackCount": row["count"], "minSwitchSeconds": 35}


def _track_rows(db: sqlite3.Connection, slug: str) -> list[sqlite3.Row]:
    query = (
        "SELECT t.*,a.name AS artist,a.slug AS artist_slug,"
        "COALESCE(s.plays,0) AS plays,COALESCE(s.affinity,0) AS affinity,s.last_played_at "
        "FROM tracks t JOIN artists a ON a.id=t.artist_id "
        "LEFT JOIN playlist_track_stats s ON s.track_id=t.id AND s.slug=?"
    )
    if slug != "all":
        query += " WHERE a.slug=?"
        return db.execute(query, (slug, slug)).fetchall()
    return db.execute(query, (slug,)).fetchall()


def _state(db: sqlite3.Connection, slug: str) -> sqlite3.Row:
    _ensure_state(db, slug)
    return db.execute("SELECT * FROM playlist_state WHERE slug=?", (slug,)).fetchone()


def _ranked(db: sqlite3.Connection, slug: str) -> list[dict]:
    state = _state(db, slug)
    preferences = json.loads(state["preferences_json"])
    recent = json.loads(state["recent_json"])
    now = time.time()
    results = []
    for row in _track_rows(db, slug):
        features = json.loads(row["features_json"])
        compatibility = sum(preferences.get(key, 0) * (features.get(key, 0.5) - 0.5) for key in FEATURE_KEYS)
        novelty = 0.36 / math.sqrt(row["plays"] + 1)
        elapsed = now - row["last_played_at"] if row["last_played_at"] else float("inf")
        recency_penalty = 0.9 * max(0, 1 - elapsed / 900)
        repeat_penalty = 1.35 if row["id"] in recent[:2] else 0
        score = row["affinity"] * 1.6 + compatibility + novelty - recency_penalty - repeat_penalty
        results.append(
            {
                "id": row["id"],
                "title": row["title"],
                "artist": row["artist"],
                "duration": round(row["duration"], 2),
                "streamUrl": f"/api/tracks/{row['id']}/audio",
                "score": round(score, 3),
                "plays": row["plays"],
                "affinity": row["affinity"],
                "artistSlug": row["artist_slug"],
                "source": row["source"],
                "sourceUrl": row["source_url"],
                "createdAt": row["created_at"],
            }
        )
    results.sort(key=lambda track: (-track["score"], track["title"].casefold()))
    return results


def _public_track(track: dict) -> dict:
    return {key: track[key] for key in ("id", "title", "artist", "duration", "streamUrl", "score", "plays")}


def _taste(db: sqlite3.Connection, slug: str, ranked: list[dict] | None = None) -> dict:
    state = _state(db, slug)
    ranked = ranked if ranked is not None else _ranked(db, slug)
    mood = round(state["mood"], 2)
    if mood > 0.45:
        label = "На своей волне"
    elif mood > 0.1:
        label = "Ловит ритм"
    elif mood < -0.35:
        label = "Ищет другое звучание"
    else:
        label = "Прислушивается"
    liked = sorted((track for track in ranked if track["affinity"] > 0.12), key=lambda item: -item["affinity"])
    disliked = sorted((track for track in ranked if track["affinity"] < -0.12), key=lambda item: item["affinity"])
    return {
        "mood": mood,
        "label": label,
        "favorites": [_public_track(track) for track in liked[:3]],
        "dislikes": [_public_track(track) for track in disliked[:3]],
    }


def _select_next(db: sqlite3.Connection, slug: str, excluded: set[str]) -> dict:
    ranked = _ranked(db, slug)
    if not ranked:
        raise HTTPException(404, "Playlist is empty")
    recent = json.loads(_state(db, slug)["recent_json"])
    candidates = [track for track in ranked if track["id"] not in excluded and track["id"] not in recent[:2]]
    if not candidates:
        candidates = [track for track in ranked if track["id"] not in excluded]
    if not candidates:
        candidates = ranked
    # Usually follow the fly's taste, while every library track retains a
    # chance to be discovered even when many entries have identical scores.
    pool = candidates[: min(8, len(candidates))] if random.random() < 0.82 else candidates
    best_score = pool[0]["score"]
    weights = [math.exp(_clamp(track["score"] - best_score, -8, 0) / 0.7) for track in pool]
    chosen = random.choices(pool, weights=weights, k=1)[0]
    db.execute(
        "UPDATE playlist_state SET recent_json=?,updated_at=? WHERE slug=?",
        (_json([chosen["id"], *[item for item in recent if item != chosen["id"]]][:4]), time.time(), slug),
    )
    db.execute(
        "INSERT INTO playlist_track_stats(slug,track_id,plays,last_played_at) VALUES(?,?,1,?) "
        "ON CONFLICT(slug,track_id) DO UPDATE SET plays=plays+1,last_played_at=excluded.last_played_at",
        (slug, chosen["id"], time.time()),
    )
    chosen["plays"] += 1
    return _public_track(chosen)


class NextBody(BaseModel):
    excludeTrackIds: list[str] = Field(default_factory=list, max_length=100)


class FeedbackFeatures(BaseModel):
    bass: float = Field(ge=0, le=1, allow_inf_nan=False)
    groove: float = Field(ge=0, le=1, allow_inf_nan=False)
    energy: float = Field(ge=0, le=1, allow_inf_nan=False)
    treble: float = Field(ge=0, le=1, allow_inf_nan=False)
    vocal: float = Field(ge=0, le=1, allow_inf_nan=False)
    motion: float = Field(ge=0, le=1, allow_inf_nan=False)


class FeedbackBody(BaseModel):
    trackId: str
    secondsPlayed: float = Field(ge=0, le=36000, allow_inf_nan=False)
    reason: str
    features: FeedbackFeatures


class LoginBody(BaseModel):
    password: str = Field(min_length=1, max_length=1024)


class ArtistBody(BaseModel):
    name: str


class YoutubeBody(BaseModel):
    url: str
    title: str | None = None
    artist: str | None = None


class TrackPatch(BaseModel):
    title: str | None = None
    artist: str | None = None


@app.get("/api/healthz")
def healthz():
    return {"status": "ok"}


@app.get("/api/playlists")
def playlists(request: Request):
    with _db(request.app) as db:
        result = [_playlist(db, "all")]
        slugs = db.execute("SELECT slug FROM artists ORDER BY name COLLATE NOCASE").fetchall()
        result.extend(_playlist(db, row["slug"]) for row in slugs)
        return {"playlists": result}


@app.get("/api/playlists/{slug}")
def playlist_detail(slug: str, request: Request):
    with _db(request.app) as db:
        playlist = _playlist(db, slug)
        ranked = _ranked(db, slug)
        return {"playlist": playlist, "tracks": [_public_track(track) for track in ranked], "taste": _taste(db, slug, ranked)}


@app.post("/api/playlists/{slug}/next")
def playlist_next(slug: str, body: NextBody, request: Request):
    with _db(request.app) as db:
        db.execute("BEGIN IMMEDIATE")
        _playlist(db, slug)
        track = _select_next(db, slug, set(body.excludeTrackIds))
        return {"track": track, "taste": _taste(db, slug)}


@app.post("/api/playlists/{slug}/feedback")
def playlist_feedback(slug: str, body: FeedbackBody, request: Request):
    if body.reason not in {"ended", "fly-skip", "manual-skip"}:
        raise HTTPException(422, "Invalid reason")
    with _db(request.app) as db:
        db.execute("BEGIN IMMEDIATE")
        _playlist(db, slug)
        row = next((item for item in _track_rows(db, slug) if item["id"] == body.trackId), None)
        if row is None:
            raise HTTPException(404, "Track not found in playlist")
        # Ignore unrealistically short playback and bound every client-derived signal.
        listened = _clamp(body.secondsPlayed / max(row["duration"], 1), 0, 1)
        reward = {"ended": 0.8, "fly-skip": -0.68, "manual-skip": -0.14}[body.reason]
        if body.reason == "ended":
            reward *= 0.5 + 0.5 * listened
        elif listened < 0.08:
            reward *= 0.35
        state = _state(db, slug)
        features = body.features.model_dump()
        prefs = json.loads(state["preferences_json"])
        for key in FEATURE_KEYS:
            prefs[key] = round(_clamp(prefs.get(key, 0) * 0.99 + reward * (features[key] - 0.5) * 0.12, -0.8, 0.8), 4)
        mood = _clamp(state["mood"] * 0.8 + reward * 0.2, -1, 1)
        db.execute(
            "UPDATE playlist_state SET mood=?,preferences_json=?,updated_at=? WHERE slug=?",
            (mood, _json(prefs), time.time(), slug),
        )
        affinity = _clamp(row["affinity"] * 0.88 + reward * 0.72, -3, 3)
        db.execute(
            "INSERT INTO playlist_track_stats(slug,track_id,affinity) VALUES(?,?,?) "
            "ON CONFLICT(slug,track_id) DO UPDATE SET affinity=excluded.affinity",
            (slug, body.trackId, affinity),
        )
        old_features = json.loads(row["features_json"])
        merged = {key: round(old_features.get(key, 0.5) * 0.72 + features[key] * 0.28, 4) for key in FEATURE_KEYS}
        db.execute("UPDATE tracks SET features_json=? WHERE id=?", (_json(merged), body.trackId))
        ranked = _ranked(db, slug)
        track = next(track for track in ranked if track["id"] == body.trackId)
        return {"track": _public_track(track), "taste": _taste(db, slug, ranked)}


@app.get("/api/tracks/{track_id}/audio")
def track_audio(track_id: str, request: Request):
    with _db(request.app) as db:
        row = db.execute("SELECT filename FROM tracks WHERE id=?", (track_id,)).fetchone()
    if row is None:
        raise HTTPException(404, "Track not found")
    # DB filenames are generated UUIDs, never user supplied paths.
    path = request.app.state.config["data_dir"] / "audio" / row["filename"]
    if not path.is_file():
        raise HTTPException(404, "Audio file missing")
    return FileResponse(path, media_type="audio/mpeg", filename=f"{track_id}.mp3", content_disposition_type="inline")


def _client_ip(request: Request) -> str:
    # Nginx overwrites X-Real-IP, and the API is exposed only on the Compose network.
    return request.headers.get("x-real-ip") or (request.client.host if request.client else "unknown")


def _sign_token(secret: bytes, issued: int) -> str:
    payload = base64.urlsafe_b64encode(_json({"iat": issued, "exp": issued + SESSION_SECONDS}).encode()).rstrip(b"=")
    signature = hmac.new(secret, payload, hashlib.sha256).digest()
    return payload.decode() + "." + base64.urlsafe_b64encode(signature).rstrip(b"=").decode()


def _verify_token(token: str, secret: bytes) -> bool:
    try:
        payload_part, signature_part = token.split(".", 1)
        expected = hmac.new(secret, payload_part.encode(), hashlib.sha256).digest()
        supplied = base64.urlsafe_b64decode(signature_part + "=" * (-len(signature_part) % 4))
        if not hmac.compare_digest(expected, supplied):
            return False
        data = json.loads(base64.urlsafe_b64decode(payload_part + "=" * (-len(payload_part) % 4)))
        return isinstance(data["exp"], int) and time.time() < data["exp"]
    except (ValueError, KeyError, TypeError, binascii.Error):
        return False


def require_admin(request: Request, authorization: str | None = Header(default=None)):
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(401, "Admin login required")
    if not _verify_token(authorization[7:], request.app.state.config["secret"]):
        raise HTTPException(401, "Invalid or expired session")


@app.post("/api/admin/login")
def admin_login(body: LoginBody, request: Request):
    ip = _client_ip(request)
    now = time.time()
    with LOGIN_LOCK:
        failures = [stamp for stamp in LOGIN_FAILURES.get(ip, []) if now - stamp < 900]
        if len(failures) >= 10:
            raise HTTPException(429, "Too many login attempts; try again later")
    actual = hashlib.sha256(body.password.encode()).digest()
    expected = hashlib.sha256(request.app.state.config["password"].encode()).digest()
    if not hmac.compare_digest(actual, expected):
        with LOGIN_LOCK:
            LOGIN_FAILURES[ip] = [*failures, now]
        raise HTTPException(401, "Incorrect password")
    with LOGIN_LOCK:
        LOGIN_FAILURES.pop(ip, None)
    issued = int(now)
    return {"token": _sign_token(request.app.state.config["secret"], issued), "expiresAt": issued + SESSION_SECONDS}


@app.get("/api/admin/me", dependencies=[Depends(require_admin)])
def admin_me():
    return {"authenticated": True}


@app.get("/api/admin/artists", dependencies=[Depends(require_admin)])
def admin_artists(request: Request):
    with _db(request.app) as db:
        rows = db.execute(
            "SELECT a.name,a.slug,COUNT(t.id) AS track_count FROM artists a "
            "LEFT JOIN tracks t ON t.artist_id=a.id GROUP BY a.id ORDER BY a.name COLLATE NOCASE"
        ).fetchall()
        return {"artists": [{"name": row["name"], "slug": row["slug"], "trackCount": row["track_count"]} for row in rows]}


@app.post("/api/admin/artists", dependencies=[Depends(require_admin)])
def admin_add_artist(body: ArtistBody, request: Request):
    with _db(request.app) as db:
        row = _artist(db, body.name)
        return {"artist": {"name": row["name"], "slug": row["slug"]}}


@app.get("/api/admin/tracks", dependencies=[Depends(require_admin)])
def admin_tracks(request: Request):
    with _db(request.app) as db:
        rows = db.execute(
            "SELECT t.id,t.title,t.duration,t.source,t.source_url,t.created_at,a.name AS artist,a.slug AS artist_slug "
            "FROM tracks t JOIN artists a ON a.id=t.artist_id ORDER BY t.created_at DESC"
        ).fetchall()
        return {
            "tracks": [
                {
                    "id": row["id"], "title": row["title"], "artist": row["artist"],
                    "artistSlug": row["artist_slug"], "duration": round(row["duration"], 2),
                    "streamUrl": f"/api/tracks/{row['id']}/audio", "source": row["source"],
                    "sourceUrl": row["source_url"], "createdAt": row["created_at"],
                }
                for row in rows
            ]
        }


def _run(command: list[str], timeout: int) -> subprocess.CompletedProcess:
    try:
        return subprocess.run(command, capture_output=True, text=True, timeout=timeout, check=False)
    except FileNotFoundError as error:
        raise HTTPException(503, f"Media tool unavailable: {command[0]}") from error
    except subprocess.TimeoutExpired as error:
        raise HTTPException(422, "Media processing took too long") from error


def _probe(path: Path) -> float:
    result = _run(
        ["ffprobe", "-v", "error", "-select_streams", "a:0", "-show_entries", "stream=codec_name:format=duration", "-of", "json", str(path)],
        30,
    )
    if result.returncode:
        raise HTTPException(422, "Could not read audio from file")
    try:
        info = json.loads(result.stdout)
        if not info.get("streams"):
            raise ValueError("no audio")
        duration = float(info["format"]["duration"])
    except (KeyError, ValueError, TypeError, json.JSONDecodeError) as error:
        raise HTTPException(422, "File has no valid audio duration") from error
    if not math.isfinite(duration) or not (1 <= duration <= MAX_DURATION_SECONDS):
        raise HTTPException(422, "Track must be between 1 second and 20 minutes")
    return duration


def _to_mp3(source: Path, destination: Path) -> float:
    _probe(source)
    result = _run(
        ["ffmpeg", "-hide_banner", "-loglevel", "error", "-nostdin", "-y", "-i", str(source),
         "-map", "0:a:0", "-vn", "-c:a", "libmp3lame", "-q:a", "4", "-ar", "44100", "-ac", "2", str(destination)],
        240,
    )
    if result.returncode or not destination.is_file():
        raise HTTPException(422, "Could not convert file to MP3")
    return _probe(destination)


def _save_track(app: FastAPI, converted: Path, title: str, artist_name: str, duration: float, source: str, source_url: str | None = None) -> dict:
    title = _clean_text(title, "title")
    artist_name = _clean_text(artist_name, "artist", 100)
    track_id = uuid.uuid4().hex
    filename = track_id + ".mp3"
    target = app.state.config["data_dir"] / "audio" / filename
    shutil.move(str(converted), target)
    try:
        with _db(app) as db:
            artist = _artist(db, artist_name)
            db.execute(
                "INSERT INTO tracks(id,artist_id,title,duration,filename,source,source_url,features_json,created_at) "
                "VALUES(?,?,?,?,?,?,?,?,?)",
                (track_id, artist["id"], title, duration, filename, source, source_url, _json(DEFAULT_FEATURES), time.time()),
            )
    except Exception:
        target.unlink(missing_ok=True)
        raise
    return {"id": track_id, "title": title, "artist": artist_name, "duration": round(duration, 2), "streamUrl": f"/api/tracks/{track_id}/audio", "score": 0, "plays": 0}


async def _write_upload(file: UploadFile, path: Path):
    written = 0
    try:
        with path.open("wb") as output:
            while chunk := await file.read(1024 * 1024):
                written += len(chunk)
                if written > MAX_UPLOAD_BYTES:
                    raise HTTPException(413, "File exceeds 150 MB")
                output.write(chunk)
    finally:
        await file.close()
    if not written:
        raise HTTPException(422, "File is empty")


@app.post("/api/admin/tracks/upload", dependencies=[Depends(require_admin)])
async def admin_upload(request: Request, file: UploadFile = File(...), title: str = Form(...), artist: str = Form(...)):
    extension = Path(file.filename or "").suffix.lower()
    if extension not in {".mp3", ".mp4"}:
        raise HTTPException(422, "Upload an MP3 or MP4 file")
    title = _clean_text(title, "title")
    artist = _clean_text(artist, "artist", 100)
    if not MEDIA_SLOTS.acquire(blocking=False):
        raise HTTPException(429, "Another upload is being processed; try again soon")
    try:
        with tempfile.TemporaryDirectory(dir=request.app.state.config["data_dir"] / "tmp") as directory:
            folder = Path(directory)
            incoming = folder / ("upload" + extension)
            converted = folder / "audio.mp3"
            await _write_upload(file, incoming)
            duration = await asyncio.to_thread(_to_mp3, incoming, converted)
            track = await asyncio.to_thread(_save_track, request.app, converted, title, artist, duration, "upload")
            return {"track": track}
    finally:
        MEDIA_SLOTS.release()


def _validate_youtube_url(raw: str) -> str:
    if len(raw) > 2000:
        raise HTTPException(422, "Invalid YouTube URL")
    parsed = urlparse(raw.strip())
    host = (parsed.hostname or "").lower()
    try:
        has_port = parsed.port is not None
    except ValueError as error:
        raise HTTPException(422, "Invalid YouTube URL") from error
    if parsed.scheme not in {"http", "https"} or parsed.username or parsed.password or has_port:
        raise HTTPException(422, "Invalid YouTube URL")
    if host not in {"youtube.com", "www.youtube.com", "m.youtube.com", "music.youtube.com", "youtu.be", "www.youtu.be"}:
        raise HTTPException(422, "Only YouTube links are supported")
    video_id = None
    if host in {"youtu.be", "www.youtu.be"}:
        video_id = parsed.path.strip("/")
    elif parsed.path == "/watch":
        video_id = parse_qs(parsed.query).get("v", [None])[0]
    else:
        match = re.fullmatch(r"/(?:shorts|live|embed)/([A-Za-z0-9_-]{11})/?", parsed.path)
        video_id = match.group(1) if match else None
    if not video_id or not re.fullmatch(r"[A-Za-z0-9_-]{11}", video_id):
        raise HTTPException(422, "Link must point to a YouTube video")
    return parsed.geturl()


def _yt_base() -> list[str]:
    return ["yt-dlp", "--ignore-config", "--no-playlist", "--max-downloads", "1", "--js-runtimes", "node", "--socket-timeout", "15", "--retries", "2", "--fragment-retries", "2", "--no-progress", "--no-warnings"]


def _from_youtube(app: FastAPI, url: str, title_override: str | None, artist_override: str | None) -> dict:
    base = _yt_base()
    metadata = _run([*base, "--skip-download", "--dump-single-json", url], 75)
    if metadata.returncode:
        raise HTTPException(422, "Could not read this YouTube video")
    try:
        info = json.loads(metadata.stdout)
        duration = float(info["duration"])
    except (json.JSONDecodeError, KeyError, ValueError, TypeError) as error:
        raise HTTPException(422, "Video duration is unavailable") from error
    if info.get("is_live") or info.get("live_status") in {"is_live", "is_upcoming"}:
        raise HTTPException(422, "Live streams are not supported")
    if not math.isfinite(duration) or not (1 <= duration <= MAX_DURATION_SECONDS):
        raise HTTPException(422, "Track must be between 1 second and 20 minutes")
    title = _clean_text(title_override or info.get("track") or info.get("title") or "", "title")
    artist = _clean_text(artist_override or info.get("artist") or info.get("uploader") or "", "artist", 100)
    with tempfile.TemporaryDirectory(dir=app.state.config["data_dir"] / "tmp") as directory:
        folder = Path(directory)
        template = str(folder / "source.%(ext)s")
        result = _run(
            [*base, "--max-filesize", "150M", "--match-filter", "duration <= 1200 & !is_live",
             "-f", "bestaudio/best", "-x", "--audio-format", "mp3", "--audio-quality", "4", "-o", template, url],
            360,
        )
        files = list(folder.glob("source.mp3"))
        if result.returncode or not files:
            raise HTTPException(422, "Could not download or convert this YouTube video")
        mp3 = files[0]
        if mp3.stat().st_size > MAX_UPLOAD_BYTES:
            raise HTTPException(413, "Audio exceeds 150 MB")
        measured_duration = _probe(mp3)
        return _save_track(app, mp3, title, artist, measured_duration, "youtube", url)


@app.post("/api/admin/tracks/youtube", dependencies=[Depends(require_admin)])
async def admin_youtube(body: YoutubeBody, request: Request):
    url = _validate_youtube_url(body.url)
    if body.title is not None:
        _clean_text(body.title, "title")
    if body.artist is not None:
        _clean_text(body.artist, "artist", 100)
    if not MEDIA_SLOTS.acquire(blocking=False):
        raise HTTPException(429, "Another upload is being processed; try again soon")
    try:
        track = await asyncio.to_thread(_from_youtube, request.app, url, body.title, body.artist)
        return {"track": track}
    finally:
        MEDIA_SLOTS.release()


@app.patch("/api/admin/tracks/{track_id}", dependencies=[Depends(require_admin)])
def admin_patch_track(track_id: str, body: TrackPatch, request: Request):
    if body.title is None and body.artist is None:
        raise HTTPException(422, "Nothing to update")
    with _db(request.app) as db:
        row = db.execute("SELECT t.*,a.name AS artist FROM tracks t JOIN artists a ON a.id=t.artist_id WHERE t.id=?", (track_id,)).fetchone()
        if not row:
            raise HTTPException(404, "Track not found")
        title = _clean_text(body.title, "title") if body.title is not None else row["title"]
        artist_name = _clean_text(body.artist, "artist", 100) if body.artist is not None else row["artist"]
        artist = _artist(db, artist_name)
        db.execute("UPDATE tracks SET title=?,artist_id=? WHERE id=?", (title, artist["id"], track_id))
        return {"track": {"id": track_id, "title": title, "artist": artist["name"], "duration": round(row["duration"], 2), "streamUrl": f"/api/tracks/{track_id}/audio", "score": 0, "plays": 0}}


@app.delete("/api/admin/tracks/{track_id}", dependencies=[Depends(require_admin)])
def admin_delete_track(track_id: str, request: Request):
    with _db(request.app) as db:
        row = db.execute("SELECT filename FROM tracks WHERE id=?", (track_id,)).fetchone()
        if not row:
            raise HTTPException(404, "Track not found")
        db.execute("DELETE FROM tracks WHERE id=?", (track_id,))
        # Keep playlist history tidy, including the short recent exclusion list.
        for state in db.execute("SELECT slug,recent_json FROM playlist_state"):
            recent = [item for item in json.loads(state["recent_json"]) if item != track_id]
            db.execute("UPDATE playlist_state SET recent_json=? WHERE slug=?", (_json(recent), state["slug"]))
    (request.app.state.config["data_dir"] / "audio" / row["filename"]).unlink(missing_ok=True)
    return {"deleted": True}
