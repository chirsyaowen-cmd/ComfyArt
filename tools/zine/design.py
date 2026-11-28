"""Extract reusable paper layouts with the ComfyArt DeepSeek Harness."""

import argparse
import asyncio
import hashlib
import json
import re
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path

from frame_geometry import checked_frames, read_project, spread_geometry
from layout_schema import SCHEMA_FILE, discard_legacy_steps, check_design, validate_schema
from local_runtime import ROOT, audit, write_json

HERE = Path(__file__).resolve().parent


def reference(group):
    from paper_sample import image_block, reference_pixels

    return image_block(reference_pixels(group))


def packets(manifest, binding, frames):
    catalog = {g["id"]: g for g in manifest["groups"]}
    cover = binding["cover"]
    order = [cover, *binding["spreads"]]
    if len(order) != len(set(order)) or set(order) != set(catalog):
        raise ValueError(
            "Every reference group must appear exactly once in the binding"
        )
    related = {}
    for ids in binding.get("relatedSpreads", []):
        if (
            len(ids) < 2
            or len(ids) != len(set(ids))
            or any(k in related or k not in catalog for k in ids)
        ):
            raise ValueError("Invalid relatedSpreads group")
        for k in ids:
            related[k] = ids
    if len(frames) != 2 * len(order):
        raise ValueError("参考跨页数量与实际书页数不匹配")
    targets = {}
    for i, k in enumerate(order):
        left, right = (
            (frames[-1], frames[0]) if i == 0 else (frames[2 * i - 1], frames[2 * i])
        )
        targets[k] = {
            "id": f"spread-{i + 1:02}",
            "pageIds": [left["id"], right["id"]],
            "geometry": spread_geometry(left, right),
            "pageNumbers": [len(frames), 1] if i == 0 else [2 * i, 2 * i + 1],
            "pageRoles": ["backCover", "frontCover"] if i == 0 else ["interior", "interior"],
        }
    emitted = set()
    for k in order:
        if k in emitted:
            continue
        keys = related.get(k, [k])
        emitted.update(keys)
        yield [(catalog[key], targets[key]) for key in keys]


@dataclass
class LayoutTask:
    key: str
    blocks: list
    save: Callable[[dict], None]


async def prepare_layout(packet, conf):
    targets = [target for _, target in packet]
    conf.records.mkdir(parents=True, exist_ok=True)
    fresh = [(g, t) for g, t in packet if g.get("reference")]
    readings = getattr(conf, "reference_structure", {})
    paper_colors = {
        t["id"]: readings[t["id"]]["paper"] for _, t in fresh
        if t["id"] in readings and readings[t["id"]]["paper"] is not None
    }
    expected = [(t["id"], t["pageIds"]) for t in targets]
    old = conf.previous.get(targets[0]["id"])
    if not fresh and old is None:
        raise ValueError("Cover reflow requires a source design")
    blocks = [reference(group) for group, _ in fresh]
    prompt = (
        conf.prompt
        + "\n真实书页 frame 及跨页几何（只返回规定的规格字段）："
        + json.dumps(targets, ensure_ascii=False)
    )
    if readings:
        prompt += "\n逐页参考观察，保持有图和纯文字区域、真实比例与文字层级：" + json.dumps({t["id"]: readings[t["id"]] for t in targets if t["id"] in readings}, ensure_ascii=False)
    if old:
        if not fresh:
            prompt += (
                "\n此封面沿用以下已有设计，请为目标 frame 重新构图。已有尺寸与旧坐标仅作为设计来源，不要沿用旧版版心。"
                + json.dumps(old, ensure_ascii=False)
            )
            paper_colors[targets[0]["id"]] = old["spreads"][0]["paper"]
        prompt += "\n复用以下槽位ID和类型，使同一图文能对比新旧留白。" + json.dumps(
            old["slots"], ensure_ascii=False
        )
    minimum_photos = getattr(conf, "photo_plan", {}).get(targets[0]["id"], 0)
    if minimum_photos:
        prompt += f"\n主编为这一组分配了至少 {minimum_photos} 张不同的用户照片。为它们分别设计可见且可独立换图的照片槽。"
    prompt += "\n纸色数据：" + json.dumps(paper_colors)
    if len(packet) > 1:
        prompt += "\n这些是相关联的两面设计。把静止的底图、取景与可移动的叠层做成共享定义；用实例变换表达翻面关系。"
    blocks.append({"type": "text", "text": prompt})
    digest = hashlib.sha256(
        (json.dumps(blocks) + conf.schema_digest).encode()
    ).hexdigest()
    cache = conf.records / (targets[0]["id"] + ".layout-v2.json")

    def valid(data):
        validate_schema(
            {
                "schemaVersion": 2,
                "size": targets[0]["geometry"]["size"],
                "designs": [data],
            }
        )
        check_design(data, expected)
        if readings:
            from frame_geometry import IDENTITY, compose, intersects, point, rotate_box
            groups = {c["id"]: c["layers"] for c in data["components"]}
            for spread, target in zip(data["spreads"], targets):
                sides = readings.get(target["id"], {}).get("photoFreeSides", [])
                for layer in spread["layers"]:
                    for child in (groups[layer["component"]] if layer["kind"] == "use" else [layer]):
                        if child["kind"] != "photo" or not sides:
                            continue
                        box = child.get("clip", child["box"])
                        x, y, w, h = box
                        m = compose(layer.get("matrix", IDENTITY), rotate_box(child["box"], child.get("rotation", 0)))
                        pts = [point(m, a, b) for a in (x, x+w) for b in (y, y+h)]
                        if any(intersects(pts, target["geometry"]["pages"][i]) for i in sides):
                            raise ValueError("A photo overlaps the reference's text-only page")

        if sum(slot["kind"] == "photo" for slot in data["slots"]) < minimum_photos:
            raise ValueError(f"Provide {minimum_photos} separate photo slots for this group")
        if old and {a["id"]: a["kind"] for a in data["slots"]} != {
            a["id"]: a["kind"] for a in old["slots"]
        }:
            raise ValueError("Keep the same slot IDs and types as the source design")
        if any(
            s["id"] in paper_colors and s["paper"] != paper_colors[s["id"]]
            for s in data["spreads"]
        ):
            raise ValueError(
                "Cached design paper disagrees with the saved Agent color"
            )

    if cache.exists():
        saved = json.loads(cache.read_text())
        if saved.get("inputDigest") == digest:
            valid(saved["design"])
            from png_assets import decoration_keys

            keys = decoration_keys(saved["design"])
            if not keys or all(
                (conf.output.parent / "zine-png" / (k + ext)).is_file()
                for k in keys
                for ext in (".png", ".json")
            ):
                return saved["design"]

    def finalize(data):
        for spread in data["spreads"]:
            if spread["id"] in paper_colors:
                spread["paper"] = paper_colors[spread["id"]]
        from frame_geometry import editorial_pages

        valid(data)
        editorial_pages(data, targets)

    def save(data):
        finalize(data)
        write_json(cache, {"inputDigest": digest, "design": data})

    return LayoutTask(targets[0]["id"], blocks, save)


def arguments():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("manifest", type=Path)
    parser.add_argument("--records", type=Path, required=True)
    parser.add_argument("--release", type=Path, default=ROOT)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument(
        "--frame-project",
        required=True,
        help="Local ComfyArt project whose ordered page frames define the design coordinates",
    )
    parser.add_argument("--url", default="http://127.0.0.1:8190")
    parser.add_argument(
        "--preserve-content",
        action="store_true",
        help="Retain source slot IDs and bound text/photos for a re-layout",
    )
    parser.add_argument(
        "--reuse-cover",
        type=Path,
        help="Reuse the existing v2 cover design when extracting new interiors",
    )
    parser.add_argument(
        "--photos",
        type=Path,
        help="Bind these photos in the same master session after all layouts are sealed",
    )
    parser.add_argument("--bindings-output", type=Path)
    parser.add_argument("--title")
    parser.add_argument(
        "--brief", default="", help="Additional user-specified creative direction"
    )
    parser.add_argument("--use-all-photos", action="store_true")
    return parser


async def read_reference_structure(args, work):
    """Describe each photographed page before allocating any of the user's photos."""
    from harness_json import request

    blocks = []
    targets = {}
    for packet in work:
        for group, target in packet:
            if group.get("reference"):
                key = target["id"]
                targets[key] = target
                blocks.extend([{"type": "text", "text": key + " " + str(target["pageRoles"])},
                               reference(group)])
    if not targets:
        return {}
    blocks.append({"type": "text", "text":
        "请逐张观察原书，先定位纸页四角并排除场景、手、桌面和书外空白。仅记录所见。"
        "逐组分别说明左右页的图窗数量、相对纸页的位置与比例、是否出血或对齐，文字层级位置和行数、纸张裸露处。"
        "封面单图只对应右页，没拍到的封底标明未知。给出 photoFreeSides，只列实际看见且完全无照片的纸页，左0右1。"
        "看露出的书页：如果把这张纸放在中性光下，它本身是什么颜色？先在心里判断纸的种类，再在 paper 字段输出本色 HEX。普通白纸统一用 #FFFFFF，只有纸张本身明确为奶油纸、牛皮纸或彩纸才输出相应色值。"
        "注意区分纸张与印在上面的照片，忽略环境光和阴影；看不到纸面就填 null。"
        "返回以每个跨页编号为键的 JSON，每组含 layout、photoFreeSides 和 paper。"})
    def valid(result):
        if set(result) != set(targets):
            raise ValueError("Describe every supplied spread")
        for row in result.values():
            if not isinstance(row["layout"], str) or not row["layout"].strip():
                raise ValueError("Describe the visible layout")
            color = row["paper"]
            if color is not None and (not isinstance(color, str) or not re.fullmatch(r"#[0-9a-fA-F]{6}", color)):
                raise ValueError("paper must be a HEX color or null")
            sides = row["photoFreeSides"]
            if not isinstance(sides, list) or any(type(i) is not int or i not in (0, 1) for i in sides):
                raise ValueError("Invalid page side")
    result = await request(args.release, blocks, valid, args.records / "trace.jsonl", "reference_structure")
    write_json(args.records / "reference-structure.json", result)
    return result


async def plan_photo_slots(args, work):
    """Have the editor allocate the upload batch before individual layouts are sealed."""
    from harness_json import request

    count = len(json.loads(args.photos.read_text()))
    blocks = []
    keys = []
    for packet in work:
        key = packet[0][1]["id"]
        keys.append(key)
        blocks.append({"type": "text", "text": key})
        blocks.extend(reference(group) for group, _ in packet if group.get("reference"))
    blocks.append({"type": "text", "text":
        f"你是整本小志的主编。这里有 {count} 张不同照片需要全部入册。根据每组参考的构图与创作要求，"
        "分配每组至少需要几个可独立替换的照片槽。返回纯 JSON，键为上面的组编号，值为非负整数，总数等于照片数。"
        "保留纯文字页与对页关系；优先利用未展示的封底等自由位置安置额外照片。除非用户明示，不平均分配。观察："
        + json.dumps(getattr(args, "reference_structure", {}), ensure_ascii=False) + " 创作要求：" + args.brief})
    def valid(plan):
        if (not isinstance(plan, dict) or set(plan) != set(keys)
                or any(type(v) is not int or v < 0 for v in plan.values())
                or sum(plan.values()) != count):
            raise ValueError(f"Allocate exactly {count} uploads among {keys}")
    plan = await request(args.release, blocks, valid, args.records / "trace.jsonl", "photo_slots")
    write_json(args.records / "photo-plan.json", plan)
    return plan


async def generate_book(args):
    if bool(args.photos) != bool(args.bindings_output) or (
        args.photos and not args.title
    ):
        raise ValueError("Supply --photos, --bindings-output and --title together")
    args.prompt = (HERE / "spec-contract.txt").read_text()
    if args.brief:
        args.prompt += "\n用户给出的创作要求：" + args.brief
    import os

    from local_runtime import configure
    from png_assets import prepare_originals

    configure(args.release)
    png_dir = args.output.parent / "zine-png"
    originals = args.output.parent / "png-originals.json"
    if originals.exists():
        prepare_originals(png_dir, json.loads(originals.read_text()))
    png_enabled = bool(os.environ.get("BRAVE_SEARCH_API_KEY") or originals.exists())
    if png_enabled:
        args.prompt += "\n" + (HERE / "png-contract.txt").read_text()
    args.schema_digest = hashlib.sha256(
        SCHEMA_FILE.read_bytes()
        + ((png_dir / "originals.json").read_bytes() if originals.exists() else b"")
    ).hexdigest()
    args.gate = asyncio.Semaphore(4)
    manifest = json.loads(args.manifest.read_text())
    binding = json.loads((args.manifest.parent / "装订顺序.json").read_text())
    frames, metadata, etag = await read_project(args.url, args.frame_project)
    work = list(packets(manifest, binding, frames))
    write_json(
        args.records / "frame-input.json",
        {
            "project": args.frame_project,
            "revision": etag,
            "frames": frames,
            "targets": [t for packet in work for _, t in packet],
        },
    )
    args.previous = {}
    source = metadata.get("zine_spec", {})
    if args.preserve_content:
        discard_legacy_steps(source)
        validate_schema(source)
        args.previous = {s["id"]: d for d in source["designs"] for s in d["spreads"]}
    if args.reuse_cover:
        cover_source = json.loads(args.reuse_cover.read_text())
        discard_legacy_steps(cover_source)
        validate_schema(cover_source)
        first = (cover_source.get("frames") or [{"id": "page-01"}])[0]["id"]
        covers = [
            d
            for d in cover_source["designs"]
            if any(first in s["pageIds"] for s in d["spreads"])
        ]
        if len(covers) != 1 or len(covers[0]["spreads"]) != 1:
            raise ValueError("Expected a separate cover design")
        args.previous[work[0][0][1]["id"]] = covers[0]
    from spread_team import run_team

    args.reference_structure = await read_reference_structure(args, work)
    if args.photos and args.use_all_photos and not args.preserve_content:
        args.photo_plan = await plan_photo_slots(args, work)
    prepared = await asyncio.gather(*(prepare_layout(p, args) for p in work))
    trace = args.records / "trace.jsonl"

    async def finalize(designs, bind):
        results = [designs[x.key] if isinstance(x, LayoutTask) else x for x in prepared]
        book = {
            "schemaVersion": 2,
            "size": spread_geometry(frames[-1], frames[0])["size"],
            "frames": frames,
            "designs": results,
        }
        checked_frames(book)
        validate_schema(book)
        write_json(args.output, book)
        audit(
            trace,
            "spec.sealed",
            spreads=len(frames) // 2,
            digest=hashlib.sha256(args.output.read_bytes()).hexdigest(),
        )
        if args.photos:
            from argparse import Namespace

            from bind_photos import main as bind_book

            await bind_book(
                Namespace(
                    spec=args.output,
                    photos=args.photos,
                    title=args.title,
                    brief=args.brief,
                    output=args.bindings_output,
                    release=args.release,
                    trace=trace,
                    use_all_photos=args.use_all_photos,
                ),
                bind,
            )
        return book

    return await run_team(
        args.release,
        [x for x in prepared if isinstance(x, LayoutTask)],
        trace,
        finalize,
        binding=bool(args.photos),
        png_dir=png_dir if png_enabled else None,
    )


if __name__ == "__main__":
    asyncio.run(generate_book(arguments().parse_args()))
