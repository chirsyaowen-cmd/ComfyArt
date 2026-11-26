"""Derive image-search queries from the supplied photo pixels, then call ComfyArt search_images."""

import argparse
import asyncio
import json
from pathlib import Path

import aiohttp
from bind_photos import sheets
from harness_json import request
from local_runtime import audit, write_json
from reference_candidates import choose_or_refine, prepare_references


async def main(a):
    photos = json.loads(a.photos.read_text())
    prompt = (
        "观察上传的照片，在 Pinterest 上优先寻找独立摄影小志（photo zine）的真实内页跨页。"
        "目标是能看清左右两页和未印刷纸面的实拍或扫描图，照片比例和数量适合用来参考。"
        "只根据可见场景、活动、镜头气氛判断，避免猜地点、身份和私人经历。"
        '输出 JSON {"theme":"简短中文书名","captions":{"照片ID":"简短客观描述"},"queries":["英文检索词","英文检索词"],"reason":"画面决定检索方向的理由"}。'
        "两条检索词都用 photo zine 和表示内页跨页的英文词组（如 interior spread），再加与照片相关的题材词。"
        "两条查询围绕同一可行的内页设计方向展开，允许不同构图和刊物。去掉文件名和个人信息。"
    )

    def valid(d):
        if set(d["captions"]) != {p["id"] for p in photos} or not all(
            isinstance(v, str) and v.strip() for v in d["captions"].values()
        ):
            raise ValueError("Provide captions for every photo ID")
        if len(d["queries"]) != 2 or not all(
            isinstance(q, str) and q.strip() for q in d["queries"]
        ):
            raise ValueError("Provide two image-search queries")
        if not d["theme"].strip():
            raise ValueError("Missing title")

    data = await request(
        a.release,
        sheets(photos) + [{"type": "text", "text": prompt}],
        valid,
        a.trace,
        "photo_semantics",
    )
    write_json(a.output / "搜图意图.json", data)
    for p in photos:
        p.update(description=data["captions"][p["id"]])
    write_json(a.photos, photos)
    results = []
    queries = list(data["queries"])
    async with aiohttp.ClientSession(
        base_url=a.url, timeout=aiohttp.ClientTimeout(total=115)
    ) as c:
        for i, q in enumerate(queries, 1):
            query = "site:pinterest.com/pin/ " + q
            rpc = {
                "jsonrpc": "2.0",
                "id": i,
                "method": "tools/call",
                "params": {
                    "name": "search_images",
                    "arguments": {"query": query, "count": 12},
                },
            }
            async with c.post(
                "/api/comfyart/mcp", params={"project": a.project}, json=rpc
            ) as r:
                r.raise_for_status()
                reply = await r.json()
            res = reply["result"]
            if res.get("isError"):
                raise ValueError(res["content"][0]["text"])
            result = json.loads(res["content"][0]["text"])
            results.append({"query": query, **result})
            write_json(a.output / f"搜图结果-{i}.json", results[-1])
            audit(
                a.trace,
                "search_images.result",
                query=query,
                returned=len(result["images"]),
                saved=result["added"],
            )
            if a.choose and i == len(queries):
                selection, selected = await choose_or_refine(
                    a, c, results, data, photos
                )
                if len(selected) == a.choose:
                    await prepare_references(a, selected, selection)
                elif len(queries) == 2:
                    queries.extend(selection["queries"])
                    write_json(a.output / "搜图复核.json", selection)
                else:
                    raise ValueError("两轮搜索后合适内页不足，详见候选与 trace。")
    print(data["theme"], queries)


if __name__ == "__main__":
    p = argparse.ArgumentParser()
    for k in ("photos", "trace", "output"):
        p.add_argument("--" + k, type=Path, required=True)
    from local_runtime import ROOT

    p.add_argument("--release", type=Path, default=ROOT)
    p.add_argument("--url", required=True)
    p.add_argument("--project", required=True)
    p.add_argument(
        "--choose",
        type=int,
        default=3,
        help="Number of reference spreads to select; 0 runs search only",
    )
    asyncio.run(main(p.parse_args()))
