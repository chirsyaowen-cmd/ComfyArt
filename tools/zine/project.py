"""Render an offline layout or publish its editable objects to a new local project."""

import argparse
import asyncio
import json
from pathlib import Path

from design_reader import build
from local_runtime import audit
from native_canvas import import_book

if __name__ == "__main__":
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("base", type=Path)
    ap.add_argument("--spec", type=Path)
    ap.add_argument(
        "--references", type=Path, help="Search source manifest (来源.json)"
    )
    for opt in ("url", "id", "title"):
        ap.add_argument("--" + opt)
    for opt in ("photos", "bindings", "trace", "database"):
        ap.add_argument("--" + opt, type=Path)
    a = ap.parse_args()
    spec = a.spec or a.base / "zine_spec.json"
    if a.url:
        if not all((a.photos, a.bindings, a.trace, a.database, a.id, a.title)):
            ap.error(
                "Canvas import requires --photos --bindings --trace --database --id --title"
            )
        try:
            result = asyncio.run(
                import_book(
                    spec,
                    a.photos,
                    a.bindings,
                    a.trace,
                    a.url,
                    a.database,
                    a.id,
                    a.title,
                    a.references,
                )
            )
        except Exception as exc:
            audit(a.trace, "canvas.failed", project=a.id, error=str(exc))
            raise
        print(json.dumps(result, ensure_ascii=False))
    else:
        build(spec, a.base / "可换图跨页设计.html")
