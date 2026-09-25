"""API integration tests using a temporary SQLite database and generated media."""

import subprocess

import pytest
from fastapi.testclient import TestClient

from server.app import _validate_youtube_url, app


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

    playlists = client.get("/api/playlists").json()["playlists"]
    assert {playlist["slug"] for playlist in playlists} == {"all", artist["slug"]}
    detail = client.get(f"/api/playlists/{artist['slug']}").json()
    assert detail["playlist"]["trackCount"] == 2
    assert len(detail["tracks"]) == 2
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


def test_mp4_extraction_and_youtube_url_validation(client, tmp_path):
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
    url = response.json()["track"]["streamUrl"]
    assert client.get(url).status_code == 200
    for bad_url in ("https://evil.example/video", "https://youtube.com:bad/watch?v=x", "http://127.0.0.1/file", "https://youtube.com/redirect?q=http://127.0.0.1/"):
        rejected = client.post("/api/admin/tracks/youtube", json={"url": bad_url}, headers=auth)
        assert rejected.status_code == 422


def test_canonical_youtube_link_validation():
    assert _validate_youtube_url("https://www.youtube.com/watch?v=ABCDEFGHIJK").startswith("https://")
    assert _validate_youtube_url("https://youtu.be/ABCDEFGHIJK") == "https://youtu.be/ABCDEFGHIJK"
