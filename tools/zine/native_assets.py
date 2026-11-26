"""Register source photos and build editable native adjustment assets."""

import asyncio
import hashlib
import io
import json
import tempfile
from pathlib import Path
from urllib.parse import urlencode

import aiohttp
import numpy as np
from local_runtime import audit
from PIL import Image, ImageOps

ZERO_ADJUST = dict.fromkeys(
    "exposure contrast highlights shadows whites blacks saturation vibrance temperature tint sharpen clarity grain vignette bloom glamour".split(),
    0,
)


def native_recipe(treatment):
    steps = []
    if "duotone" in treatment:
        steps.append({"kind": "saturation", "value": -100})
    elif treatment.get("saturation", 1) != 1:
        steps.append(
            {"kind": "saturation", "value": round(100 * (treatment["saturation"] - 1))}
        )
    if treatment.get("contrast", 1) != 1:
        steps.append(
            {"kind": "contrast", "value": round(100 * (treatment["contrast"] - 1))}
        )
    if "duotone" in treatment:
        steps.append(
            {
                "kind": "gradientMap",
                "stops": [
                    {"position": i, "color": c}
                    for i, c in enumerate(treatment["duotone"])
                ],
            }
        )
    return steps


class CanvasAssets:
    def __init__(self, client, store, photos, trace):
        self.client = client
        self.store = store
        self.photos = {p["id"]: p for p in photos}
        self.trace = trace
        self.imports = {}
        self.adjustments = {}
        self.grain_url = None

    async def upload(self, data, name, mime="image/png"):
        form = aiohttp.FormData()
        form.add_field("image", data, filename=name, content_type=mime)
        async with self.client.post("/api/upload/image", data=form) as r:
            r.raise_for_status()
            response = await r.json()
        return "/api/view?" + urlencode(
            {
                "filename": response["name"],
                "type": response["type"],
                "subfolder": response["subfolder"],
            }
        )

    def add(self, url, name, size, mime):
        aid = "asset:" + hashlib.sha256(url.encode()).hexdigest()[:32]
        self.store[aid] = {
            "id": aid,
            "typeName": "asset",
            "type": "image",
            "meta": {},
            "props": {
                "name": name,
                "src": url,
                "w": size[0],
                "h": size[1],
                "mimeType": mime,
                "isAnimated": False,
            },
        }
        return aid

    async def source(self, photo_id):
        if photo_id in self.imports:
            return self.imports[photo_id]
        photo = self.photos[photo_id]
        path = Path(photo["file"])
        raw = path.read_bytes()
        key = hashlib.sha256(raw).hexdigest()
        async with self.client.get("/api/comfyart/photos/" + key) as response:
            response.raise_for_status()
            info = await response.json()
        if not info:
            form = aiohttp.FormData()
            form.add_field("image", raw, filename=path.name)
            async with self.client.post("/api/comfyart/photos", data=form) as response:
                response.raise_for_status()
                info = await response.json()
        for _ in range(120):
            if info["state"] != "pending":
                break
            await asyncio.sleep(0.25)
            async with self.client.get("/api/comfyart/photos/" + key) as response:
                response.raise_for_status()
                info = await response.json()
        if info["state"] != "ready" or info["key"] != key:
            raise RuntimeError("Photo import failed " + photo_id)
        url = "/api/view?" + urlencode(info["ref"])
        with Image.open(path) as src:
            size = ImageOps.exif_transpose(src).size
            mime = Image.MIME[src.format]
        aid = self.add(url, photo_id, size, mime)
        result = {
            "library": {**info, "name": photo_id},
            "aid": aid,
            "size": size,
            "url": url,
        }
        self.imports[photo_id] = result
        audit(self.trace, "photo.ready", photo=photo_id, sha256=key, size=size)
        return result

    async def treated(self, photo_id, treatment):
        source = await self.source(photo_id)
        recipe = native_recipe(treatment)
        if not recipe:
            return source["aid"], {}
        key = (photo_id, json.dumps(recipe, sort_keys=True))
        if key not in self.adjustments:
            from ComfyArt.api.photo_adjust import render

            with Image.open(self.photos[photo_id]["file"]) as im:
                buf = io.BytesIO()
                ImageOps.exif_transpose(im).convert("RGB").save(buf, "PNG")
            with tempfile.TemporaryDirectory() as temp:
                raw = await render(buf.getvalue(), recipe, Path(temp))
            url = await self.upload(raw, photo_id + "-toned.png")
            self.adjustments[key] = self.add(url, photo_id, source["size"], "image/png")
            audit(self.trace, "photo.adjusted", photo=photo_id, recipe=recipe)
        return self.adjustments[key], {
            "photoRecipe": recipe,
            "adjusted": {"source": source["aid"], "adjust": ZERO_ADJUST},
            "lastPhotoTool": recipe[-1]["kind"],
        }

    async def grain(self):
        if self.grain_url is None:
            rng = np.random.default_rng(7)
            tile = Image.fromarray(
                rng.normal(128, 43, (512, 512)).clip(0, 255).astype("uint8")
            )
            buf = io.BytesIO()
            tile.save(buf, "PNG")
            self.grain_url = await self.upload(buf.getvalue(), "paper-grain.png")
        return self.grain_url

    def paint(self, color, bindings):
        if not isinstance(color, dict):
            return color
        photo_id = bindings[color["sample"]]
        with Image.open(self.photos[photo_id]["file"]) as src:
            im = ImageOps.exif_transpose(src).convert("RGB")
            im.thumbnail((256, 256), Image.Resampling.LANCZOS)
            x, y = color["at"]
            rgb = im.getpixel((round(x * (im.width - 1)), round(y * (im.height - 1))))
        return "#%02x%02x%02x" % rgb
