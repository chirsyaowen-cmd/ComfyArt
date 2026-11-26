"""Prepare orientation-correct sRGB working copies, preserving source bytes and duplicate provenance."""

import argparse
import hashlib
import io
from pathlib import Path

import pillow_heif
from local_runtime import write_json
from PIL import Image, ImageCms, ImageOps


def prepare(paths, folder):
    pillow_heif.register_heif_opener()
    folder.mkdir(parents=True, exist_ok=True)
    seen = {}
    for path in paths:
        with Image.open(path) as source:
            image = ImageOps.exif_transpose(source)
            icc = image.info.get("icc_profile")
            if icc:
                image = ImageCms.profileToProfile(
                    image,
                    ImageCms.ImageCmsProfile(io.BytesIO(icc)),
                    ImageCms.createProfile("sRGB"),
                    outputMode="RGB",
                )
            else:
                image = image.convert("RGB")
            digest = hashlib.sha256(
                str(image.size).encode() + image.tobytes()
            ).hexdigest()
            if digest in seen:
                seen[digest]["originalFiles"].append(path.name)
                continue
            key = f"P{len(seen) + 1:02}"
            dest = folder / (key + ".jpg")
            image.thumbnail((2000, 2000), Image.Resampling.LANCZOS)
            image.save(dest, "JPEG", quality=92)
            seen[digest] = {
                "id": key,
                "file": str(dest.resolve()),
                "title": key,
                "description": "",
                "originalFiles": [path.name],
                "source": "用户提供",
                "credit": "用户提供",
            }
    return list(seen.values())


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("photos", type=Path, nargs="+")
    args = parser.parse_args()
    write_json(
        args.output / "照片清单.json", prepare(args.photos, args.output / "照片")
    )
