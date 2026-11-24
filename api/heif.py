"""Browser renditions; the source file stays in the photo library."""
import hashlib
import os
import tempfile
import threading
from pathlib import Path

from PIL import Image, ImageOps
from pillow_heif import register_heif_opener

register_heif_opener()
DECODE = threading.Lock()
SUFFIXES = {".heic", ".heif", ".heics", ".heifs"}


def rendition(source: Path, cache: Path, edge: int = 0) -> Path:
    stat = source.stat()
    key = hashlib.sha256(f"{source}:{stat.st_size}:{stat.st_mtime_ns}:{edge}".encode()).hexdigest()
    dest = cache / (key + (".webp" if edge else ".jpg"))
    with DECODE:
        if dest.is_file():
            return dest
        cache.mkdir(parents=True, exist_ok=True)
        with Image.open(source, formats=["HEIF"]) as photo:
            # Pillow-Heif opens the primary image with the HEIF transforms applied.
            pixels = ImageOps.exif_transpose(photo).convert("RGB")
            if edge:
                pixels.thumbnail((edge, edge), Image.Resampling.LANCZOS)
            tmp = tempfile.NamedTemporaryFile(dir=cache, delete=False)
            try:
                with tmp:
                    pixels.save(tmp, format="WEBP" if edge else "JPEG", quality=85 if edge else 94,
                                icc_profile=photo.info.get("icc_profile"))
                os.replace(tmp.name, dest)
            finally:
                Path(tmp.name).unlink(missing_ok=True)
    return dest
