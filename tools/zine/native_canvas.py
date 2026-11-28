"""Compile reusable spread layers into native ComfyArt records and save a new project."""

import json
import math
import time
from collections import Counter
from pathlib import Path

import aiohttp
from bind_photos import validate
from canvas_records import positions, schema_from, shape
from frame_geometry import IDENTITY, bounds, checked_frames, compose, intersects, native_box_transform, point, spread_geometry
from layout_schema import check_design, discard_legacy_steps, validate_schema
from local_runtime import audit, configure
from native_assets import CanvasAssets


def native_id(page_id):
    return page_id if page_id.startswith("shape:") else "shape:" + page_id


def vector(kind, w, h, fill, stroke="", sw=0, radius=0, d="", image=""):
    return {
        "w": w,
        "h": h,
        "kind": kind,
        "fill": fill,
        "radius": radius,
        "sides": 5,
        "fillType": "image" if image else "solid",
        "stops": [],
        "image": image,
        "blend": "normal",
        "angle": 0,
        "stroke": stroke if stroke != "none" else "",
        "strokeWidth": sw,
        "strokeAlign": "center",
        "dash": "solid",
        "d": d,
    }


def image_props(w, h, aid, crop, flip, name):
    return {
        "w": w,
        "h": h,
        "assetId": aid,
        "playing": True,
        "url": "",
        "crop": crop,
        "flipX": flip,
        "flipY": False,
        "altText": name,
    }


def image_geometry(box, source, fit, anchor, clip):
    x, y, w, h = box
    sw, sh = source
    scale = (max if fit == "cover" else min)(w / sw, h / sh)
    iw, ih = sw * scale, sh * scale
    bias = {"min": 0, "mid": 0.5, "max": 1}
    ix = x + (w - iw) * bias[anchor[:3]]
    iy = y + (h - ih) * bias[anchor[3:].lower()]
    a, b, r, t = max(x, ix), max(y, iy), min(x + w, ix + iw), min(y + h, iy + ih)
    if clip:
        cx, cy, cw, ch = clip
        a, b, r, t = max(a, cx), max(b, cy), min(r, cx + cw), min(t, cy + ch)
    if a >= r or b >= t:
        raise ValueError("Photo clipping rectangle does not intersect its image")
    limit = lambda z: max(0, min(1, z))
    crop = {
        "topLeft": {"x": limit((a - ix) / iw), "y": limit((b - iy) / ih)},
        "bottomRight": {"x": limit((r - ix) / iw), "y": limit((t - iy) / ih)},
    }
    return (a, b, r - a, t - b), crop


class Spread:
    def __init__(
        self, store, assets, spread, design, bindings, frame_order, legacy_size=None
    ):
        self.store = store
        self.assets = assets
        self.s = spread
        self.bindings = bindings
        self.components = {c["id"]: c for c in design["components"]}
        self.mirrored_text = []
        self.counts = Counter()
        left, right = [store[native_id(p)] for p in spread["pageIds"]]
        self.is_cover = native_id(spread["pageIds"][1]) == frame_order[0]
        self.pages = spread_geometry(
            dict(id=left["id"], **left["props"]), dict(id=right["id"], **right["props"])
        )["pages"]
        self.scale = 1
        self.offsets = [0, 0]
        if legacy_size is not None:
            # Historical v2 books used a virtual spread scaled into the standard paper.
            w, h = legacy_size
            self.scale = min(
                left["props"]["h"] / h,
                right["props"]["h"] / h,
                2 * min(left["props"]["w"], right["props"]["w"]) / w,
            )
            self.offsets = [
                (p["w"] - w / 2 * self.scale) * (0.5 if self.is_cover else 1 - i)
                for i, p in enumerate(self.pages)
            ]
            self.pages = [
                dict(p, x=i * w / 2, w=w / 2, h=h) for i, p in enumerate(self.pages)
            ]

    def add(self, sid, kind, parent, x, y, props, meta, rotation=0, opacity=1):
        self.counts[parent] += 1
        node = shape(sid, kind, parent, self.counts[parent], x, y, props, meta)
        node.update(rotation=rotation, opacity=opacity)
        self.store[sid] = node
        return sid

    async def paint(self, l, parent, side, m, instance=None):
        kind = l["kind"]
        page = self.pages[side]
        origin = page["x"]
        sid = "shape:" + ":".join(
            [self.s["id"], str(side), *([instance] if instance else []), l["id"]]
        )
        meta = {
            "name": l["name"],
            "specElementId": l["id"],
            "spreadId": self.s["id"],
            "slotId": l.get("slot", ""),
        }
        if instance:
            meta["instanceId"] = instance
        if kind == "use":
            m = compose(m, l["matrix"])
            group = self.add(
                sid,
                "group",
                parent,
                0,
                0,
                {},
                dict(meta, componentId=l["component"]),
                opacity=l.get("opacity", 1),
            )
            for item in self.components[l["component"]]["layers"]:
                await self.paint(item, group, side, m, l["id"])
            if not self.counts[group]:
                del self.store[group]
                return
        elif kind == "path":
            pts = [point(m, *p) for p in l["points"]]
            x, y, r, b = bounds(pts)
            half = l["sw"] * max(math.hypot(m[0], m[1]), math.hypot(m[2], m[3])) / 2
            if not intersects([(x - half, y - half), (r + half, b + half)], page):
                return
            w = max(r - x, 0.01)
            h = max(b - y, 0.01)
            path = " ".join(
                ("M" if i == 0 else "L") + " %.9f %.9f" % ((px - x) / w, (py - y) / h)
                for i, (px, py) in enumerate(pts)
            ) + (" Z" if l.get("closed") else "")
            props = vector(
                "path",
                w * self.scale,
                h * self.scale,
                self.assets.paint(l.get("fill", "none"), self.bindings),
                l["stroke"],
                l["sw"] * self.scale,
                d=path,
            )
            self.add(
                sid,
                "ca-shape",
                parent,
                (x - origin) * self.scale,
                y * self.scale,
                props,
                meta,
                opacity=l.get("opacity", 1),
            )
        else:
            box = l["box"]
            m, needs_outline = native_box_transform(l, m, sid)
            if needs_outline:
                x, y, w, h = box
                outline = {
                    **l, "kind": "path", "closed": True, "stroke": "none", "sw": 0,
                    "points": [(x, y), (x + w, y), (x + w, y + h), (x, y + h)],
                }
                await self.paint(outline, parent, side, m, instance)
                return
            if kind in ("photo", "png"):
                if kind == "png":
                    src = await self.assets.decoration(l["asset"])
                    # Determine occupied pixels before splitting a wide placement at the fold.
                    box, _ = image_geometry(box, src["size"], "contain", "midMid", None)
                else:
                    photo_id = self.bindings[l["slot"]]
                    src = await self.assets.source(photo_id)
                if not intersects(
                    [
                        point(m, box[0] + i * box[2], box[1] + j * box[3])
                        for i, j in ((0, 0), (1, 0), (1, 1), (0, 1))
                    ],
                    page,
                ):
                    return
                clip = l.get("clip")
                if abs(m[1]) + abs(m[2]) < 1e-9 and m[0] > 0 and m[3] > 0:
                    # Use photo crop coordinates at the spine. Coincident frame masks can
                    # otherwise collapse to a triangle in the editor's polygon intersection.
                    a, b, w, h = clip or box
                    left = max(a, (origin - m[4]) / m[0])
                    right = min(a + w, (origin + page["w"] - m[4]) / m[0])
                    if right - left <= 1e-7:
                        return
                    clip = [left, b, right - left, h]
                box, crop = image_geometry(
                    box,
                    src["size"],
                    l.get("fit", "contain"),
                    l.get("anchor", "midMid"),
                    clip,
                )
            x, y, w, h = box
            pts = [
                point(m, x + i * w, y + j * h)
                for i, j in ((0, 0), (1, 0), (1, 1), (0, 1))
            ]
            if not intersects(pts, page):
                return
            a, b, c, d, _, _ = m
            xscale = math.hypot(a, b)
            yscale = math.hypot(c, d)
            flip = a * d - b * c < 0
            angle = math.atan2(-b if flip else b, -a if flip else a)
            w *= xscale * self.scale
            h *= yscale * self.scale
            px, py = pts[1] if flip else pts[0]
            px = (px - origin) * self.scale
            py *= self.scale
            opacity = l.get("opacity", 1)
            if kind in ("photo", "png"):
                if kind == "png":
                    aid = src["aid"]
                    info = src["info"]
                    label = (
                        info.get("provider", "Vecteezy") + " 预览"
                        if info["origin"] == "search-preview"
                        else info.get("provider", "Vecteezy") + " 上传原件"
                    )
                    meta.update(decoration=info, name=l["name"] + " · " + label)
                else:
                    aid, extra = await self.assets.treated(
                        photo_id, l.get("treatment", {})
                    )
                    meta.update(
                        extra, photoKey=src["library"]["key"], sourceSlot=l["slot"]
                    )
                radius = l.get("radius", 0) * self.scale
                if radius:
                    mask = self.add(
                        sid + "-mask",
                        "frame",
                        parent,
                        px,
                        py,
                        {"w": w, "h": h, "name": "", "color": "black"},
                        {
                            "name": l["name"] + " · 圆角蒙版",
                            "style": {
                                "fill": "transparent",
                                "stroke": "transparent",
                                "radius": radius,
                            },
                        },
                        angle,
                    )
                    parent = mask
                    px = py = angle = 0
                self.add(
                    sid,
                    "image",
                    parent,
                    px,
                    py,
                    image_props(w, h, aid, crop, flip, meta["name"]),
                    meta,
                    angle,
                    opacity,
                )
            elif kind == "text":
                align = l.get("align", "left")
                if flip:
                    align = {"left": "right", "right": "left", "center": "center"}[
                        align
                    ]
                    self.mirrored_text.append(sid)
                props = {
                    "w": w,
                    "h": h,
                    "text": self.bindings[l["slot"]],
                    "font": {
                        "serif": "Noto Serif SC",
                        "sans": "Noto Sans SC",
                        "hand": "Ma Shan Zheng",
                        "mono": "Courier New",
                    }[l.get("family", "serif")],
                    "weight": 400,
                    "size": l["size"] * self.scale * yscale,
                    "color": self.assets.paint(l["fill"], self.bindings),
                    "stroke": "",
                    "align": align,
                    "letter": 0,
                    "line": 1.22,
                    "autoSize": False,
                    "decoration": "none",
                    "transform": "none",
                    "rich": None,
                }
                self.add(
                    sid,
                    "ca-text",
                    parent,
                    px,
                    py,
                    props,
                    dict(meta, mirrorX=flip),
                    angle,
                    opacity,
                )
            else:
                texture = kind == "texture"
                props = vector(
                    "rect" if texture else kind,
                    w,
                    h,
                    self.assets.paint(l.get("fill", "none"), self.bindings),
                    l.get("stroke", ""),
                    l.get("sw", 1) * self.scale,
                    min(l.get("radius", 0) * self.scale, w / 2, h / 2),
                    image=await self.assets.grain() if texture else "",
                )
                self.add(sid, "ca-shape", parent, px, py, props, meta, angle, opacity)

    async def install(self):
        for side, page_id in enumerate(self.s["pageIds"]):
            frame = native_id(page_id)
            x = self.offsets[side]
            area = self.add(
                frame + ":paper",
                "group",
                frame,
                x,
                0,
                {},
                {"name": self.s["name"] + " · 版心"},
            )
            for l in self.s["layers"]:
                await self.paint(l, area, side, IDENTITY)


async def import_book(
    spec_path,
    photo_path,
    binding_path,
    trace,
    url,
    database,
    project_id,
    title,
    references=None,
):
    from urllib.parse import urlparse

    if urlparse(url).hostname not in ("127.0.0.1", "localhost", "::1"):
        raise ValueError("Use a local ComfyArt server")
    configure()
    spec = json.loads(spec_path.read_text())
    photos = json.loads(photo_path.read_text())
    bindings = json.loads(binding_path.read_text())
    discard_legacy_steps(spec)
    validate_schema(spec)
    validate(spec, photos, bindings)
    for design in spec["designs"]:
        check_design(design, [(s["id"], s["pageIds"]) for s in design["spreads"]])
    spreads = [s for d in spec["designs"] for s in d["spreads"]]
    if "frames" in spec:
        pages = checked_frames(spec)
    else:
        # Old exported files have no native frame metadata.
        ids = sorted(
            (p for s in spreads for p in s["pageIds"]),
            key=lambda p: int(p.removeprefix("page-")),
        )
        if len(ids) != len(set(ids)):
            raise ValueError("Repeated book page IDs")
        pages = [
            {"id": p, "x": x, "y": y, "w": 480, "h": 680}
            for p, (x, y) in zip(ids, positions(len(ids)))
        ]
    if len(pages) < 8 or len(pages) % 2:
        raise ValueError("Unsupported ComfyArt book length")
    frames = [native_id(p["id"]) for p in pages]
    page = "page:book"
    store = {
        page: {"typeName": "page", "id": page, "name": title, "index": "a1", "meta": {}}
    }
    paper = {p: s["paper"] for s in spreads for p in s["pageIds"]}
    for i, (fid, p) in enumerate(zip(frames, pages)):
        store[fid] = shape(
            fid,
            "frame",
            page,
            i + 1,
            p["x"],
            p["y"],
            {"w": p["w"], "h": p["h"], "name": str(i + 1), "color": "black"},
            {"style": {"fill": paper[p["id"]], "stroke": "#cecac1"}},
        )
    warnings = []
    start = time.monotonic()
    audit(
        trace,
        "canvas.begin",
        project=project_id,
        spreads=len(spreads),
        pages=len(frames),
    )
    endpoint = "/api/comfyart/projects/" + project_id
    async with aiohttp.ClientSession(
        base_url=url, timeout=aiohttp.ClientTimeout(total=120)
    ) as client:
        async with client.get(endpoint) as current:
            if current.status != 404:
                raise ValueError(f"New project expected; GET returned {current.status}")
        assets = CanvasAssets(client, store, photos, trace)
        assets.png_dir = spec_path.parent / "zine-png"
        for d in spec["designs"]:
            values = bindings[d["spreads"][0]["id"]]
            for s in d["spreads"]:
                t = time.monotonic()
                spread = Spread(
                    store,
                    assets,
                    s,
                    d,
                    values,
                    frames,
                    None if "frames" in spec else spec["size"],
                )
                await spread.install()
                if spread.mirrored_text:
                    warnings.extend(spread.mirrored_text)
                audit(
                    trace,
                    "spread.created",
                    spread=s["id"],
                    name=s["name"],
                    pageIds=s["pageIds"],
                    shapeInstances=sum(spread.counts.values()),
                    seconds=round(time.monotonic() - t, 2),
                )
        cover_urls = (
            [next(iter(assets.imports.values()))["url"]] if assets.imports else []
        )
        library = [p["library"] for p in assets.imports.values()]
        catalog = {
            key: {
                "photoKey": p["library"]["key"],
                "source": assets.photos[key].get("source"),
                "credit": assets.photos[key].get("credit"),
                "name": key,
            }
            for key, p in assets.imports.items()
        }
        meta = {
            "zinePages": frames,
            "zine_spec": spec,
            "zineBindings": bindings,
            "zineBindingPhotos": catalog,
            "projectPhotos": {"photos": library, "batch": [p["key"] for p in library]},
        }
        if references is not None:
            from PIL import Image

            source_rows = json.loads(references.read_text())
            binding = json.loads((references.parent / "装订顺序.json").read_text())
            spread_ids = {
                key: f"spread-{i + 1:02}"
                for i, key in enumerate([binding["cover"], *binding["spreads"]])
            }
            real_spreads = {s["id"] for s in spreads}
            meta["references"] = []
            meta["zineReferenceSources"] = {}
            for row in source_rows:
                spread_id = spread_ids[row["id"]]
                if spread_id not in real_spreads:
                    raise ValueError("Unknown reference spread " + spread_id)
                if "savedReference" in row:
                    ref = row["savedReference"]
                    if ref not in meta["references"]:
                        meta["references"].append(ref)
                    meta["zineReferenceSources"][spread_id] = {
                        "referenceKey": row["imageUrl"],
                        "sourcePageUrl": row["pin"],
                        "paperBoundsPx": row.get("referenceBox"),
                    }
                    continue
                path = Path(row["reference"])
                with Image.open(path) as im:
                    mime = Image.MIME[im.format]
                    im.verify()
                src = await assets.upload(path.read_bytes(), path.name, mime)
                meta["references"].append(
                    {
                        "src": src,
                        "key": row["imageUrl"],
                        "source": "search",
                        "name": row["id"],
                        "imageUrl": row["imageUrl"],
                        "sourcePageUrl": row["pin"],
                    }
                )
                meta["zineReferenceSources"][spread_id] = {
                    "referenceKey": row["imageUrl"],
                    "sourcePageUrl": row["pin"],
                    "paperBoundsPx": row.get("referenceBox"),
                }
        if assets.decorations:
            meta["zineDecorations"] = {
                key: value["info"] for key, value in assets.decorations.items()
            }
            if any(
                value["info"]["origin"] == "search-preview"
                for value in assets.decorations.values()
            ):
                title += " · 素材预览稿"
                store[page]["name"] = title
        store["document:document"] = {
            "typeName": "document",
            "id": "document:document",
            "name": title,
            "gridSize": 10,
            "meta": meta,
        }
        snapshot = {"document": {"schema": schema_from(database), "store": store}}
        # The API uses compare-and-set. A create with no prior revision cannot overwrite another writer.
        async with client.put(
            endpoint, json={"name": title, "covers": cover_urls, "snapshot": snapshot}
        ) as r:
            r.raise_for_status()
        async with client.get(endpoint) as r:
            r.raise_for_status()
            saved = await r.json()
        if saved != snapshot:
            raise RuntimeError("Saved book differs from the submitted snapshot")
        urls = {r["props"]["src"] for r in store.values() if r["typeName"] == "asset"}
        if assets.grain_url:
            urls.add(assets.grain_url)
        for src in sorted(urls):
            async with client.get(src) as r:
                r.raise_for_status()
                import io

                from PIL import Image

                Image.open(io.BytesIO(await r.read())).verify()
        counts = Counter(r["type"] for r in store.values() if r["typeName"] == "shape")
        audit(
            trace,
            "canvas.readback",
            project=project_id,
            spreads=len(spreads),
            pages=len(frames),
            sourcePhotos=len(assets.imports),
            verifiedMedia=len(urls),
            counts=dict(counts),
            seconds=round(time.monotonic() - start, 2),
        )
        if warnings:
            audit(
                trace,
                "canvas.compatibility",
                detail="Native text keeps readable glyphs inside horizontally reflected instances. Placement is reflected.",
                elements=warnings,
            )
        return dict(
            project=project_id,
            url=url + "/comfyart/?project=" + project_id,
            counts=dict(counts),
        )
