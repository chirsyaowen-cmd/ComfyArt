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
            await page.goto(str(server.make_url("/comfyart/?project=photo-review-test&new=1&format=zine")))
            source = page.get_by_role("button", name="Choose photos from device")
            project = page.get_by_role("button", name="Choose from project photos")
            await playwright.expect(source).to_be_visible(timeout=15000)
            await playwright.expect(page.locator(".ca-zine-photo button")).to_have_text(["Choose photos from device"])
            async def roadmap():
                response = await page.request.get(str(server.make_url("/api/comfyart/projects/photo-review-test")))
                return (await response.json())["document"]["store"]["document:document"]["meta"]["roadmap"]

            before = await roadmap()
            async with page.expect_file_chooser() as event:
                await source.click()
            chooser = await event.value
            await chooser.set_files([])
            await chooser.element.dispatch_event("cancel")
            assert await roadmap() == before
            await playwright.expect(source).to_be_visible()
            async with page.expect_file_chooser() as event:
                await source.click()
            chooser = await event.value
            photo = BytesIO()
            Image.new("RGB", (80, 60), "green").save(photo, "PNG")
            await chooser.set_files({"name": "leaf.png", "mimeType": "image/png", "buffer": photo.getvalue()})
            photo_button = page.locator(".ca-photo-import").get_by_role("button", name="leaf.png")
            await playwright.expect(photo_button).to_be_visible()
            await page.get_by_role("button", name="Add", exact=True).click()
            await page.get_by_role("button", name="Canvas Review", exact=True).click()
            await playwright.expect(project).to_have_count(0)
            await playwright.expect(page.get_by_role("button", name="Suggest a photo")).to_have_count(0)
            await playwright.expect(page.locator(".ca-zine-photo button")).to_have_count(0)
            await photo_button.click()
        finally:
            await browser.close()
