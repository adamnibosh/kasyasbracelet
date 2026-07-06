#!/usr/bin/env python3
"""Regenerate A–Z silver letter PNGs from Nomination JPG photos."""
from __future__ import annotations

import importlib.util
import re
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
OLD = ROOT / "assets" / "charms"
OUT = ROOT / "assets" / "charms-hd"
SRC = ROOT / "example" / "bracelet-zip-raw"
if not SRC.exists():
    SRC = ROOT / "example" / "bracelet-zip"

spec = importlib.util.spec_from_file_location("proc", ROOT / "scripts" / "process-bracelet-zip.py")
proc = importlib.util.module_from_spec(spec)
spec.loader.exec_module(proc)


def process_old_jpg(charm_id: str) -> Image.Image:
    path = OLD / f"{charm_id}.jpg"
    if not path.exists():
        raise FileNotFoundError(path)
    im = Image.open(path).convert("RGBA")
    white = Image.new("RGBA", im.size, (255, 255, 255, 255))
    white.paste(im, (0, 0))
    im = proc.remove_white_bg(white)
    im = proc.enhance(im)
    return proc.to_square_canvas(im, 512)


def find_bone_source() -> Path | None:
    matches = [p for p in SRC.glob("1bb9b5ed0f22*") if p.suffix.lower() in {".webp", ".png", ".jpg"}]
    return matches[0] if matches else None


def silverize_dark(im: Image.Image) -> Image.Image:
    im = im.convert("RGBA")
    px = []
    for r, g, b, a in im.getdata():
        if a > 20 and r < 100 and g < 100 and b < 100:
            lum = max(r, g, b)
            scale = (165 - lum) / max(1, 100 - lum)
            px.append((
                min(255, int(175 + scale * 15)),
                min(255, int(180 + scale * 15)),
                min(255, int(190 + scale * 15)),
                a,
            ))
        else:
            px.append((r, g, b, a))
    im.putdata(px)
    return im


def process_bone() -> None:
    src = find_bone_source()
    if not src:
        print("WARN: bone source missing")
        return
    im = Image.open(src).convert("RGBA")
    im = proc.remove_white_bg(im)
    im = silverize_dark(im)
    im = proc.enhance(im)
    im = proc.to_square_canvas(im, 512)
    out = OUT / "bone-link.png"
    im.save(out, "PNG", optimize=True)
    print(f"bone-link <- {src.name} (silverized)")


def bump_image_version() -> None:
    path = ROOT / "assets" / "js" / "charm-images.js"
    text = path.read_text(encoding="utf-8")
    text = re.sub(
        r"const IMAGE_VERSION = '[^']+';",
        "const IMAGE_VERSION = 'v9-silver-letters';",
        text,
        count=1,
    )
    path.write_text(text, encoding="utf-8")


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    for letter in "abcdefghijklmnopqrstuvwxyz":
        charm_id = f"letter-{letter}"
        im = process_old_jpg(charm_id)
        out = OUT / f"{charm_id}.png"
        im.save(out, "PNG", optimize=True)
        print(f"{charm_id} <- nomination jpg")
    process_bone()
    bump_image_version()
    print("Done — silver letters + bone")


if __name__ == "__main__":
    main()