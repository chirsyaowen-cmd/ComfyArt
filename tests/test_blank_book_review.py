import json
from io import BytesIO
from pathlib import Path

import pytest
from aiohttp.test_utils import TestServer
from PIL import Image

from ComfyArt.__main__ import create_app
from conftest import write_settings


async def test_blank_book_review_shows_only_agent_options_before_and_after_import():
    playwright = pytest.importorskip("playwright.async_api")
    write_settings(**{"enable-mcp": True, "enable-bot": True, "proactive-review": True})
    async with TestServer(create_app()) as server, playwright.async_playwright() as pw:
        chrome = Path("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome")
        browser = await pw.chromium.launch(executable_path=str(chrome) if chrome.exists() else None)
        try:
            page = await browser.new_page(locale="en-US")
            await page.route("**/api/comfyart/bot/chats/*/send", lambda route: route.fulfill(json={"ok": True}))
            suggestion = {"text": "Use photos from the trip.", "options": [
                {"kind": "upload_photos", "label": "Choose photos from device"}]}
            await page.route("**/api/comfyart/bot/complete", lambda route: route.fulfill(
                json={"text": json.dumps({"suggestion": suggestion})}))
            old_notice = {"id": "older-review", "project": "photo-review-test", "kind": "suggestion",
                          "title": "Previous review", "body": suggestion["text"], "time": 1,
                          "source": "canvas_review", "reviewAdvice": True}
            saved = await page.request.post(str(server.make_url("/api/userdata/comfyart/notices.json")),
                                            data=json.dumps([old_notice]))
            assert saved.ok
            await page.goto(str(server.make_url("/comfyart/?project=photo-review-test&new=1&format=zine")))
            project = page.get_by_role("button", name="Choose from project photos")
            bell = page.get_by_title("Notifications", exact=True)
            await bell.click()
            old_row = page.locator(".ca-notice__item").filter(has_text="Previous review")
            new_row = page.locator(".ca-notice__item").filter(has_text="Canvas check-up")
            source = new_row.get_by_role("button", name="Choose photos from device")
            await playwright.expect(source).to_be_visible(timeout=15000)
            await playwright.expect(old_row).to_be_visible()
            await playwright.expect(old_row.locator(".ca-zine-photo button")).to_have_count(0)
            composer = page.locator(".ca-composer")
            await playwright.expect(composer.get_by_text(suggestion["text"], exact=True)).to_have_count(0)
            await playwright.expect(composer.get_by_role("button", name="Choose photos from device")).to_have_count(0)
            await playwright.expect(page.locator(".ca-zine-photo button")).to_have_text(["Choose photos from device"])
            response = await page.request.get(str(server.make_url("/api/comfyart/projects/photo-review-test")))
            snapshot = await response.json()
            meta = snapshot["document"]["store"]["document:document"]["meta"]
            assert "roadmap" not in meta
            await playwright.expect(page.get_by_role("button", name="Roadmap")).to_have_count(0)
            endpoint = str(server.make_url("/comfyart/mcp?project=photo-review-test"))
            response = await page.request.post(endpoint, data={"jsonrpc": "2.0", "id": 1, "method": "tools/call",
                "params": {"name": "get_canvas", "arguments": {}}})
            result = (await response.json())["result"]
            assert not result["isError"]
            canvas = json.loads(result["content"][0]["text"])
            assert canvas["book_frames"] and "uploads" in canvas and "roadmap" not in canvas
            async with page.expect_file_chooser() as event:
                await source.click()
            chooser = await event.value
            await chooser.set_files([])
            await chooser.element.dispatch_event("cancel")
            await playwright.expect(source).to_be_visible()
            async with page.expect_file_chooser() as event:
                await source.click()
            chooser = await event.value
            photo = BytesIO()
            Image.new("RGB", (80, 60), "green").save(photo, "PNG")
            await chooser.set_files({"name": "leaf.png", "mimeType": "image/png", "buffer": photo.getvalue()})
            photo_button = page.locator(".ca-photo-import").get_by_role("button", name="leaf.png")
            await playwright.expect(photo_button).to_be_visible()
            await bell.click()
            await page.get_by_role("button", name="Add", exact=True).click()
            async with page.expect_request("**/api/comfyart/bot/chats/*/send") as sent:
                await page.get_by_role("button", name="Canvas Review", exact=True).click()
            assert "roadmap" not in (await sent.value).post_data.lower()
            await playwright.expect(project).to_have_count(0)
            await playwright.expect(page.get_by_role("button", name="Suggest a photo")).to_have_count(0)
            await playwright.expect(page.locator(".ca-zine-photo button")).to_have_count(0)
            await photo_button.click()

            # Reopen a pre-removal book. Uploaded photos used a separate legacy metadata key.
            meta["roadmap"] = {"goal": "obsolete-route-marker", "steps": []}
            meta["roadmapPhotos"] = {"batch": ["original"], "photos": [
                {"key": "original", "name": "old-photo.png", "state": "ready",
                 "ref": {"filename": "old-photo.png", "type": "input", "subfolder": ""}}]}
            legacy = await page.request.put(str(server.make_url("/api/comfyart/projects/legacy-book")),
                                            data={"snapshot": snapshot, "name": "Legacy"})
            assert legacy.ok
            async with page.expect_response("**/api/comfyart/mcp_page"):
                await page.goto(str(server.make_url("/comfyart/?project=legacy-book")))
            rpc = await page.request.post(str(server.make_url("/comfyart/mcp?project=legacy-book")),
                data={"jsonrpc": "2.0", "id": 2, "method": "tools/call", "params": {"name": "get_canvas"}})
            result = (await rpc.json())["result"]
            assert not result["isError"]
            canvas = json.loads(result["content"][0]["text"])
            assert canvas["uploads"]["batch"] == ["original"]
            assert canvas["uploads"]["photos"][0]["name"] == "old-photo.png"
            assert "roadmap" not in canvas and "obsolete-route-marker" not in json.dumps(canvas)
        finally:
            await browser.close()
