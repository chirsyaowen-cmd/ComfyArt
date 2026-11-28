"""Score rendered sRGB pages against independently annotated patches in a reference JPEG."""
import numpy as np


def lab(rgb):
    srgb = np.asarray(rgb, dtype=float) / 255
    linear = np.where(srgb <= .04045, srgb / 12.92, ((srgb + .055) / 1.055) ** 2.4)
    xyz = np.array([
        [.4124564, .3575761, .1804375],
        [.2126729, .7151522, .0721750],
        [.0193339, .1191920, .9503041],
    ]) @ linear
    relative = xyz / [.95047, 1, 1.08883]
    f = np.where(relative > (6/29)**3, np.cbrt(relative), relative / (3*(6/29)**2) + 4/29)
    return np.array([116*f[1]-16, 500*(f[0]-f[1]), 200*(f[1]-f[2])])


def delta_e(rgb, other):
    return float(np.linalg.norm(lab(rgb) - lab(other)))


def score_page(image, frame_rgb, case, fixture):
    pixels = np.asarray(image.convert("RGB"))
    radius = fixture["patchRadius"]
    samples = []
    for u, v in case["uv"]:
        x = round(u * (image.width - 1))
        y = round(v * (image.height - 1))
        patch = pixels[y-radius:y+radius+1, x-radius:x+radius+1]
        if patch.shape[:2] != (radius*2+1, radius*2+1):
            raise ValueError("Paper probe outside page")
        samples.append(np.median(patch, axis=(0, 1)).astype(int).tolist())
    actual = np.median(samples, axis=0).astype(int).tolist()
    reference_error = delta_e(actual, case["expected"])
    frame_error = delta_e(actual, frame_rgb)
    return {
        "expected": case["expected"], "frame": frame_rgb, "rendered": actual, "patches": samples,
        "deltaReference": round(reference_error, 3), "deltaFrame": round(frame_error, 3),
        "pass": reference_error <= fixture["maxDeltaE76"] and frame_error <= fixture["canvasSpecMaxDeltaE76"],
    }
