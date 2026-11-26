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
