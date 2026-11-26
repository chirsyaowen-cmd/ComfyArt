import json
import sqlite3


def indices(n):
    # tldraw fractional indices: 62 increments for one-digit a keys, then two digits for b.
    alphabet = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz"
    return (
        "a" + alphabet[n]
        if n < 62
        else "b" + alphabet[(n - 62) // 62] + alphabet[(n - 62) % 62]
    )


def positions(count):
    x = y = used = 0
    for length in [1] + [2] * ((count - 2) // 2) + [1]:
        if used + length > 8:
            x = 0
            used = 0
            y += 712
        for _ in range(length):
            yield x, y
            x += 480
        x += 32
        used += length


def schema_from(db):
    with sqlite3.connect(db.resolve().as_uri() + "?mode=ro", uri=True) as cx:
        row = cx.execute(
            "select json_extract(snapshot,'$.document.schema') from comfyart_projects where json_type(snapshot,'$.document.schema.sequences')='object' order by updated_at desc limit 1"
        ).fetchone()
    if not row:
        raise ValueError("An initialized ComfyArt document schema is required")
    return json.loads(row[0])


def shape(sid, kind, parent, index, x, y, props, meta=None):
    return dict(
        typeName="shape",
        id=sid,
        type=kind,
        parentId=parent,
        index=indices(index),
        x=x,
        y=y,
        opacity=1,
        rotation=0,
        isLocked=False,
        props=props,
        meta=meta or {},
    )
