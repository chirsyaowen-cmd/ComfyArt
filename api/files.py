import asyncio
import hashlib
import mimetypes
import re
import os
import tempfile
from pathlib import Path
from urllib.parse import urlencode
from aiohttp import web

from ..runtime import DATA, confined, routes
from ._common import bad_request, request_user, view_path


def userfile(request, name):
    request_user(request)
    try:
        return confined(DATA / "userdata", name)
    except ValueError:
        raise web.HTTPForbidden()


@routes.get("/comfyart/userdata/{file:.*}")
async def read_userdata(request):
    path = userfile(request, request.match_info["file"])
    if not path.is_file():
        return web.Response(status=204)
    return web.FileResponse(path, headers={"Content-Disposition": "attachment", "Content-Type": "text/plain; charset=utf-8", "X-Content-Type-Options": "nosniff"})


@routes.post("/userdata/{file:.*}")
async def save_userdata(request):
    path = userfile(request, request.match_info["file"])
    body = await request.read()
    path.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile(dir=path.parent, delete=False) as tmp:
        tmp.write(body)
    os.replace(tmp.name, path)
    return web.json_response(True)


@routes.delete("/userdata/{file:.*}")
async def delete_userdata(request):
    userfile(request, request.match_info["file"]).unlink(missing_ok=True)
    return web.json_response(True)


@routes.get("/userdata")
async def list_userdata(request):
    path = userfile(request, request.query.get("dir", ""))
    entries = path.rglob("*") if request.query.get("recurse") == "true" else path.glob("*")
    return web.json_response(sorted(str(p.relative_to(path)) for p in entries if p.is_file()))


@routes.post("/upload/image")
async def upload(request):
    fields = await request.post()
    image = fields.get("image")
    if not isinstance(image, web.FileField):
        raise bad_request("missing uploaded file")
    content = image.file.read()
    name = hashlib.sha256(content).hexdigest()[:20] + "-" + Path(image.filename).name[-100:]
    root = DATA / "input" / "comfyart"
    root.mkdir(parents=True, exist_ok=True)
    (root / name).write_bytes(content)
    return web.json_response({"name": name, "type": "input", "subfolder": "comfyart"})


def media_page(kinds, search, after, limit):
    assets = []
    for kind in sorted(kinds):
        root = DATA / kind
        for path in root.rglob("*"):
            if not path.is_file() or path.is_symlink() or not path.resolve().is_relative_to(root):
                continue
            mime = mimetypes.guess_type(path.name)[0] or ""
            if not mime.startswith(("image/", "video/")):
                continue
            name = re.sub(r"^[a-f0-9]{20}-", "", path.name) if kind == "input" else path.name
            if search not in name.casefold() or re.fullmatch(r"review-[a-f0-9]{8}\.png", name):
                continue
            relative = path.relative_to(root)
            key = f"{kind}/{relative.as_posix()}"
            if key <= after:
                continue
            query = urlencode({"filename": path.name, "subfolder": relative.parent.as_posix(), "type": kind})
            assets.append({"id": key, "name": name, "mime_type": mime, "preview_url": "/api/view?" + query})
    assets.sort(key=lambda asset: asset["id"])
    return {"assets": assets[:limit], "next_cursor": assets[limit - 1]["id"] if len(assets) > limit else None}


@routes.get("/assets")
async def list_assets(request):
    request_user(request)
    query = request.query
    kinds = {"input", "output"}.intersection(query.get("tags_any", "input,output").split(","))
    try:
        limit = max(1, min(int(query.get("limit", 60)), 200))
    except ValueError:
        raise bad_request("invalid page size")
    page = await asyncio.to_thread(media_page, kinds, query.get("name_contains", "").casefold(),
                                   query.get("after", ""), limit)
    return web.json_response(page)


@routes.get("/view")
async def view(request):
    try:
        path = view_path(str(request.rel_url))
    except ValueError:
        raise web.HTTPNotFound()
    return web.FileResponse(path, headers={"X-Content-Type-Options": "nosniff",
                                          "Content-Security-Policy": "sandbox; default-src 'none'; style-src 'unsafe-inline'"})


@routes.get("/models/diffusion_models")
async def diffusion_models(request):
    return web.json_response([])


@routes.get("/comfyart/model-paths")
async def model_paths(request):
    return web.json_response({})
