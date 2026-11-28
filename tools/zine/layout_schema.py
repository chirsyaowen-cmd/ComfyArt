"""Validate the published interchange schema and cross-layer references."""

import json
from pathlib import Path

from frame_geometry import native_box_transform
from jsonschema import Draft7Validator
from jsonschema.exceptions import best_match

SCHEMA_FILE = Path(__file__).with_name("zine_spec.schema.json")
VALIDATOR = Draft7Validator(json.loads(SCHEMA_FILE.read_text(encoding="utf-8")))


def discard_legacy_steps(book):
    """Read v2 layouts written before spreads contained only design data."""
    for design in book.get("designs", []):
        for spread in design["spreads"]:
            spread.pop("steps", None)


def validate_schema(book):
    error = best_match(VALIDATOR.iter_errors(book))
    if error is not None:
        raise ValueError(f"{error.json_path}: {error.message}")


def unique(rows, what):
    ids = [r["id"] for r in rows]
    if len(ids) != len(set(ids)):
        raise ValueError("Duplicate " + what + " ID")
    return {r["id"]: r for r in rows}


def check_design(design, expected):
    slots = unique(design["slots"], "slot")
    components = unique(design["components"], "component")
    spreads = design["spreads"]
    if [(s["id"], s["pageIds"]) for s in spreads] != expected:
        raise ValueError("Use the supplied spread and page IDs in order")
    all_layers = [
        l for group in [*components.values(), *spreads] for l in group["layers"]
    ]
    unique(all_layers, "layer")
    used_slots = set()
    used_groups = set()
    for s in spreads:
        for layer in s["layers"]:
            children = [layer]
            if layer["kind"] == "use":
                key = layer["component"]
                used_groups.add(key)
                children = components[key]["layers"]
            for child in children:
                if layer["kind"] == "use" and "box" in child:
                    native_box_transform(child, layer["matrix"], f"{s['id']}/{layer['id']}/{child['id']}")
                if child["kind"] in ("photo", "text"):
                    key = child["slot"]
                    if slots[key]["kind"] != child["kind"]:
                        raise ValueError("Wrong slot type " + key)
                    used_slots.add(key)
                fill = child.get("fill")
                if isinstance(fill, dict):
                    if slots[fill["sample"]]["kind"] != "photo":
                        raise ValueError("Sample a photo slot")
                    used_slots.add(fill["sample"])
    if used_groups != set(components) or used_slots != set(slots):
        raise ValueError("Remove unused components or slots")
