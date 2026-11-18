import hashlib
import os
import tempfile
from pathlib import Path
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
