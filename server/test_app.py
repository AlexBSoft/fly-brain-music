"""API integration tests using a temporary SQLite database and generated media."""

import importlib
import json
from pathlib import Path
import shutil
import subprocess

import pytest
from fastapi.testclient import TestClient

from server.app import _validate_youtube_url, _youtube_names, app

app_module = importlib.import_module("server.app")


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setenv("ADMIN_PASSWORD", "test-password")
    monkeypatch.setenv("SESSION_SECRET", "a" * 48)
    monkeypatch.setenv("DATA_DIR", str(tmp_path / "data"))
    with TestClient(app) as test_client:
        yield test_client


def _auth(client):
    response = client.post("/api/admin/login", json={"password": "test-password"})
    assert response.status_code == 200
    return {"Authorization": f"Bearer {response.json()['token']}"}


def _media(path, container="mp3"):
    args = ["ffmpeg", "-hide_banner", "-loglevel", "error", "-y"]
    if container == "mp4":
        args += ["-f", "lavfi", "-i", "color=c=black:s=160x90:r=15:d=2"]
    args += ["-f", "lavfi", "-i", "sine=frequency=440:duration=2"]
    if container == "mp4":
        args += ["-shortest", "-c:v", "mpeg4", "-c:a", "aac"]
    else:
        args += ["-c:a", "libmp3lame"]
    subprocess.run([*args, str(path)], check=True, capture_output=True)


def test_local_library_radio_feedback_and_delete(client, tmp_path):
    assert client.get("/api/healthz").json() == {"status": "ok"}
    assert client.get("/api/admin/artists").status_code == 401
    assert client.post("/api/admin/login", json={"password": "wrong"}).status_code == 401
    auth = _auth(client)
    assert client.get("/api/admin/me", headers=auth).json()["authenticated"]

    artist = client.post("/api/admin/artists", json={"name": "Муха Тест"}, headers=auth).json()["artist"]
    assert artist["slug"] != "all"
    source = tmp_path / "sine.mp3"
    _media(source)
    for title in ("Первый", "Второй"):
        with source.open("rb") as stream:
            response = client.post(
                "/api/admin/tracks/upload",
                headers=auth,
                data={"title": title, "artist": artist["name"]},
                files={"file": (source.name, stream, "audio/mpeg")},
            )
        assert response.status_code == 200, response.text
    tracks = client.get("/api/admin/tracks", headers=auth).json()["tracks"]
    assert len(tracks) == 2
    assert all(track["mediaType"] == "audio" and track["mimeType"] == "audio/mpeg" for track in tracks)

    playlists = client.get("/api/playlists").json()["playlists"]
    assert {playlist["slug"] for playlist in playlists} == {"all", artist["slug"]}
    detail = client.get(f"/api/playlists/{artist['slug']}").json()
    assert detail["playlist"]["trackCount"] == 2
    assert len(detail["tracks"]) == 2
    assert all(track["mediaType"] == "audio" for track in detail["tracks"])
    assert detail["taste"]["favorites"] == []
    first_id = detail["tracks"][0]["id"]
    audio = client.get(f"/api/tracks/{first_id}/audio", headers={"Range": "bytes=0-1023"})
    assert audio.status_code == 206
    assert len(audio.content) == 1024
    assert audio.headers["content-type"] == "audio/mpeg"

    next_track = client.post(f"/api/playlists/{artist['slug']}/next", json={"excludeTrackIds": []}).json()["track"]
    assert next_track["id"] in {track["id"] for track in detail["tracks"]}
    feedback = client.post(
        f"/api/playlists/{artist['slug']}/feedback",
        json={
            "trackId": next_track["id"], "secondsPlayed": 2, "reason": "ended",
            "features": {"bass": .8, "groove": .7, "energy": .8, "treble": .4, "vocal": .2, "motion": .6},
        },
    )
    assert feedback.status_code == 200, feedback.text
    assert feedback.json()["taste"]["favorites"][0]["id"] == next_track["id"]
    assert client.get("/api/playlists/all").json()["taste"]["favorites"] == []

    other = client.post(
        f"/api/playlists/{artist['slug']}/next",
        json={"excludeTrackIds": [next_track["id"]]},
    ).json()["track"]
    assert other["id"] != next_track["id"]
    skipped = client.post(
        f"/api/playlists/{artist['slug']}/feedback",
        json={
            "trackId": other["id"], "secondsPlayed": 1, "reason": "fly-skip",
            "features": {"bass": .1, "groove": .2, "energy": .2, "treble": .7, "vocal": .8, "motion": .2},
        },
    )
    assert skipped.status_code == 200
    assert skipped.json()["taste"]["dislikes"][0]["id"] == other["id"]

    changed = client.patch(f"/api/admin/tracks/{next_track['id']}", json={"artist": "Новый артист"}, headers=auth)
    assert changed.status_code == 200
    assert changed.json()["track"]["artist"] == "Новый артист"
    assert client.get(f"/api/playlists/{artist['slug']}").json()["playlist"]["trackCount"] == 1
    assert client.delete(f"/api/admin/tracks/{next_track['id']}", headers=auth).json() == {"deleted": True}
    assert client.get(f"/api/tracks/{next_track['id']}/audio").status_code == 404


def test_mp4_upload_and_youtube_url_validation(client, tmp_path):
    auth = _auth(client)
    movie = tmp_path / "clip.mp4"
    _media(movie, "mp4")
    with movie.open("rb") as stream:
        response = client.post(
            "/api/admin/tracks/upload", headers=auth,
            data={"title": "Клип", "artist": "Видео"},
            files={"file": (movie.name, stream, "video/mp4")},
        )
    assert response.status_code == 200, response.text
    track = response.json()["track"]
    assert track["mediaType"] == "video"
    assert track["mimeType"] == "video/mp4"
    url = track["streamUrl"]
    media = client.get(url, headers={"Range": "bytes=0-1023"})
    assert media.status_code == 206
    assert media.headers["content-type"] == "video/mp4"
    assert len(media.content) == 1024
    stored = tmp_path / "data" / "audio" / f"{track['id']}.mp4"
    assert stored.is_file()
    probe = subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries", "stream=codec_type,codec_name",
         "-of", "json", str(stored)], check=True, capture_output=True, text=True,
    )
    streams = json.loads(probe.stdout)["streams"]
    assert any(item["codec_type"] == "video" and item["codec_name"] == "h264" for item in streams)
    assert any(item["codec_type"] == "audio" and item["codec_name"] == "aac" for item in streams)
    assert stored.read_bytes().find(b"moov") < stored.read_bytes().find(b"mdat")
    for bad_url in ("https://evil.example/video", "https://youtube.com:bad/watch?v=x", "http://127.0.0.1/file", "https://youtube.com/redirect?q=http://127.0.0.1/"):
        rejected = client.post("/api/admin/tracks/youtube", json={"url": bad_url}, headers=auth)
        assert rejected.status_code == 422


def test_canonical_youtube_link_validation():
    assert _validate_youtube_url("https://www.youtube.com/watch?v=ABCDEFGHIJK").startswith("https://")
    assert _validate_youtube_url("https://youtu.be/ABCDEFGHIJK") == "https://youtu.be/ABCDEFGHIJK"


def test_youtube_artist_title_inference_and_priority():
    metadata = {"title": "найтивыход - флэппи пэддл", "track": None, "artist": None, "uploader": "Farrys Faresno"}
    assert _youtube_names(metadata, None, None) == ("флэппи пэддл", "найтивыход")
    assert _youtube_names(metadata, "Мой заголовок", "Мой артист") == ("Мой заголовок", "Мой артист")
    tagged = {**metadata, "track": "Название из тегов", "artist": "Артист из тегов"}
    assert _youtube_names(tagged, None, None) == ("Название из тегов", "Артист из тегов")
    ordinary = {"title": "Песня без разделителя", "uploader": "Канал"}
    assert _youtube_names(ordinary, None, None) == ("Песня без разделителя", "Канал")


def test_youtube_import_defaults_to_video_and_can_extract_audio(client, tmp_path, monkeypatch):
    auth = _auth(client)
    movie = tmp_path / "fixture.mp4"
    song = tmp_path / "fixture.mp3"
    _media(movie, "mp4")
    _media(song)

    def fake_run(command, timeout):
        if command[0] != "yt-dlp":
            return original_run(command, timeout)
        if "--dump-single-json" in command:
            info = {"title": "Артист - Клип", "duration": 2.0, "is_live": False}
            return subprocess.CompletedProcess(command, 0, stdout=json.dumps(info))
        template = command[command.index("-o") + 1]
        destination = Path(template.replace("%(ext)s", "mp3" if "--audio-format" in command else "mp4"))
        shutil.copyfile(song if "--audio-format" in command else movie, destination)
        return subprocess.CompletedProcess(command, 0, stdout="")

    original_run = app_module._run
    monkeypatch.setattr(app_module, "_run", fake_run)
    link = "https://youtu.be/ABCDEFGHIJK"
    video_response = client.post("/api/admin/tracks/youtube", json={"url": link}, headers=auth)
    assert video_response.status_code == 200, video_response.text
    video = video_response.json()["track"]
    assert video["artist"] == "Артист"
    assert video["mediaType"] == "video"
    assert video["mimeType"] == "video/mp4"
    assert client.get(video["streamUrl"], headers={"Range": "bytes=0-511"}).headers["content-type"] == "video/mp4"

    audio_response = client.post(
        "/api/admin/tracks/youtube", json={"url": link, "format": "audio"}, headers=auth,
    )
    assert audio_response.status_code == 200, audio_response.text
    audio = audio_response.json()["track"]
    assert audio["mediaType"] == "audio"
    assert audio["mimeType"] == "audio/mpeg"
    assert client.get(audio["streamUrl"], headers={"Range": "bytes=0-511"}).headers["content-type"] == "audio/mpeg"
    assert client.post(
        "/api/admin/tracks/youtube", json={"url": link, "format": "mkv"}, headers=auth,
    ).status_code == 422
