"""Start a project-scoped reference book and poll its verified canvas result."""

import asyncio
import json
import re
import sys
import tempfile
from pathlib import Path
from urllib.parse import urlencode

from ... import runtime
from .. import project_store
from .._common import read_json, view_path, write_json
from ._context import PROJECT

SCRIPTS = Path(__file__).resolve().parents[2] / "tools/zine"
_jobs = {}


def inputs(meta):
    pages = meta.get("zinePages", [])
    if len(pages) < 8 or len(pages) % 2:
        raise ValueError("Open a saved Zine with at least eight pages")
    refs = {r.get("key") or r["src"]: r for r in meta.get("references", [])}
    return pages, refs, meta.get("projectPhotos", meta.get("roadmapPhotos", {}))


def prepare(folder, args, pages, refs, library, meta):
    mapped = meta.get("zineReferenceSources", {})
    keys = args.get("references")
    if keys is None:
        keys = [
            mapped.get(f"spread-{i + 1:02}", {}).get("referenceKey")
            for i in range(len(pages) // 2)
        ]
    if (
        not isinstance(keys, list)
        or len(keys) != len(pages) // 2
        or any(k not in refs for k in keys)
    ):
        raise ValueError(
            "Supply one saved reference key per spread, starting with the back/front cover. Call inputs to see available keys."
        )
    photos = {
        p["key"]: p for p in library.get("photos", []) if p.get("state") == "ready"
    }
    selected = args.get("photos", library.get("batch", []))
    if (
        not selected
        or not isinstance(selected, list)
        or any(k not in photos for k in selected)
    ):
        raise ValueError("Select ready uploaded photos in this project")

    def save(name, value):
        (folder / name).write_text(
            json.dumps(value, ensure_ascii=False), encoding="utf-8"
        )

    groups = []
    for i, key in enumerate(keys):
        r = refs[key]
        ident = f"spread-{i + 1:02}"
        group = {
            "id": ident,
            "reference": view_path(r["src"]),
            "imageUrl": key,
            "pin": r.get("sourcePageUrl", ""),
            "savedReference": r,
        }
        mapping = mapped.get(ident, {})
        if mapping.get("referenceKey") == key and mapping.get("paperBoundsPx"):
            group["referenceBox"] = mapping["paperBoundsPx"]
        groups.append(group)
    save("素材清单.json", {"groups": groups})
    save(
        "装订顺序.json",
        {"cover": groups[0]["id"], "spreads": [g["id"] for g in groups[1:]]},
    )
    save("来源.json", groups)
    originals = []
    for item in args.get("pngOriginals", []):
        photo = photos.get(item["photoKey"])
        if not photo:
            raise ValueError("Choose a ready uploaded PNG from this project")
        originals.append(
            {
                "file": view_path(
                    "/api/view?" + urlencode(photo["ref"]), original=True
                ),
                "sourcePageUrl": item["sourcePageUrl"],
                "name": photo.get("name") or "PNG",
            }
        )
    if originals:
        save("png-originals.json", originals)
        if "photos" not in args:
            original_keys = {item["photoKey"] for item in args["pngOriginals"]}
            selected = [k for k in selected if k not in original_keys]
            if not selected:
                raise ValueError("Supply book photographs as well as decorations")
    catalog = []
    for i, key in enumerate(dict.fromkeys(selected)):
        p = photos[key]
        catalog.append(
            {
                "id": f"P{i + 1:02}",
                "title": p.get("name", ""),
                "file": view_path("/api/view?" + urlencode(p["ref"])),
            }
        )
    save("photos.json", catalog)


async def generate(folder, project, title, brief):
    url = f"http://127.0.0.1:{runtime.port}"
    dest = folder.name

    async def run(script, *args):
        with (folder / "worker.log").open("ab") as log:
            proc = await asyncio.create_subprocess_exec(
                sys.executable,
                str(SCRIPTS / script),
                *map(str, args),
                stdout=log,
                stderr=log,
            )
            try:
                code = await proc.wait()
            except asyncio.CancelledError:
                if proc.returncode is None:
                    proc.terminate()
                    await proc.wait()
                raise
        if code:
            lines = (
                (folder / "worker.log").read_text(errors="replace").strip().splitlines()
            )
            raise ValueError(lines[-1] if lines else f"{script} exited with {code}")

    records = folder / "records"
    await run(
        "design.py",
        folder / "素材清单.json",
        "--url",
        url,
        "--frame-project",
        project,
        "--records",
        records,
        "--output",
        folder / "zine_spec.json",
        "--photos",
        folder / "photos.json",
        "--bindings-output",
        folder / "bindings.json",
        "--title",
        title,
        "--brief",
        brief,
        "--use-all-photos",
    )
    await run(
        "project.py",
        folder,
        "--url",
        url,
        "--database",
        runtime.DATA / "data.db",
        "--id",
        dest,
        "--photos",
        folder / "photos.json",
        "--bindings",
        folder / "bindings.json",
        "--references",
        folder / "来源.json",
        "--title",
        title,
        "--trace",
        records / "trace.jsonl",
    )
    snapshot = project_store.get_snapshot("default", dest)
    decorations = json.loads(snapshot)["document"]["store"]["document:document"][
        "meta"
    ].get("zineDecorations", {})
    return {
        "decorationPreviews": [
            {"provider": v["provider"], "sourcePageUrl": v["sourcePageUrl"]}
            for v in decorations.values()
            if v["origin"] == "search-preview"
        ],
        "status": "complete",
        "project": dest,
        "url": url + "/comfyart/?project=" + dest,
    }


async def handle(args):
    project = PROJECT.get()
    action = args.get("action")
    if action == "status":
        job = args.get("job")
        if not isinstance(job, str) or not re.fullmatch(r"zine-[a-z0-9_]{8}", job):
            raise ValueError("Invalid job ID")
        folder = runtime.DATA / "zine-runs" / job
        state = read_json(folder / "status.json", {})
        if state.get("sourceProject") != project:
            raise ValueError("Unknown job for this project")
        task = _jobs.get((project, job))
        if task is not None:
            await asyncio.wait([task], timeout=12)
            state = read_json(folder / "status.json", state)
        elif state["status"] == "running":
            return {
                "status": "interrupted",
                "job": job,
                "error": "The server restarted before completion was recorded",
            }
        return {k: v for k, v in state.items() if k != "sourceProject"}
    snapshot = project_store.get_snapshot("default", project)
    if not snapshot:
        raise ValueError("Open a saved project first")
    meta = json.loads(snapshot)["document"]["store"]["document:document"]["meta"]
    pages, refs, library = inputs(meta)
    if action == "inputs":
        return {
            "spreadCount": len(pages) // 2,
            "references": [{"key": k, "name": r.get("name")} for k, r in refs.items()],
            "assigned": meta.get("zineReferenceSources", {}),
            "photoBatch": library.get("batch", []),
        }
    if (
        action != "start"
        or not isinstance(args.get("title"), str)
        or not args["title"].strip()
    ):
        raise ValueError("Use start with a book title, inputs or status")
    for (source, job), task in _jobs.items():
        if source == project and not task.done():
            return {"status": "running", "job": job}
    base = runtime.DATA / "zine-runs"
    base.mkdir(parents=True, exist_ok=True)
    folder = Path(tempfile.mkdtemp(prefix="zine-", dir=base))
    try:
        prepare(folder, args, pages, refs, library, meta)
    except Exception:
        import shutil

        shutil.rmtree(folder)
        raise

    def record(result):
        write_json(
            str(folder / "status.json"),
            {**result, "sourceProject": project, "job": folder.name},
        )

    record({"status": "running"})

    async def work():
        try:
            result = await generate(
                folder, project, args["title"], args.get("brief", "")
            )
        except (OSError, ValueError, RuntimeError) as exc:
            result = {"status": "failed", "error": str(exc)}
        record(result)
        _jobs.pop((project, folder.name), None)

    _jobs[(project, folder.name)] = asyncio.create_task(work())
    return {"status": "running", "job": folder.name}


TOOL = {
    "description": "Default workflow for making a complete editable Zine from reference spreads and project photos. "
    "When choosing interior references, compare them as a set. Prefer shared visual style (paper, type, spacing or photographic treatment), allow varied compositions and different books, and honor explicit user choices. "
    "Use inputs to inspect available saved references; assign one per spread, cover first. Use start with the user's title and creative direction. "
    "Children can search Brave for transparent decorations from Vecteezy, Pngtree and PNGimg. Indexed assets are visibly marked as previews; pngOriginals matches uploaded originals to their resource pages. "
    "Native DeepSeek children extract layouts and treatments before the master binds photos and copy. "
    "Poll status until complete and give the user the new canvas link. Existing source project is preserved.",
    "inputSchema": {
        "type": "object",
        "required": ["action"],
        "additionalProperties": False,
        "properties": {
            "action": {"enum": ["inputs", "start", "status"]},
            "job": {"type": "string"},
            "title": {"type": "string"},
            "brief": {
                "type": "string",
                "description": "User-specified design and editorial requirements",
            },
            "pngOriginals": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "photoKey": {"type": "string"},
                        "sourcePageUrl": {"type": "string"},
                    },
                    "required": ["photoKey", "sourcePageUrl"],
                    "additionalProperties": False,
                },
            },
            "references": {"type": "array", "items": {"type": "string"}},
            "photos": {"type": "array", "items": {"type": "string"}},
        },
    },
    "handler": handle,
}
