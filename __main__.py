import argparse
from pathlib import Path

from aiohttp import web

from . import runtime
from .api import bot, bot_complete, files, mcp, pdf, photo_import, projects, providers, settings, thumbs

DIST = Path(__file__).resolve().parent / "dist"


@web.middleware
async def local_only(request, handler):
    if request.url.host not in {"localhost", "127.0.0.1"}:
        raise web.HTTPForbidden()
    origin = request.headers.get("Origin")
    if origin and origin != f"{request.scheme}://{request.host}":
        raise web.HTTPForbidden()
    return await handler(request)


async def socket(request):
    sid = request.query.get("clientId")
    if not sid or sid in runtime.sockets:
        raise web.HTTPBadRequest(text="missing or duplicate client ID")
    ws = web.WebSocketResponse(heartbeat=30)
    await ws.prepare(request)
    runtime.sockets[sid] = ws
    try:
        async for _ in ws:
            pass
    finally:
        runtime.sockets.pop(sid, None)
    return ws


async def index(request):
    if not (DIST / "index.html").is_file():
        raise web.HTTPServiceUnavailable(text="Build the frontend with npm ci && npm run build")
    return web.FileResponse(DIST / "index.html", headers={"Cache-Control": "no-cache"})


async def redirect(request):
    raise web.HTTPFound("/comfyart/")


def create_app():
    app = web.Application(middlewares=[local_only], client_max_size=64 * 1024**2)
    app.cleanup_ctx.append(photo_import.import_worker)
    for route in runtime.routes:
        app.router.add_route(route.method, "/api" + route.path, route.handler, **route.kwargs)
    # Thumbnail URLs live in saved snapshots. The agent connects here over MCP.
    for route in runtime.routes:
        if route.path in {"/comfyart/mcp", "/comfyart/thumb", "/comfyart/pdf", "/comfyart/model-paths", "/view"}:
            app.router.add_route(route.method, route.path, route.handler)
    app.router.add_get("/ws", socket)
    app.router.add_get("/", redirect)
    app.router.add_get("/comfyart", redirect)
    app.router.add_get("/comfyart/", index)
    if (DIST / "assets").is_dir():
        app.router.add_static("/comfyart/assets", DIST / "assets")
    return app


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--port", type=int, default=8190)
    runtime.port = parser.parse_args().port
    runtime.DATA.mkdir(mode=0o700, parents=True, exist_ok=True)
    bot.reap_stale_messages()
    web.run_app(create_app(), host="127.0.0.1", port=runtime.port)
