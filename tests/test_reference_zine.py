import json
from unittest.mock import AsyncMock

from ComfyArt.api.mcp_tools import reference_zine as zine
from ComfyArt.api.mcp_tools._context import PROJECT


async def test_chat_job_is_scoped_and_can_recover_its_result(monkeypatch, tmp_path):
    meta = {
        "zinePages": list(range(8)),
        "references": [{"key": "r", "src": "ref.jpg"}],
        "roadmapPhotos": {
            "batch": ["p"],
            "photos": [{"key": "p", "state": "ready", "ref": {"filename": "p.jpg"}}],
        },
    }
    snapshot = json.dumps(
        {"document": {"store": {"document:document": {"meta": meta}}}}
    )
    monkeypatch.setattr(zine.project_store, "get_snapshot", lambda *_: snapshot)
    monkeypatch.setattr(zine.runtime, "DATA", tmp_path)
    monkeypatch.setattr(zine, "view_path", lambda value: value)
    worker = AsyncMock(return_value={"status": "complete", "project": "draft"})
    monkeypatch.setattr(zine, "generate", worker)
    token = PROJECT.set("source")
    try:
        info = await zine.handle({"action": "inputs"})
        assert info["spreadCount"] == 4
        args = {"action": "start", "title": "Book", "references": ["r"] * 4}
        a = await zine.handle(args)
        assert (await zine.handle(args))["job"] == a["job"]
        result = await zine.handle({"action": "status", "job": a["job"]})
        assert result["project"] == "draft"
        assert await zine.handle({"action": "status"}) == result
        assert await zine.handle({"action": "status", "job": a["job"]}) == result
        assert worker.await_count == 1
        import pytest

        with pytest.raises(ValueError, match="per spread"):
            await zine.handle({**args, "references": ["r"]})
        other = PROJECT.set("another")
        try:
            with pytest.raises(ValueError, match="Unknown"):
                await zine.handle({"action": "status", "job": a["job"]})
        finally:
            PROJECT.reset(other)
    finally:
        PROJECT.reset(token)


async def test_preview_uses_saved_reference_ids_and_returns_real_pixels(monkeypatch, tmp_path):
    import base64
    import io

    import pytest
    from PIL import Image

    key = "https://example.org/photo?variant=1"
    path = tmp_path / "reference.jpg"
    Image.new("RGB", (100, 150), "#dd7700").save(path)
    meta = {"zinePages": list(range(8)), "references": [{"key": key, "src": "saved"}]}
    monkeypatch.setattr(zine.project_store, "get_snapshot", lambda *_: json.dumps(
        {"document": {"store": {"document:document": {"meta": meta}}}}))
    monkeypatch.setattr(zine, "view_path", lambda _: str(path))
    row, = (await zine.handle({"action": "inputs"}))["references"]
    result = await zine.handle({"action": "preview", "references": [row["refId"]]})
    assert result["keysInImageOrder"] == [key]
    img = Image.open(io.BytesIO(base64.b64decode(result["_images"][0]["data"])))
    r, g, b = img.getpixel((175, 50))
    assert r > g > b
    with pytest.raises(ValueError):
        await zine.handle({"action": "preview", "references": ["ref-unknown"]})


async def test_chat_status_is_immediate_and_scoped(monkeypatch, tmp_path):
    import asyncio
    import pytest
    from ComfyArt.api.mcp_tools._context import BOT_CHAT_ID

    job = "zine-12345678"
    folder = tmp_path / "zine-runs" / job
    folder.mkdir(parents=True)
    (folder / "status.json").write_text(json.dumps({"sourceProject": "source", "status": "running", "job": job}))
    released = asyncio.Event()

    async def finish():
        await released.wait()
        (folder / "status.json").write_text(json.dumps({"sourceProject": "source", "status": "complete", "job": job}))

    task = asyncio.create_task(finish())
    monkeypatch.setattr(zine.runtime, "DATA", tmp_path)
    monkeypatch.setattr(zine, "_jobs", {("source", job): task})
    monkeypatch.setattr(zine, "_last_job", {"source": job})
    token = PROJECT.set("source")
    chat = BOT_CHAT_ID.set("chat")
    try:
        assert (await asyncio.wait_for(zine.handle({"action": "status"}), 1))["status"] == "running"
        other = PROJECT.set("other")
        try:
            with pytest.raises(ValueError):
                await zine.handle({"action": "status", "job": job})
        finally:
            PROJECT.reset(other)
        poll = asyncio.create_task(zine.handle({"action": "status", "job": job, "wait": True}))
        await asyncio.sleep(0)
        assert not poll.done()
        released.set()
        assert (await asyncio.wait_for(poll, 1))["status"] == "complete"
    finally:
        BOT_CHAT_ID.reset(chat)
        PROJECT.reset(token)
        task.cancel()
        await asyncio.gather(task, return_exceptions=True)
