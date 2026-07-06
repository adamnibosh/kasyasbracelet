#!/usr/bin/env python3
"""Process bracelet.zip charms: remove white bg, upscale, map to catalog IDs."""
from __future__ import annotations

import json
import re
from pathlib import Path

from PIL import Image, ImageEnhance, ImageFilter, ImageOps

ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "example" / "bracelet-zip-raw"
OUT = ROOT / "assets" / "charms-hd"
OLD = ROOT / "assets" / "charms"
MAP_FILE = ROOT / "scripts" / "charm-hd-map.json"
TARGET = 512
WHITE_THRESH = 248


def remove_white_bg(im: Image.Image) -> Image.Image:
    im = im.convert("RGBA")
    data = im.getdata()
    new = []
    for r, g, b, a in data:
        if r >= WHITE_THRESH and g >= WHITE_THRESH and b >= WHITE_THRESH:
            new.append((r, g, b, 0))
        elif r >= 242 and g >= 242 and b >= 242:
            # soft edge feather
            lum = (r + g + b) / 3
            alpha = int(max(0, min(255, (WHITE_THRESH - lum) * 40)))
            new.append((r, g, b, alpha))
        else:
            new.append((r, g, b, 255))
    im.putdata(new)
    bbox = im.getbbox()
    if bbox:
        pad = max(4, int(min(bbox[2] - bbox[0], bbox[3] - bbox[1]) * 0.04))
        x0, y0, x1, y1 = bbox
        x0 = max(0, x0 - pad)
        y0 = max(0, y0 - pad)
        x1 = min(im.width, x1 + pad)
        y1 = min(im.height, y1 + pad)
        im = im.crop((x0, y0, x1, y1))
    return im


def enhance(im: Image.Image) -> Image.Image:
    im = ImageEnhance.Sharpness(im).enhance(1.35)
    im = ImageEnhance.Contrast(im).enhance(1.08)
    return im


def to_square_canvas(im: Image.Image, size: int) -> Image.Image:
    im = im.convert("RGBA")
    w, h = im.size
    scale = (size * 0.88) / max(w, h)
    nw, nh = max(1, int(w * scale)), max(1, int(h * scale))
    im = im.resize((nw, nh), Image.Resampling.LANCZOS)

    px = im.load()
    cx = cy = count = 0
    for y in range(nh):
        for x in range(nw):
            if px[x, y][3] > 48:
                cx += x
                cy += y
                count += 1
    if count:
        cx /= count
        cy /= count
    else:
        cx, cy = nw / 2, nh / 2

    canvas = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    ox = int(size / 2 - cx)
    oy = int(size / 2 - cy)
    canvas.paste(im, (ox, oy), im)
    return canvas


def fingerprint(im: Image.Image) -> list[int]:
    gray = ImageOps.grayscale(im).resize((32, 32), Image.Resampling.LANCZOS)
    return list(gray.getdata())


def mse(a: list[int], b: list[int]) -> float:
    return sum((x - y) ** 2 for x, y in zip(a, b)) / len(a)


def process_all(src_dir: Path) -> dict[str, str]:
    OUT.mkdir(parents=True, exist_ok=True)
    processed: dict[str, Path] = {}

    for path in sorted(src_dir.glob("*")):
        if path.suffix.lower() not in {".webp", ".png", ".jpg", ".jpeg"}:
            continue
        try:
            im = Image.open(path)
            im = remove_white_bg(im)
            im = enhance(im)
            im = to_square_canvas(im, TARGET)
            stem = path.name.split("~")[0][:12]
            out = OUT / f"{stem}.png"
            im.save(out, "PNG", optimize=True)
            processed[stem] = out
        except Exception as e:
            print(f"skip {path.name}: {e}")

    print(f"processed {len(processed)} images -> {OUT}")
    return {k: str(v.relative_to(ROOT)).replace("\\", "/") for k, v in processed.items()}


def build_old_fps() -> dict[str, list[int]]:
    fps = {}
    for p in OLD.glob("*.jpg"):
        try:
            im = Image.open(p).convert("RGBA")
            white = Image.new("RGBA", im.size, (255, 255, 255, 255))
            white.paste(im, (0, 0))
            im = remove_white_bg(white)
            im = to_square_canvas(im, TARGET)
            fps[p.stem] = fingerprint(im)
        except Exception:
            pass
    return fps


def map_to_catalog(processed_paths: dict[str, str]) -> dict[str, str]:
    """Map charm IDs -> hd png path."""
    old_fps = build_old_fps()
    charm_map: dict[str, str] = {}
    used_stems: set[str] = set()

    # Match existing catalog charms to best HD source
    for charm_id, old_fp in old_fps.items():
        best_stem, best_score = None, float("inf")
        for stem, rel in processed_paths.items():
            if stem in used_stems:
                continue
            p = ROOT / rel
            im = Image.open(p)
            score = mse(old_fp, fingerprint(im))
            if score < best_score:
                best_score = score
                best_stem = stem
        if best_stem and best_score < 3500:
            charm_map[charm_id] = processed_paths[best_stem]
            used_stems.add(best_stem)
            print(f"  {charm_id} <- {best_stem} (mse={best_score:.0f})")

    # Rename matched files to charm IDs for clean URLs
    final: dict[str, str] = {}
    for charm_id, rel in charm_map.items():
        src = ROOT / rel
        dst = OUT / f"{charm_id}.png"
        if src != dst:
            if dst.exists():
                dst.unlink()
            src.rename(dst)
        final[charm_id] = f"assets/charms-hd/{charm_id}.png"

    # Copy unmatched HD images as extras (dangles, couples, etc.)
    extras = []
    for stem, rel in processed_paths.items():
        if stem in used_stems:
            continue
        src = ROOT / rel
        extra_id = f"extra-{stem}"
        dst = OUT / f"{extra_id}.png"
        if src.exists() and not dst.exists():
            src.rename(dst)
        extras.append(extra_id)

    print(f"mapped {len(final)} catalog charms, {len(extras)} extra charms")
    return final


def write_charm_images_js(charm_map: dict[str, str]) -> None:
    js_path = ROOT / "assets" / "js" / "charm-images.js"
    text = js_path.read_text(encoding="utf-8")

    entries = []
    for k, v in sorted(charm_map.items()):
        entries.append(f'  "{k}": "{v}",')
    block = "\n".join(entries)

    new_text = re.sub(
        r"const IMAGE_VERSION = '[^']*';",
        "const IMAGE_VERSION = 'v5-hd';",
        text,
        count=1,
    )
    new_text = re.sub(
        r"const CHARM_IMAGE_MAP = \{[\s\S]*?\};",
        f"const CHARM_IMAGE_MAP = {{\n{block}\n}};",
        new_text,
        count=1,
    )
    js_path.write_text(new_text, encoding="utf-8")
    print(f"updated {js_path}")


def main() -> None:
    src_dir = SRC if SRC.exists() else ROOT / "example" / "bracelet-zip"
    if not src_dir.exists():
        raise SystemExit(f"Source not found: {src_dir}")

    processed = process_all(src_dir)
    MAP_FILE.write_text(json.dumps(processed, indent=2), encoding="utf-8")

    charm_map = map_to_catalog(processed)
    MAP_FILE.write_text(json.dumps({"processed": processed, "charm_map": charm_map}, indent=2), encoding="utf-8")
    write_charm_images_js(charm_map)


if __name__ == "__main__":
    main()