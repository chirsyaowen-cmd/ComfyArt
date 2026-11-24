import asyncio
import json
import os
from typing import Any, Coroutine
from urllib.parse import parse_qs, urlparse

from pathlib import Path
from . import heif
from ..runtime import DATA, confined, routes
from aiohttp import web
_TASKS: set[asyncio.Task] = set()


def spawn(coro: Coroutine[Any, Any, None], name: str) -> None:
    task = asyncio.create_task(coro, name=name)
    _TASKS.add(task)
    task.add_done_callback(_TASKS.discard)


def app_path(*parts: str) -> str:
    return os.path.join(DATA, *parts)


def request_user(request: web.Request) -> str:
    if request.headers.get("Comfy-User", "default") != "default":
        raise web.HTTPForbidden(text="Standalone ComfyArt has a single local user")
    return "default"


def error(message: str, status: int) -> web.Response:
    return web.json_response({"error": message}, status=status)


def bad_request(message: str) -> web.HTTPBadRequest:
    return web.HTTPBadRequest(text=json.dumps({"error": message}), content_type="application/json")


async def json_body(request: web.Request) -> dict:
    try:
        body = await request.json()
    except ValueError:
        raise bad_request("invalid JSON body")
    if not isinstance(body, dict):
        raise bad_request("body must be an object")
    return body


def read_json(path: str, default):
    try:
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    except (OSError, ValueError):
        return default


def write_json(path: str, data) -> None:
    os.makedirs(os.path.dirname(path), exist_ok=True)
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False)
    os.replace(tmp, path)


def view_path(url: str, *, original=False) -> str:
    query = parse_qs(urlparse(url).query)
    name = (query.get("filename") or [""])[0]
    subfolder = (query.get("subfolder") or [""])[0]
    kind = (query.get("type") or ["output"])[0]
    if kind not in {"input", "output", "temp"} or not name or Path(name).name != name:
        raise ValueError("invalid media reference")
    path = confined(DATA / kind, str(Path(subfolder) / name))
    if not path.is_file():
        raise ValueError(f"file not found: {name}")
    if not original and path.suffix.lower() in heif.SUFFIXES:
        path = heif.rendition(path, DATA / "photo-renditions")
    return str(path)
