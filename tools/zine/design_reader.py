import base64
import json
from pathlib import Path

from layout_schema import discard_legacy_steps


def build(specification, destination):
    spec = json.loads(specification.read_text())
    discard_legacy_steps(spec)
    if spec.get("schemaVersion") != 2:
        raise ValueError("The reusable design reader expects zine_spec version 2")
    from png_assets import decoration_keys, read_png

    keys = {key for design in spec["designs"] for key in decoration_keys(design)}
    if keys:
        spec["decorationImages"] = {}
        for key in keys:
            info, raw = read_png(specification.parent / "zine-png", key)
            spec["decorationImages"][key] = {
                "origin": info["origin"],
                "provider":info.get("provider","Vecteezy"),
                "src": "data:image/png;base64," + base64.b64encode(raw).decode(),
            }
    template = Path(__file__).with_name("design-reader.html").read_text()
    payload = json.dumps(spec, ensure_ascii=False, separators=(",", ":")).replace(
        "<", "\\u003c"
    )
    destination.write_text(template.replace("__SPEC__", payload))
