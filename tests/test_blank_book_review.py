from io import BytesIO

import pytest
from aiohttp.test_utils import TestServer
from PIL import Image

from ComfyArt.__main__ import create_app


async def test_blank_book_review_opens_file_chooser_and_places_selected_project_photo():
    playwright = pytest.importorskip("playwright.async_api")
    async with TestServer(create_app()) as server, playwright.async_playwright() as pw:
        browser = await pw.chromium.launch()
        try:
            page = await browser.new_page(locale="en-US")
            await page.goto(str(server.make_url("/comfyart/?project=photo-review-test&new=1&format=zine")))
            await page.get_by_role("button", name="Add", exact=True).click()
            await page.get_by_role("button", name="Canvas Review", exact=True).click()
            source = page.get_by_role("button", name="Choose photos from device")
            project = page.get_by_role("button", name="Choose from project photos")
            await playwright.expect(project).to_have_count(0)
            async with page.expect_file_chooser() as event:
                await source.click()
            photo = BytesIO()
            Image.new("RGB", (80, 60), "green").save(photo, "PNG")
            chooser = await event.value
            await chooser.set_files({"name": "leaf.png", "mimeType": "image/png", "buffer": photo.getvalue()})
            await project.click()
            grid = page.locator(".ca-zine-photo")
            await grid.get_by_role("button", name="leaf.png").click()
            await playwright.expect(source).to_have_count(0)
            await playwright.expect(page.get_by_role("button", name="Choose from project photos")).to_have_count(0)
        finally:
            await browser.close()
