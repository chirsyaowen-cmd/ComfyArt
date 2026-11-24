import logging
import re
from urllib.parse import urlencode

from .. import runtime

from ..bot.turns import TurnRunner
from . import chat_store, memory_store
from ._common import spawn
from .settings import SETTINGS_SPEC, get_setting

_log = logging.getLogger(__name__)


# Bind the websocket editor's revision lease to this turn's MCP URL, including queued turns.
_roadmap_turns: dict[str, str] = {}


def broadcast(event: str, payload: dict) -> None:
    if event == "turn_start":
        token = next((b["token"] for b in payload["user_message"]["blocks"] if b.get("type") == "roadmap_turn"), "")
        _roadmap_turns[payload["chat_id"]] = token
    elif event == "turn_done":
        _roadmap_turns.pop(payload["chat_id"], None)
    try:
        runtime.send_event("comfyart-bot", {"event": event, **payload})
    except Exception:
        _log.exception("[ComfyArt/bot] broadcast failed")


def _mcp_endpoint(chat_id: str) -> str:
    query = {"bot_chat": chat_id}
    if token := _roadmap_turns.get(chat_id):
        query["roadmap_turn"] = token
    return f"http://127.0.0.1:{runtime.port}/comfyart/mcp?{urlencode(query)}"


def provider_model(provider_id: str) -> str:
    key = f"bot-model-{provider_id}"
    return str(get_setting(key) or "").strip() if key in SETTINGS_SPEC else ""


def blocks_text(blocks: list[dict]) -> str:
    parts = []
    for b in blocks:
        kind = b.get("type")
        if kind == "text":
            parts.append(str(b.get("text") or ""))
        elif kind in ("image", "video", "audio"):
            parts.append(f"[attached {kind}: {b.get('url') or ''}]")
        elif kind == "file":
            parts.append(f"[attached document {b.get('name') or ''}: {b.get('url') or ''}]")
        elif kind == "notice" and b.get("text"):
            parts.append(f"[notice: {b.get('text')}]")
    return "\n".join(p for p in parts if p.strip()).strip()


_WRITE_TOOL_RE = re.compile(
    r"\b(generate_image|generate_video|edit_image|animate_image|upscale_image|"
    r"remove_background|expand_image|split_layers|place_html|create_slides|"
    r"add_text|add_shape|create_frame|update_shapes|delete_shapes)\b")


def unverified_write_notice(blocks: list[dict]) -> dict | None:
    if any(b.get("type") == "tool_use" for b in blocks):
        return None
    text = "\n".join(str(b.get("text") or "") for b in blocks if b.get("type") == "text")
    if not _WRITE_TOOL_RE.search(text):
        return None
    return {"type": "notice", "level": "warn",
            "text": "This turn made no tool calls, so nothing it describes was "
                    "actually done — the canvas is unchanged."}


class ProjectTurnRunner(TurnRunner):
    def begin(self, chat, *, text, provider_text, attachments, user_msg):
        # begin is called again when a queued message actually gets its turn.
        prompt, token = memory_store.turn_context(chat, provider_text if provider_text is not None else text)
        return super().begin({**chat, "resume_token": token}, text=text, provider_text=prompt,
                             attachments=attachments, user_msg=user_msg)


RUNNER = ProjectTurnRunner(
    label="ComfyArt", mcp_name="comfyart", store=chat_store, broadcast=broadcast, spawn=spawn,
    mcp_endpoint=_mcp_endpoint, comfy_mcp_argv=list, provider_model=provider_model,
    replay_text=blocks_text, finish_notice=unverified_write_notice,
)
ACTIVE_TURNS = RUNNER.active
QUEUED = RUNNER.queued
