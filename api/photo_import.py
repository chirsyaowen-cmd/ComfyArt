"""Durable thumbnail queue for photos imported from the canvas."""
import asyncio
import hashlib
import os
import logging
import sqlite3
import tempfile
from contextlib import closing, contextmanager
from pathlib import Path
from urllib.parse import urlencode

from aiohttp import web
from pillow_heif import get_file_mimetype

from ..runtime import DATA, routes
from ._common import bad_request, request_user
from .thumbs import thumb_for
from .heif import SUFFIXES

WAKE = web.AppKey("photo_import_wake", asyncio.Event)


@contextmanager
def database():
    with closing(sqlite3.connect(DATA / "photo-import.sqlite3", timeout=15)) as db, db:
        db.execute("CREATE TABLE IF NOT EXISTS photos (id TEXT PRIMARY KEY, filename TEXT NOT NULL, state TEXT NOT NULL)")
        yield db


def ref_for(filename):
    return {"filename": filename, "subfolder": "comfyart", "type": "input"}


def store(file, name):
    root = DATA / "input" / "comfyart"
    root.mkdir(parents=True, exist_ok=True)
    digest = hashlib.sha256()
    with tempfile.NamedTemporaryFile(dir=root, prefix=".import-", delete=False) as tmp:
        path = Path(tmp.name)
        try:
            while block := file.read(1024 * 1024):
                digest.update(block)
                tmp.write(block)
            tmp.close()
            key = digest.hexdigest()
            with database() as db:
                db.execute("BEGIN IMMEDIATE")
                row = db.execute("SELECT filename,state FROM photos WHERE id=?", (key,)).fetchone()
                if row and (root / row[0]).is_file():
                    return {"key": key, "ref": ref_for(row[0]), "state": row[1]}
                name = Path(name).name[-100:] or "photo"
                if get_file_mimetype(path).startswith(("image/heic", "image/heif")) and Path(name).suffix.lower() not in SUFFIXES:
                    name += ".heic"
                # Match original uploads saved before the thumbnail queue existed.
                prior = next((p for p in root.glob(key[:20] + "-*") if p.is_file() and not p.is_symlink()), None)
                dest = prior or root / (key[:20] + "-" + name)
                if prior is None:
                    os.replace(path, dest)
                db.execute("INSERT OR REPLACE INTO photos VALUES(?,?,'pending')", (key, dest.name))
            return {"key": key, "ref": ref_for(dest.name), "state": "pending"}
        finally:
            path.unlink(missing_ok=True)


def next_thumbnail():
    with database() as db:
        row = db.execute("SELECT id,filename FROM photos WHERE state='pending' ORDER BY rowid LIMIT 1").fetchone()
    if row is None:
        return False
    key, name = row
    try:
        thumb_for("/api/view?" + urlencode(ref_for(name)), 256)
        state = "ready"
    except Exception:
        logging.getLogger(__name__).exception("Thumbnail failed for photo %s", key)
        state = "failed"
    with database() as db:
        db.execute("UPDATE photos SET state=? WHERE id=?", (state, key))
    return True


async def import_worker(app):
    wake = app[WAKE] = asyncio.Event()

    async def run():
        while True:
            wake.clear()
            while await asyncio.to_thread(next_thumbnail):
                pass
            await wake.wait()

    task = asyncio.create_task(run())
    yield
    task.cancel()
    try:
        await task
    except asyncio.CancelledError:
        pass


@routes.post("/comfyart/photos")
async def upload_photo(request):
    request_user(request)
    fields = await request.post()
    photo = fields.get("image")
    if not isinstance(photo, web.FileField):
        raise bad_request("missing photo")
    result = await asyncio.to_thread(store, photo.file, photo.filename)
    request.app[WAKE].set()
    return web.json_response(result)


@routes.get("/comfyart/photos/{key}")
async def known_photo(request):
    request_user(request)
    key = request.match_info["key"]
    with database() as db:
        row = db.execute("SELECT filename,state FROM photos WHERE id=?", (key,)).fetchone()
    if not row or not (DATA / "input" / "comfyart" / row[0]).is_file():
        return web.json_response(None)
    return web.json_response({"key": key, "ref": ref_for(row[0]), "state": row[1]})


@routes.post("/comfyart/photos/status")
async def photo_status(request):
    request_user(request)
    keys = await request.json()
    if not isinstance(keys, list) or len(keys) > 500 or not all(isinstance(k, str) for k in keys):
        raise bad_request("expected up to 500 photo ids")
    with database() as db:
        rows = db.execute("SELECT id,state FROM photos WHERE id IN (" + ",".join("?" for _ in keys) + ")", keys)
        return web.json_response(dict(rows))


@routes.post("/comfyart/photos/{key}/retry")
async def retry_photo(request):
    request_user(request)
    with database() as db:
        db.execute("UPDATE photos SET state='pending' WHERE id=? AND state='failed'", (request.match_info["key"],))
    request.app[WAKE].set()
    return web.json_response(True)
