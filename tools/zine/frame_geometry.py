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
