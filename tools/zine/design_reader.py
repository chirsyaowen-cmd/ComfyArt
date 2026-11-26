import json
from pathlib import Path


def build(specification, destination):
    spec = json.loads(specification.read_text())
    if spec.get("schemaVersion") != 2:
        raise ValueError("The reusable design reader expects zine_spec version 2")
    template = Path(__file__).with_name("design-reader.html").read_text()
    payload = json.dumps(spec, ensure_ascii=False, separators=(",", ":")).replace(
        "<", "\\u003c"
    )
    destination.write_text(template.replace("__SPEC__", payload))
