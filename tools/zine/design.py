"""Extract reusable paper layouts with the ComfyArt DeepSeek Harness."""

import argparse
import asyncio
import hashlib
import json
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path

from frame_geometry import checked_frames, read_project, spread_geometry
from layout_schema import SCHEMA_FILE, check_design, validate_schema
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
    from paper_sample import sample_paper

    targets = [target for _, target in packet]
    conf.records.mkdir(parents=True, exist_ok=True)

    async def locate(group, target):
        async with conf.gate:
            return await sample_paper(group, target, conf)

    fresh = [(g, t) for g, t in packet if g.get("reference")]
    measurements = await asyncio.gather(*(locate(g, t) for g, t in fresh))
    measured = {}
    for (_, target), evidence in zip(fresh, measurements):
        if evidence["status"] == "unobservable" and target["id"] == "spread-01":
            continue
        if evidence["status"] != "measured":
            raise ValueError(f"{target['id']}: 此参考没有可靠的纸色记录")
        measured[target["id"]] = evidence["paper"]
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
    if old:
        if not fresh:
            prompt += (
                "\n此封面沿用以下已有设计，请为目标 frame 重新构图。已有尺寸与旧坐标仅作为设计来源，不要沿用旧版版心。"
                + json.dumps(old, ensure_ascii=False)
            )
            measured[targets[0]["id"]] = old["spreads"][0]["paper"]
        prompt += "\n复用以下槽位ID和类型，使同一图文能对比新旧留白。" + json.dumps(
            old["slots"], ensure_ascii=False
        )
    prompt += "\n纸色数据：" + json.dumps(measured)
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
        if old and {a["id"]: a["kind"] for a in data["slots"]} != {
            a["id"]: a["kind"] for a in old["slots"]
        }:
            raise ValueError("Keep the same slot IDs and types as the source design")
        if any(
            s["id"] in measured and s["paper"] != measured[s["id"]]
            for s in data["spreads"]
        ):
            raise ValueError(
                "Cached design paper disagrees with its measured reference"
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
            if spread["id"] in measured:
                spread["paper"] = measured[spread["id"]]
        valid(data)

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
        validate_schema(source)
        args.previous = {s["id"]: d for d in source["designs"] for s in d["spreads"]}
    if args.reuse_cover:
        cover_source = json.loads(args.reuse_cover.read_text())
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
