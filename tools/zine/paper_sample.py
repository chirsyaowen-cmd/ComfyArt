"""Locate exposed paper with DSH; measure that paper in the cropped source pixels."""

import base64
import hashlib
import io
import json
import math
from pathlib import Path

import numpy as np
from harness_json import request
from local_runtime import write_json
from PIL import Image, ImageCms, ImageDraw, ImageOps

LOCATE = """你是 ComfyArt 纸张取色校样员。只定位图片中纸页本身干净露纸的位置。图的坐标范围是提供的整张图，从左上(0,0)至右下(1,1)。避开所有照片（包括照片里的白墙、天空）、标题底板、彩色色块、文字、页码、边线、装订阴影、书外的桌面。优先纸边内侧留白、栏间或外侧连续纸边，尤其是最少受阴影的位置。找三处至五处代表同一纸底的点，各点在足够宽的空白内部，尽量分散；只有一页露纸时均从该页取。只有小面积露纸时可少到两处。两边仅是受光不同时选较少受阴影的纸本色。如果分不清纸底与覆色、左右确实用了两种不同颜色的纸，或没有可识别露纸，请如实报不可判。提交这些观察字段 {"visible":true,"points":[{"xy":[0.00,0.00],"where":"指明哪个留白区域"}],"reason":"选区依据"}。不可判时 visible=false、points=[]，reason 说明情况。不要输出或猜测色值。"""
CHECK = """对照无标记原图和标注图逐点复核。红圈中心是取样位置。保留附近确实是未印刷、光照具有代表性的纸页的点。剔除照片、油墨、桌面、装订阴影和显著偏暗的点。不要因为一个坏点而丢掉其余明确有效的点。提交 {"accepted":[从1开始的合格点编号],"consistent":true,"reason":"逐点说明取舍，若不足两点指出可重选的区域"}。只有保留的点确实代表同一种纸时 consistent 才为 true。辨别失败的点不要列入。"""


def image_block(image):
    image = image.copy()
    image.thumbnail((1400, 1200), Image.Resampling.LANCZOS)
    buf = io.BytesIO()
    image.convert("RGB").save(buf, "JPEG", quality=92)
    return {
        "type": "image",
        "mimeType": "image/jpeg",
        "data": base64.b64encode(buf.getvalue()).decode(),
    }


def reference_pixels(group):
    with Image.open(group["reference"]) as source:
        im = ImageOps.exif_transpose(source)
        profile = im.info.get("icc_profile")
        if profile:
            im = ImageCms.profileToProfile(
                im,
                ImageCms.ImageCmsProfile(io.BytesIO(profile)),
                ImageCms.createProfile("sRGB"),
                outputMode="RGB",
            )
        else:
            im = im.convert("RGB")
        if "referenceBox" in group:
            x, y, r, b = group["referenceBox"]
            if not 0 <= x < r <= im.width or not 0 <= y < b <= im.height:
                raise ValueError("Paper crop outside source image")
            im = im.crop((x, y, r, b))
        return im


def measure(im, points):
    rgb = np.asarray(im)
    # Small patches suppress JPEG noise without reaching into neighbouring text.
    radius = max(1, min(4, round(min(im.size) / 240)))
    rows = []
    seen = set()
    for p in points:
        nx, ny = p["xy"]
        if not all(
            type(v) in (float, int) and math.isfinite(v) and 0 <= v <= 1
            for v in (nx, ny)
        ):
            raise ValueError("Invalid normalized paper coordinates")
        x, y = round(nx * (im.width - 1)), round(ny * (im.height - 1))
        if (
            x < radius
            or y < radius
            or x >= im.width - radius
            or y >= im.height - radius
        ):
            raise ValueError("Sample touches outer crop boundary")
        if any(abs(x - i) <= 2 * radius and abs(y - j) <= 2 * radius for i, j in seen):
            raise ValueError("Overlapping paper sample patches")
        seen.add((x, y))
        patch = rgb[y - radius : y + radius + 1, x - radius : x + radius + 1].reshape(
            -1, 3
        )
        mid = np.median(patch, axis=0)
        rows.append(
            {
                "xy": p["xy"],
                "pixel": [x, y],
                "where": p["where"],
                "rgb": mid.astype(int).tolist(),
                "patchRadius": radius,
                "p10p90Range": (
                    np.percentile(patch, 90, axis=0) - np.percentile(patch, 10, axis=0)
                )
                .round(1)
                .tolist(),
            }
        )
    result = np.rint(np.median([row["rgb"] for row in rows], axis=0)).astype(int)
    return "#%02X%02X%02X" % tuple(result), rows


def marked(im, rows):
    result = im.copy()
    draw = ImageDraw.Draw(result)
    radius = max(7, min(im.size) // 75)
    for i, row in enumerate(rows, 1):
        x, y = row["pixel"]
        draw.ellipse(
            (x - radius, y - radius, x + radius, y + radius), outline="white", width=4
        )
        draw.ellipse(
            (x - radius, y - radius, x + radius, y + radius), outline="#e32c35", width=2
        )
        draw.text(
            (x + radius + 1, max(0, y - radius - 2)),
            str(i),
            fill="#b01523",
            stroke_width=2,
            stroke_fill="white",
        )
    return result


async def sample_paper(group, target, conf):
    im = reference_pixels(group)
    fingerprint = hashlib.sha256(
        im.tobytes()
        + str(im.size).encode()
        + LOCATE.encode()
        + CHECK.encode()
        + Path(__file__).read_bytes()
    ).hexdigest()
    dest = conf.records / (target["id"] + ".paper.json")
    source_digest = hashlib.sha256(im.tobytes() + str(im.size).encode()).hexdigest()
    previous = {}
    if dest.exists():
        previous = json.loads(dest.read_text())
        if (
            previous.get("fingerprint") == fingerprint
            and previous.get("status") == "measured"
        ):
            return previous
        if (
            previous.get("sourceDigest") == source_digest
            and previous.get("protocol") == "all-points-v1"
            and previous["status"] == "measured"
        ):
            if (
                previous["attempts"][-1]["review"]["ok"]
                and measure(im, previous["location"]["points"])[0] == previous["paper"]
            ):
                return previous
    trace = conf.records / "paper-trace.jsonl"
    feedback = ""
    attempts = []

    def validate_points(d):
        if type(d.get("visible")) is not bool or not isinstance(d.get("reason"), str):
            raise ValueError("Invalid visibility report")
        if not d["visible"]:
            if d["points"] != []:
                raise ValueError("Invisible paper should have no samples")
        else:
            if not 2 <= len(d["points"]) <= 5:
                raise ValueError("Provide 2–5 separated sample points")
            measure(im, d["points"])

    def validate_review(d):
        accepted = d.get("accepted")
        if (
            type(d.get("consistent")) is not bool
            or not isinstance(d.get("reason"), str)
            or not isinstance(accepted, list)
            or any(type(i) is not int or i < 1 or i > len(rows) for i in accepted)
            or len(set(accepted)) != len(accepted)
        ):
            raise ValueError("Invalid per-point paper review")

    for attempt in range(3):
        if (
            attempt == 0
            and previous.get("sourceDigest") == source_digest
            and previous.get("status") == "needs_review"
        ):
            location = previous["location"]
            validate_points(location)
        else:
            location = await request(
                conf.release,
                [image_block(im), {"type": "text", "text": LOCATE + feedback}],
                validate_points,
                trace,
                target["id"] + ".paper.locate",
            )
        evidence = {
            "fingerprint": fingerprint,
            "sourceDigest": source_digest,
            "protocol": "verified-subset-v2",
            "sourceSize": list(im.size),
            "referenceBox": group.get("referenceBox"),
            "location": location,
            "attempts": attempts,
        }
        if not location["visible"]:
            evidence.update(status="unobservable", paper=None)
            write_json(dest, evidence)
            return evidence
        color, rows = measure(im, location["points"])
        overlay = marked(im, rows)
        review = await request(
            conf.release,
            [
                image_block(im),
                image_block(overlay),
                {
                    "type": "text",
                    "text": CHECK
                    + "\n各点顺序："
                    + json.dumps(rows, ensure_ascii=False),
                },
            ],
            validate_review,
            trace,
            target["id"] + ".paper.review",
        )
        attempts.append({"points": rows, "review": review})
        retained = [location["points"][i - 1] for i in review["accepted"]]
        if review["consistent"] and len(retained) >= 2:
            color, rows = measure(im, retained)
            marked(im, rows).save(dest.with_suffix(".jpg"), quality=92)
            evidence.update(status="measured", paper=color, samples=rows)
            write_json(dest, evidence)
            return evidence
        feedback = (
            "\n上一轮标点未通过："
            + json.dumps(location["points"], ensure_ascii=False)
            + "。复核意见："
            + review["reason"]
            + "。请重新定位。"
        )
    evidence.update(status="needs_review", paper=None)
    write_json(dest, evidence)
    raise ValueError(
        f"{target['id']} has no verified paper sample after three spatial checks"
    )
