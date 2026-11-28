"""Read book geometry in binding order from the actual saved ComfyArt document."""

import math
from urllib.parse import quote, urlsplit

import aiohttp


def book_frames(snapshot):
    store = snapshot["document"]["store"]
    ids = store["document:document"]["meta"]["zinePages"]
    if not ids or len(ids) % 2 or len(set(ids)) != len(ids):
        raise ValueError("Invalid book page order in project")
    frames = []
    for key in ids:
        record = store.get(key, {})
        if record.get("type") != "frame" or record.get("typeName") != "shape":
            raise ValueError(f"Missing page frame {key}")
        frame = {
            "id": key,
            "w": record["props"]["w"],
            "h": record["props"]["h"],
            "x": record["x"],
            "y": record["y"],
        }
        if (
            not all(
                type(frame[k]) in (int, float) and math.isfinite(frame[k])
                for k in ("w", "h", "x", "y")
            )
            or min(frame["w"], frame["h"]) <= 0
        ):
            raise ValueError("Invalid geometry for " + key)
        frames.append(frame)
    return frames


async def read_project(url, project):
    if urlsplit(url).hostname not in ("localhost", "127.0.0.1", "::1"):
        raise ValueError("Use the local ComfyArt server")
    async with aiohttp.ClientSession(
        base_url=url, timeout=aiohttp.ClientTimeout(total=30)
    ) as client:
        async with client.get(
            "/api/comfyart/projects/" + quote(project, safe=""),
            headers={"Cache-Control": "no-cache"},
        ) as response:
            response.raise_for_status()
            snapshot = await response.json()
            return (
                book_frames(snapshot),
                snapshot["document"]["store"]["document:document"]["meta"],
                response.headers.get("ETag"),
            )


def spread_geometry(left, right):
    return {
        "size": [left["w"] + right["w"], max(left["h"], right["h"])],
        "spine": left["w"],
        "pages": [
            {"id": p["id"], "x": x, "y": 0, "w": p["w"], "h": p["h"]}
            for x, p in [(0, left), (left["w"], right)]
        ],
    }


IDENTITY = (1, 0, 0, 1, 0, 0)


def point(m, x, y):
    a, b, c, d, e, f = m
    return a * x + c * y + e, b * x + d * y + f


def compose(m, n):
    a, b, c, d, e, f = m
    u, v, w, z, x, y = n
    return (
        a * u + c * v,
        b * u + d * v,
        a * w + c * z,
        b * w + d * z,
        a * x + c * y + e,
        b * x + d * y + f,
    )


def rotate_box(box, degrees):
    x, y, w, h = box
    cx = x + w / 2
    cy = y + h / 2
    a = math.radians(degrees)
    co = math.cos(a)
    si = math.sin(a)
    return co, si, -si, co, cx - co * cx + si * cy, cy - si * cx - co * cy


def bounds(points):
    xs, ys = zip(*points)
    return min(xs), min(ys), max(xs), max(ys)


def intersects(points, page):
    x, y, r, b = bounds(points)
    return (
        r > page["x"] + 1e-7
        and x < page["x"] + page["w"] - 1e-7
        and b > 1e-7
        and y < page["h"] - 1e-7
    )


def editorial_pages(design, targets):
    """Resolve typed editorial slots against the same transformed boxes as the importer."""
    roles = {s["id"]: s["role"] for s in design["slots"] if s.get("role")}
    if any("minDigits" in s and s.get("role") != "pageNumber" for s in design["slots"]):
        raise ValueError("minDigits belongs to a pageNumber slot")
    if not roles:
        return {}
    if any(s["kind"] != "text" for s in design["slots"] if s.get("role")):
        raise ValueError("Editorial roles require text slots")
    groups = {g["id"]: g["layers"] for g in design["components"]}
    result = {}
    for spread, target in zip(design["spreads"], targets, strict=True):
        for layer in spread["layers"]:
            matrix = layer.get("matrix", IDENTITY)
            layers = groups[layer["component"]] if layer["kind"] == "use" else [layer]
            for item in layers:
                slot = item.get("slot")
                if slot not in roles:
                    continue
                x, y, w, h = item["box"]
                transform = compose(matrix, rotate_box(item["box"], item.get("rotation", 0)))
                corners = [point(transform, a, b) for a in (x, x + w) for b in (y, y + h)]
                pages = [n for p, n in zip(target["geometry"]["pages"], target["pageNumbers"])
                         if intersects(corners, p)]
                if len(pages) != 1 or slot in result and result[slot] != pages[0]:
                    raise ValueError(f"{slot}: use a separate editorial slot inside each physical page")
                result[slot] = pages[0]
                if roles[slot] == "bookTitle" and pages != [1]:
                    raise ValueError(f"{slot}: move the front cover title to physical page 1 (right of the cover spine)")
    return result


def checked_frames(book):
    frames = book["frames"]
    expected = [
        (frames[-1]["id"], frames[0]["id"]),
        *[(a["id"], b["id"]) for a, b in zip(frames[1:-1:2], frames[2:-1:2])],
    ]
    spreads = [tuple(s["pageIds"]) for d in book["designs"] for s in d["spreads"]]
    if (
        len(frames) % 2
        or len(set(f["id"] for f in frames)) != len(frames)
        or sorted(expected) != sorted(spreads)
    ):
        raise ValueError("Spread pairs do not match the measured book frames")
    if book["size"] != spread_geometry(frames[-1], frames[0])["size"]:
        raise ValueError("Default spread size does not match measured cover")
    return frames
