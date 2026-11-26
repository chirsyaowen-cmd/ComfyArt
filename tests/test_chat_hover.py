import asyncio
from pathlib import Path

import pytest
from aiohttp.test_utils import TestServer

from ComfyArt.__main__ import create_app
from ComfyArt.api import chat_store
from ComfyArt.bot.providers import BotEvent


async def test_hovering_message_actions_keeps_text_and_scroll_position(fake_provider):
    pw = pytest.importorskip("playwright.async_api")
    project = "chat-hover"
    chat = chat_store.create_chat(user="default", project=project, provider=fake_provider.id)
    for i in range(12):
        for role in ("user", "assistant"):
            chat_store.create_message(chat_id=chat["id"], role=role,
                                      blocks=[{"type": "text", "text": f"{role} message {i}"}])

    async with TestServer(create_app()) as server, pw.async_playwright() as playwright:
        chrome = Path("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome")
        browser = await playwright.chromium.launch(executable_path=str(chrome) if chrome.exists() else None)
        try:
            page = await browser.new_page(locale="en-US")
            await page.goto(str(server.make_url(f"/comfyart/?project={project}&new=1")))
            reply = page.get_by_text("assistant message 11", exact=True)
            prompt = page.get_by_text("user message 11", exact=True)
            await pw.expect(reply).to_be_in_viewport()
            await page.locator(".ca-agent__head").hover()
            viewport = page.locator(".ca-chat")
            await pw.expect(viewport).to_be_visible()
            measure = "el => [el.scrollTop, el.scrollHeight, el.clientHeight]"
            baseline = await viewport.evaluate(measure)
            assert baseline[0] > 0
            assert abs(baseline[0] + baseline[2] - baseline[1]) <= 1
            reply_top = (await reply.bounding_box())["y"]
            for target in (reply, prompt, page.locator(".ca-agent__head")):
                await target.hover()
                assert await viewport.evaluate(measure) == baseline
                assert (await reply.bounding_box())["y"] == reply_top

            await prompt.hover()
            await page.locator(".ca-chat__user").last.get_by_title("Edit again").click()
            await pw.expect(page.locator(".ca-agent textarea")).to_have_value("user message 11")
            await reply.hover()
            await page.locator(".ca-chat__bot").last.get_by_title("Task Details").click()
            await pw.expect(page.get_by_text("Original request", exact=True)).to_be_visible()

            await page.keyboard.press("Escape")
            fake_provider.script = [BotEvent(t="delta", text="New reply. " * 180)]
            fake_provider.gate = asyncio.Event()
            await page.locator(".ca-agent textarea").press("Enter")
            await pw.expect(page.get_by_text("New reply.", exact=False).last).to_be_visible()
            await pw.expect(page.locator(".ca-chat__thinking")).to_be_in_viewport(ratio=1)
            assert (await viewport.evaluate(measure))[0] > baseline[0]
        finally:
            if fake_provider.gate:
                fake_provider.gate.set()
            await browser.close()
