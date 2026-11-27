"""Ask the installed design Harness to bind new material to an existing v2 layout."""

import argparse
import asyncio
import base64
import io
import json
from pathlib import Path

from harness_json import request
from local_runtime import ROOT, write_json
from PIL import Image, ImageDraw, ImageOps


def sheets(photos):
    blocks = []
    for start in range(0, len(photos), 12):
        batch = photos[start : start + 12]
        sheet = Image.new("RGB", (4 * 250, ((len(batch) + 3) // 4) * 220), "#eeeeeb")
        draw = ImageDraw.Draw(sheet)
        for i, p in enumerate(batch):
            with Image.open(p["file"]) as src:
                tile = ImageOps.exif_transpose(src).convert("RGB")
                tile.thumbnail((244, 190), Image.Resampling.LANCZOS)
            x = i % 4 * 250
            y = i // 4 * 220
            sheet.paste(tile, (x + (250 - tile.width) // 2, y))
            draw.text((x + 6, y + 191), f"{start + i + 1:02}  " + p["id"], fill="black")
        buf = io.BytesIO()
        sheet.save(buf, "JPEG", quality=86)
        blocks.append(
            {
                "type": "image",
                "mimeType": "image/jpeg",
                "data": base64.b64encode(buf.getvalue()).decode(),
            }
        )
    return blocks


def validate(spec, photos, bindings):
    required = {
        d["spreads"][0]["id"]: {s["id"]: s["kind"] for s in d["slots"]}
        for d in spec["designs"]
    }
    available = {p["id"] for p in photos}
    if set(required) != set(bindings):
        raise ValueError("Exactly one binding set per design is required")
    for design, slots in required.items():
        values = bindings[design]
        if set(slots) != set(values):
            raise ValueError(
                f"{design}: missing {sorted(set(slots) - set(values))}, unknown {sorted(set(values) - set(slots))}"
            )
        for k, kind in slots.items():
            value = values[k]
            if not isinstance(value, str) or not value.strip():
                raise ValueError(f"Empty slot {design}/{k}")
            if kind == "photo" and value not in available:
                raise ValueError(f"Unknown photo in {design}/{k}: {value}")


async def main(args, generate=request):
    spec = json.loads(args.spec.read_text())
    photos = json.loads(args.photos.read_text())
    slots = []
    for d in spec["designs"]:
        layers = [
            l
            for section in [*d["spreads"], *d["components"]]
            for l in section["layers"]
        ]
        hints = [
            {
                **slot,
                "placements": [
                    {
                        k: l[k]
                        for k in ("box", "size", "fit", "clip", "anchor", "treatment")
                        if k in l
                    }
                    for l in layers
                    if l.get("slot") == slot["id"]
                ],
            }
            for slot in d["slots"]
        ]
        slots.append({"id": d["spreads"][0]["id"], "layout": d["name"], "slots": hints})
    fixed = {}
    if spec.get("frames"):
        from frame_geometry import editorial_pages, spread_geometry

        frames = {p["id"]: p for p in spec["frames"]}
        numbers = {k: i for i, k in enumerate(frames, 1)}
        for design, info in zip(spec["designs"], slots):
            targets = []
            for spread in design["spreads"]:
                left, right = spread["pageIds"]
                targets.append({"geometry": spread_geometry(frames[left], frames[right]),
                                "pageNumbers": [numbers[left], numbers[right]]})
            info["physicalPages"] = [t["pageNumbers"] for t in targets]
            pages = editorial_pages(design, targets)
            fixed[info["id"]] = {
                s["id"]: args.title if s["role"] == "bookTitle" else str(pages[s["id"]]).zfill(s.get("minDigits", 1))
                for s in design["slots"] if s.get("role")
            }
            info["fixedText"] = fixed[info["id"]]
    facts = [
        {"id": p["id"], "title": p["title"], "notes": p.get("description", "")[:230]}
        for p in photos
    ]
    prompt = (
        f"你是 ComfyArt 运行时设计 Agent，请为《{args.title}》用新照片套入已有跨页版式。图为附编号的实际照片。文字按原框宽高及字号控制长度。照片图注应对应实际选片，以所给资料为准。"
        "选图和文案由你决定。以影像事实为依据、简短中文编辑文字，具体准确日期只在可靠时写，版记可用档案编号。"
        "整本有节奏，尽量用不同照片，同一设计内相关页共享内容。不要改变任何已有图层或尺寸。"
        "只输出 JSON 对象，以每组第一个跨页的 id 为键，值为该组全部槽位 id 到字符串的映射。照片值须逐字复制照片 id，文字值是实际短文案。"
        "每个槽都要填写。\n素材："
        + json.dumps(facts, ensure_ascii=False)
        + "\n设计："
        + json.dumps(slots, ensure_ascii=False)
    )
    if getattr(args, "brief", ""):
        prompt += "\n用户给出的创作要求：" + args.brief
    expected_photos = {p["id"] for p in photos}
    photo_slots = [
        (d["spreads"][0]["id"], slot["id"])
        for d in spec["designs"]
        for slot in d["slots"]
        if slot["kind"] == "photo"
    ]
    require_coverage = args.use_all_photos and len(photo_slots) >= len(photos)
    if args.use_all_photos:
        prompt += "\n尽量让每张独立上传照片至少出现一次。无可靠日期、地点或人物身份时，日期或版记槽填册序或篇章短注，文案根据画面的可见事实写，不补个人经历。"

    def validate_result(data):
        for group, values in fixed.items():
            if group in data and isinstance(data[group], dict):
                data[group].update(values)
        validate(spec, photos, data)
        if require_coverage:
            missing = expected_photos - {data[d][slot] for d, slot in photo_slots}
            if missing:
                raise ValueError(
                    "Photo IDs still unused: " + ", ".join(sorted(missing))
                )

    data = await generate(
        args.release,
        sheets(photos) + [{"type": "text", "text": prompt}],
        validate_result,
        args.trace,
        "binding",
    )
    validate_result(data)
    write_json(args.output, data)


if __name__ == "__main__":
    ap = argparse.ArgumentParser(description=__doc__)
    for arg in ("spec", "photos", "output", "trace"):
        ap.add_argument("--" + arg, type=Path, required=True)
    ap.add_argument("--release", type=Path, default=ROOT)
    ap.add_argument("--title", required=True)
    ap.add_argument(
        "--use-all-photos",
        action="store_true",
        help="Include every supplied photo when enough photo slots exist",
    )
    asyncio.run(main(ap.parse_args()))
