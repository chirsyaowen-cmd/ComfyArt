"""Select actual editorial spreads using source photos and returned search thumbnails."""

import asyncio
from pathlib import Path
from urllib.parse import urlsplit

import aiohttp
from bind_photos import sheets
from harness_json import request
from local_runtime import write_json
from paper_sample import image_block
from PIL import Image, ImageOps


async def candidates(client, results, directory):
    rows = []
    seen = set()
    directory.mkdir(parents=True, exist_ok=True)
    for q, result in enumerate(results, 1):
        for i, item in enumerate(result["images"], 1):
            host = urlsplit(item["sourcePageUrl"]).hostname or ""
            if (
                "pinterest" not in host.split(".")
                or not item.get("localUrl")
                or item["imageUrl"] in seen
            ):
                continue
            seen.add(item["imageUrl"])
            key = f"Q{q}-{i:02}"
            path = directory / (key + ".jpg")
            async with client.get(item["localUrl"]) as response:
                response.raise_for_status()
                path.write_bytes(await response.read())
            rows.append({**item, "id": key, "file": str(path)})
    return rows


async def choose_or_refine(args, client, results, semantics, photos):
    rows = await candidates(client, results, args.output / "候选缩略图")
    available = {r["id"]: r for r in rows}
    prompt = (
        f"先看用户照片，再看标有 Q 编号的搜索结果。根据照片内容、构图和数量选出 {args.choose} 个不同的真实内页跨页，优先选 photo zine 的实拍或扫描图。"
        "需要可辨认的单一展开跨页和裸露纸面。避免单幅写真、封面和只有人在场景中读书的照片。"
        "把候选并排看，按整本书选一组：优先选纸色、留白、字体、照片处理或装饰方式看起来相互呼应的内页。"
        "比较最不像同一刊物的两张：标题占比、图文密度、照片边界及点缀是否呼应？如果唯一共性只是题材类似、白底或黑字，请保留合适的部分并补搜。允许跨页用不同构图形成节奏，可以来自不同书，也无需找到封面。"
        '返回 {"picks":[{"id":"Q编号","why":"该页怎样呼应整组风格并适配用户照片"}],"queries":[],"reason":"整组共同的视觉特征和可以变化的部分"}。'
        "若合适候选不足，不凑数，给出两条新的英文 Pinterest 查询。两条都保留 photo zine 和内页跨页词，沿用适合这些照片的视觉方向，调整排版用词或题材词。"
        + " 已观察到的主题："
        + semantics["theme"]
    )

    def valid(v):
        ids = [p["id"] for p in v["picks"]]
        if not set(ids) <= available.keys() or len(ids) != len(set(ids)):
            raise ValueError("Invalid candidate IDs")
        if len(ids) != args.choose and len(v["queries"]) != 2:
            raise ValueError("Give two refined queries if candidates are insufficient")

    choice = await request(
        args.release,
        sheets(photos) + sheets(rows) + [{"type": "text", "text": prompt}],
        valid,
        args.trace,
        "reference_selection",
    )
    return choice, [available[s["id"]] for s in choice["picks"]]


async def prepare_references(args, selected, selection):
    directory = args.output / "参考"
    directory.mkdir(parents=True, exist_ok=True)

    async def one(row):
        dest = directory / (row["id"] + ".jpg")
        # Originals go through the same public-address/proxy split as the product.
        from ComfyArt.api.mcp_tools.image_search import MAX_IMAGE_BYTES, _public_socket

        data = None
        try:
            async with aiohttp.ClientSession(
                connector=aiohttp.TCPConnector(socket_factory=_public_socket),
                timeout=aiohttp.ClientTimeout(total=12),
            ) as c:
                async with c.get(row["imageUrl"], max_redirects=4) as r:
                    r.raise_for_status()
                    body = bytearray()
                    async for chunk in r.content.iter_chunked(65536):
                        body.extend(chunk)
                        if len(body) > MAX_IMAGE_BYTES:
                            raise ValueError("Image too large")
                    data = bytes(body)
                    import io

                    with Image.open(io.BytesIO(data)) as im:
                        if im.width * im.height > 24_000_000:
                            raise ValueError("Image too large")
                        im.verify()
        except (aiohttp.ClientError, asyncio.TimeoutError, OSError, ValueError):
            data = None
        dest.write_bytes(data if data is not None else Path(row["file"]).read_bytes())
        with Image.open(dest) as img:
            im = ImageOps.exif_transpose(img).convert("RGB")

        def valid(v):
            x, y, r, b = v["bounds"]
            if not (0 <= x < r <= 1 and 0 <= y < b <= 1):
                raise ValueError("Expected normalized paper bounds")

        crop = await request(
            args.release,
            [
                image_block(im),
                {
                    "type": "text",
                    "text": '框出一幅完整实际双页，去掉桌面和宣传图的外边。输出 {"bounds":[左,上,右,下]}，坐标相对全图归一化。',
                },
            ],
            valid,
            args.trace,
            row["id"] + ".crop",
        )
        box = [round(n * d) for n, d in zip(crop["bounds"], im.size * 2)]
        return {
            "id": row["id"],
            "reference": str(dest.resolve()),
            "referenceBox": box,
            "pin": row["sourcePageUrl"],
            "imageUrl": row["imageUrl"],
            "size": im.size,
            "used": "original" if data else "thumbnail",
        }

    refs = await asyncio.gather(*(one(row) for row in selected))
    write_json(args.output / "来源.json", refs)
    write_json(args.output / "选图依据.json", selection)
    write_json(args.output / "素材清单.json", {"groups": [{"id": "封面"}, *refs]})
    write_json(
        args.output / "装订顺序.json",
        {"cover": "封面", "spreads": [a["id"] for a in refs]},
    )
