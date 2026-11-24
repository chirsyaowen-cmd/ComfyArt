import asyncio
import io
from urllib.parse import urlencode

from aiohttp import FormData
from aiohttp.test_utils import TestClient, TestServer
from PIL import Image
from ComfyArt.__main__ import create_app
from ComfyArt.api import photo_import


async def upload(client, name, data):
    form = FormData(quote_fields=False)
    form.add_field("image", data, filename=name, content_type="application/octet-stream")
    response = await client.post("/api/comfyart/photos", data=form)
    assert response.status == 200
    return await response.json()


async def wait_state(client, key, expected):
    async def poll():
        while True:
            result = await client.post("/api/comfyart/photos/status", json=[key])
            if (await result.json())[key] == expected:
                return
            await asyncio.sleep(0.02)
    await asyncio.wait_for(poll(), timeout=6)


async def test_heif_thumbnail_before_rendition_and_content_dedup(fresh_user_dir):
    buf = io.BytesIO()
    landscape = Image.new("RGB", (600, 420), "coral")
    orientation = landscape.getexif()
    orientation[274] = 6
    landscape.save(buf, format="HEIF", exif=orientation.tobytes())
    raw = buf.getvalue()
    async with TestClient(TestServer(create_app())) as client:
        a, b = await asyncio.gather(upload(client, "手机.HEIC", raw), upload(client, "renamed.heif", raw))
        assert a["key"] == b["key"] and a["ref"] == b["ref"]
        await wait_state(client, a["key"], "ready")
        hit = await client.get("/api/comfyart/photos/" + a["key"])
        assert (await hit.json())["ref"] == a["ref"]
        originals = list((fresh_user_dir / "input/comfyart").iterdir())
        assert len(originals) == 1 and originals[0].read_bytes() == raw
        assert not (fresh_user_dir / "photo-renditions").exists()
        src = "/api/view?" + urlencode(a["ref"])
        thumb = await client.get("/comfyart/thumb", params={"url": src})
        assert Image.open(io.BytesIO(await thumb.read())).size == (179, 256)
        assert not (fresh_user_dir / "photo-renditions").exists()
        view = await client.get(src)
        assert view.content_type == "image/jpeg"
        image = Image.open(io.BytesIO(await view.read()))
        assert image.format == "JPEG" and image.size == (420, 600)
        path, = (fresh_user_dir / "photo-renditions").iterdir()
        modified = path.stat().st_mtime_ns
        assert (await client.get(src)).status == 200
        assert path.stat().st_mtime_ns == modified


async def test_restart_resumes_thumbnails_and_retry_uses_saved_source(fresh_user_dir, monkeypatch):
    photo = io.BytesIO()
    Image.new("RGB", (80, 60), "cyan").save(photo, format="PNG")
    photo.seek(0)
    # Saved just before a shutdown, with the thumbnail still pending on disk.
    pending = photo_import.store(photo, "restart.png")
    thumb = photo_import.thumb_for
    def temporary_error(url, size):
        raise OSError("temporary read failure")
    monkeypatch.setattr(photo_import, "thumb_for", temporary_error)
    async with TestClient(TestServer(create_app())) as client:
        await wait_state(client, pending["key"], "failed")
        monkeypatch.setattr(photo_import, "thumb_for", thumb)
        assert (await client.post("/api/comfyart/photos/" + pending["key"] + "/retry")).status == 200
        await wait_state(client, pending["key"], "ready")
        assert len(list((fresh_user_dir / "input/comfyart").iterdir())) == 1
