#!/usr/bin/env python3
"""Process ALL bracelet.zip images (bg removed) and build full charm catalog."""
from __future__ import annotations

import importlib.util
import json
import re
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "example" / "bracelet-zip-raw"
if not SRC.exists():
    SRC = ROOT / "example" / "bracelet-zip"
OUT = ROOT / "assets" / "charms-hd"

spec = importlib.util.spec_from_file_location("proc", ROOT / "scripts" / "process-bracelet-zip.py")
proc = importlib.util.module_from_spec(spec)
spec.loader.exec_module(proc)

# Letter variants only — standard A–Z come from FROM_OLD_JPG Nomination photos
LETTER_STEMS = {}

CATALOG_STEMS = {
    "blank-silver": "2c2776f394b2",
    "bmw": "3eb34929c0e8",
    "bow-blue": "7d16b6e1da80",
    "bow-pink": "852fd313ae35",
    "butterfly": "139271dd8198",
    "cat-black": "f057f31fc0fc",
    "checkered-red": "7bc9c162dbab",
    "cherry": "4632fd88fbc1",
    "enamel-blue": "2514e8bcf986",
    "enamel-pink": "f39f22268d7f",
    "flower": "0f93bbed31d3",
    "heart-magnetic": "08d30dbb23ae",
    "heart-pink": "09dffd3b692e",
    "heart-silver": "8d211a7914b3",
    "i-love-u": "da36df2186ad",
    "infinity": "38cb9ce8c572",
    "jellyfish": "40818727d1ce",
    "kitten": "44458849a9be",
    "moon": "824606636ff5",
    "nameplate": "41f6089450fb",
    "star": "639b7db428bb",
}

# Standard A–Z silver letters — Nomination product photos (not black zip enamel)
FROM_OLD_JPG = [f"letter-{c}" for c in "abcdefghijklmnopqrstuvwxyz"]

# Extra zip charms — stem -> metadata
EXTRA_STEMS: dict[str, dict] = {
    "0cfcbed019c2": {"id": "leopard-star", "name": "Leopard Star", "category": "symbols", "hint": "Red enamel with leopard-print star."},
    "2b8bafc6cfb1": {"id": "spiderweb-heart", "name": "Spiderweb Heart", "category": "love", "hint": "Red panel with white spiderweb and heart."},
    "86d155665c2e": {"id": "spiderman", "name": "Spider-Man Mask", "category": "pop", "hint": "Spider-Man mask on silver link."},
    "95d4d48dff23": {"id": "cool-cat", "name": "Cool Cat", "category": "animals", "hint": "Pink panel with sunglasses cat."},
    "232d91e0673f": {"id": "racing-flags", "name": "Racing Flags Dangle", "category": "dangles", "dangling": True, "hint": "Checkered racing flags on dangling link."},
    "b453980fc1bf": {"id": "lucky-eight", "name": "Lucky Number 1", "category": "symbols", "hint": "Pool ball lucky number charm."},
    "4cf43f8c91f8": {"id": "racing-checker", "name": "Racing Checker", "category": "symbols", "hint": "Diagonal racing checkered flag panel."},
    "cc88b4ef5ec5": {"id": "bandaid-heart", "name": "Bandaid Heart", "category": "love", "hint": "Red enamel with bandaid and heart."},
    "1bb9b5ed0f22": {"id": "bone-link", "name": "Bone Link", "category": "symbols", "hint": "Silver link with bone silhouette."},
    "06f00d131b33": {"id": "paw-print", "name": "Paw Print", "category": "animals", "hint": "Animal paw print charm."},
    "269c37e0285e": {"id": "pink-red-grid", "name": "Pink Red Grid", "category": "symbols", "hint": "Red and pink checker grid enamel."},
    "3c7711486187": {"id": "sunburst-heart", "name": "Sunburst Heart", "category": "love", "hint": "Pink sunburst with glossy heart."},
    "292344e22778": {"id": "heart-web-red", "name": "Red Heart Web", "category": "love", "hint": "Red heart spiderweb design."},
    "0cf97b08843d": {"id": "letter-c-gold", "name": "Gold Letter C", "category": "letters", "letter": "C", "hint": "Gold-accent letter C variant."},
    "63a554ffe48d": {"id": "rose-heart", "name": "Rose Gold Heart", "category": "love", "hint": "Rose gold heart charm link."},
    "840425e6d96a": {"id": "rhinestone-heart", "name": "Rhinestone Heart Dangle", "category": "dangles", "dangling": True, "hint": "Pink rhinestone heart pendant."},
    "1903e29185e2": {"id": "pink-bow-dangle", "name": "Pink Bow Dangle", "category": "dangles", "dangling": True, "hint": "Dangling pink bow charm."},
    "2d8a2b2d7a38": {"id": "couple-hearts", "name": "Couple Hearts", "category": "couples", "hint": "Matching couple heart link."},
    "3a5190b11af1": {"id": "magnetic-couple", "name": "Magnetic Couple", "category": "magnetic", "hint": "Magnetic couple charm pair style."},
    "565ec05d41fa": {"id": "keychain-heart", "name": "Heart Keychain", "category": "keychains", "hint": "Heart keychain-style charm."},
    "998fd0c8bc99": {"id": "keychain-star", "name": "Star Keychain", "category": "keychains", "hint": "Star keychain-style charm."},
    "fc26fe732291": {"id": "full-bracelet-gold", "name": "Gold Bracelet Sample", "category": "collection", "hint": "Full bracelet reference from collection."},
    "0a4eb69f729c": {"id": "silver-wave", "name": "Silver Wave", "category": "silver", "hint": "Brushed silver wave pattern link."},
    "0da4ce6fb431": {"id": "blue-sparkle", "name": "Blue Sparkle", "category": "symbols", "hint": "Blue sparkle enamel charm."},
    "144a04b27cae": {"id": "pink-glitter", "name": "Pink Glitter", "category": "symbols", "hint": "Pink glitter enamel charm."},
    "1604b9bfe1ad": {"id": "lavender-heart", "name": "Lavender Heart", "category": "love", "hint": "Soft lavender heart enamel."},
    "3306ec474f07": {"id": "butterfly-blue", "name": "Blue Butterfly Link", "category": "animals", "hint": "Blue butterfly on silver."},
    "38ea6538407a": {"id": "flower-dangle", "name": "Flower Dangle", "category": "dangles", "dangling": True, "hint": "Dangling flower charm."},
    "3b03ceb63525": {"id": "red-diamond", "name": "Red Diamond", "category": "symbols", "hint": "Red diamond pattern link."},
    "4adaefbb8fb4": {"id": "silver-star-dangle", "name": "Star Dangle", "category": "dangles", "dangling": True, "hint": "Dangling silver star."},
    "4bfd242d8d3a": {"id": "pink-cat", "name": "Pink Cat", "category": "animals", "hint": "Pink cat silhouette charm."},
    "4df47dbc978b": {"id": "dog-paw", "name": "Dog Paw", "category": "animals", "hint": "Dog paw print charm."},
    "579721a8df40": {"id": "music-note", "name": "Music Note", "category": "symbols", "hint": "Music note silver charm."},
    "589efa241d0b": {"id": "gold-letter-m", "name": "Gold Letter M", "category": "letters", "letter": "M", "hint": "Gold-accent letter M."},
    "59b73835112c": {"id": "crown", "name": "Silver Crown", "category": "symbols", "hint": "Crown emblem on silver."},
    "5a303ea2f178": {"id": "angel-wings", "name": "Angel Wings", "category": "symbols", "hint": "Angel wings charm link."},
    "5add36c6abcf": {"id": "cross-silver", "name": "Silver Cross", "category": "symbols", "hint": "Polished silver cross charm."},
    "5dc796c30479": {"id": "peace-sign", "name": "Peace Sign", "category": "symbols", "hint": "Peace sign enamel charm."},
    "5e200c51b10f": {"id": "smiley", "name": "Smiley Face", "category": "symbols", "hint": "Happy smiley face charm."},
    "66fdb95b1806": {"id": "letter-s-bold", "name": "Bold Letter S", "category": "letters", "letter": "S", "hint": "Bold black letter S variant."},
    "6a64fcf65481": {"id": "letter-u-round", "name": "Round Letter U", "category": "letters", "letter": "U", "hint": "Rounded letter U variant."},
    "75023662acf1": {"id": "dangle-moon", "name": "Moon Dangle", "category": "dangles", "dangling": True, "hint": "Crescent moon dangling charm."},
    "789613751b37": {"id": "horseshoe", "name": "Lucky Horseshoe", "category": "symbols", "hint": "Silver horseshoe luck charm."},
    "7e8173662fcf": {"id": "dolphin", "name": "Dolphin", "category": "animals", "hint": "Dolphin enamel charm."},
    "84bf7d1d8ccb": {"id": "turtle", "name": "Turtle", "category": "animals", "hint": "Turtle charm link."},
    "8b4d3c6264a1": {"id": "letter-r-script", "name": "Script Letter R", "category": "letters", "letter": "R", "hint": "Script letter R variant."},
    "8f8f9480c4cc": {"id": "penguin", "name": "Penguin", "category": "animals", "hint": "Penguin charm on silver."},
    "963c9a464afe": {"id": "panda", "name": "Panda", "category": "animals", "hint": "Panda face charm."},
    "a0a9687a9367": {"id": "owl", "name": "Owl", "category": "animals", "hint": "Owl charm link."},
    "af775a1e4a7a": {"id": "letter-z-gold", "name": "Gold Letter Z", "category": "letters", "letter": "Z", "hint": "Gold-accent letter Z."},
    "b739b9bba662": {"id": "letter-t-serif", "name": "Serif Letter T", "category": "letters", "letter": "T", "hint": "Serif letter T variant."},
    "b9e6ea5e2a37": {"id": "anchor", "name": "Anchor", "category": "symbols", "hint": "Nautical anchor charm."},
    "c19ebf68eac2": {"id": "compass", "name": "Compass", "category": "symbols", "hint": "Compass rose charm."},
    "c848db3df828": {"id": "camera", "name": "Camera", "category": "pop", "hint": "Camera charm link."},
    "c8bd758961c3": {"id": "letter-j-cursive", "name": "Cursive Letter J", "category": "letters", "letter": "J", "hint": "Cursive letter J variant."},
    "cc00dd3c5dcc": {"id": "letter-c-alt", "name": "Alt Letter C", "category": "letters", "letter": "C", "hint": "Alternate letter C style."},
    "d19d14097cb2": {"id": "gem-pink", "name": "Pink Gem", "category": "symbols", "hint": "Pink gemstone charm."},
    "d368870b0676": {"id": "letter-o-round", "name": "Round Letter O", "category": "letters", "letter": "O", "hint": "Round letter O variant."},
    "dc51f2bc984d": {"id": "snowflake", "name": "Snowflake", "category": "symbols", "hint": "Silver snowflake charm."},
    "e7f89c308173": {"id": "sun", "name": "Sun", "category": "symbols", "hint": "Bright sun enamel charm."},
    "ee0bc8cb4d6b": {"id": "rainbow", "name": "Rainbow", "category": "symbols", "hint": "Rainbow arc charm."},
    "ef099585eb38": {"id": "unicorn", "name": "Unicorn", "category": "animals", "hint": "Unicorn charm link."},
    "f1301a9bd819": {"id": "letter-w-wide", "name": "Wide Letter W", "category": "letters", "letter": "W", "hint": "Wide letter W variant."},
    "fb842358a27e": {"id": "cupcake", "name": "Cupcake", "category": "symbols", "hint": "Cupcake charm link."},
    "2cf0d11c9912": {"id": "letter-q-gold", "name": "Gold Letter Q", "category": "letters", "letter": "Q", "hint": "Gold-accent letter Q."},
    "4433f5c58e76": {"id": "letter-v-slim", "name": "Slim Letter V", "category": "letters", "letter": "V", "hint": "Slim letter V variant."},
    "20265affe89a": {"id": "letter-e-round", "name": "Round Letter E", "category": "letters", "letter": "E", "hint": "Round letter E variant."},
}


def find_best_source(stem: str) -> Path | None:
    matches = [p for p in SRC.glob(f"{stem}*") if p.suffix.lower() in {".webp", ".png", ".jpg", ".jpeg"}]
    if not matches:
        return None
    return max(matches, key=lambda p: max(Image.open(p).size))


OLD = ROOT / "assets" / "charms"


def process_old_jpg(charm_id: str) -> Image.Image:
    path = OLD / f"{charm_id}.jpg"
    im = Image.open(path).convert("RGBA")
    white = Image.new("RGBA", im.size, (255, 255, 255, 255))
    white.paste(im, (0, 0))
    im = proc.remove_white_bg(white)
    im = proc.enhance(im)
    return proc.to_square_canvas(im, 512)


def process_to_png(path: Path, out: Path) -> None:
    im = Image.open(path)
    im = proc.remove_white_bg(im)
    im = proc.enhance(im)
    im = proc.to_square_canvas(im, 512)
    out.parent.mkdir(parents=True, exist_ok=True)
    im.save(out, "PNG", optimize=True)


def auto_extra(stem: str, idx: int) -> dict:
    return {
        "id": f"zip-{stem}",
        "name": f"Collection Charm {idx:02d}",
        "category": "collection",
        "hint": "Italian charm from the full bracelet collection.",
    }


def main() -> None:
    all_stems = sorted({p.name.split("~")[0][:12] for p in SRC.glob("*") if p.is_file()})
    used_stems: set[str] = set()
    image_map: dict[str, str] = {}
    extra_charms: list[dict] = []

    # Clear old extra-* files
    for old in OUT.glob("extra-*.png"):
        old.unlink()
    for old in OUT.glob("zip-*.png"):
        old.unlink()

    # Catalog + letters from zip
    id_to_stem = {**CATALOG_STEMS, **LETTER_STEMS}
    for charm_id, stem in sorted(id_to_stem.items()):
        src = find_best_source(stem)
        if not src:
            print(f"WARN missing {charm_id} <- {stem}")
            continue
        out = OUT / f"{charm_id}.png"
        process_to_png(src, out)
        image_map[charm_id] = f"assets/charms-hd/{charm_id}.png"
        used_stems.add(stem)
        print(f"{charm_id} <- {stem}")

    for charm_id in FROM_OLD_JPG:
        im = process_old_jpg(charm_id)
        out = OUT / f"{charm_id}.png"
        im.save(out, "PNG", optimize=True)
        image_map[charm_id] = f"assets/charms-hd/{charm_id}.png"
        print(f"{charm_id} <- nomination jpg")

    # Named extras
    auto_idx = 1
    for stem in all_stems:
        if stem in used_stems:
            continue
        meta = EXTRA_STEMS.get(stem) or auto_extra(stem, auto_idx)
        if stem not in EXTRA_STEMS:
            auto_idx += 1
        cid = meta["id"]
        src = find_best_source(stem)
        if not src:
            continue
        out = OUT / f"{cid}.png"
        process_to_png(src, out)
        image_map[cid] = f"assets/charms-hd/{cid}.png"
        used_stems.add(stem)
        extra_charms.append({**meta, "stem": stem})
        print(f"{cid} <- {stem}")

    # Write charm-images.js
    version = "v7-full-zip"
    lines = [
        "/** All bracelet.zip charms — transparent HD */",
        f"const IMAGE_VERSION = '{version}';",
        "",
        "const CHARM_IMAGE_MAP = {",
    ]
    for k, v in sorted(image_map.items()):
        lines.append(f'  "{k}": "{v}",')
    lines += [
        "};",
        "",
        "function getCharmImageUrl(charmId) {",
        "  return CHARM_IMAGE_MAP[charmId] || CHARM_IMAGE_MAP['blank-silver'];",
        "}",
        "",
        "function assetUrl(path) {",
        "  if (typeof document === 'undefined') return path;",
        '  const base = document.querySelector(\'meta[name="base-path"]\')?.content || \'\';',
        "  if (!path || path.startsWith('http') || path.startsWith('data:')) return path;",
        "  const clean = path.replace(/^\\//, '');",
        "  const withBase = (!base || location.hostname === 'localhost' || location.hostname === '127.0.0.1')",
        "    ? clean",
        "    : `${base.replace(/\\/$/, '')}/${clean}`;",
        "  const sep = withBase.includes('?') ? '&' : '?';",
        "  return `${withBase}${sep}v=${IMAGE_VERSION}`;",
        "}",
        "",
    ]
    (ROOT / "assets" / "js" / "charm-images.js").write_text("\n".join(lines), encoding="utf-8")

    # Write zip-charms.js
    zlines = [
        "/** Auto-generated extra charms from bracelet.zip */",
        "const ZIP_CHARMS = [",
    ]
    for m in extra_charms:
        parts = [
            f"  {{",
            f"    id: '{m['id']}',",
            f"    name: '{m['name'].replace(chr(39), chr(92)+chr(39))}',",
            f"    shopLabel: '9mm {m['name']} Italian charm link',",
            f"    category: '{m['category']}',",
            f"    render: '{m['id']}',",
            f"    hint: '{m.get('hint', '').replace(chr(39), chr(92)+chr(39))}',",
        ]
        if m.get("dangling"):
            parts.append("    dangling: true,")
        if m.get("letter"):
            parts.append(f"    letter: '{m['letter']}',")
        parts.append("  },")
        zlines.extend(parts)
    zlines.append("];")
    (ROOT / "assets" / "js" / "zip-charms.js").write_text("\n".join(zlines) + "\n", encoding="utf-8")

    # Patch charms.js categories + merge ZIP_CHARMS
    charms_path = ROOT / "assets" / "js" / "charms.js"
    text = charms_path.read_text(encoding="utf-8")

    new_cats = """const CHARM_CATEGORIES = [
  { id: 'letters', label: 'Silver Letters', icon: 'A' },
  { id: 'love', label: 'Hearts & Love', icon: '♥' },
  { id: 'animals', label: 'Animals', icon: '🐱' },
  { id: 'symbols', label: 'Symbols & Patterns', icon: '✦' },
  { id: 'dangles', label: 'Dangles', icon: '◇' },
  { id: 'couples', label: 'Couples', icon: '∞' },
  { id: 'magnetic', label: 'Magnetic', icon: '⊕' },
  { id: 'keychains', label: 'Keychains', icon: '🔑' },
  { id: 'pop', label: 'Pop Culture', icon: '★' },
  { id: 'silver', label: 'Silver Basics', icon: '◻' },
  { id: 'collection', label: 'Full Collection', icon: '✦' },
];"""

    text = re.sub(
        r"const CHARM_CATEGORIES = \[[\s\S]*?\];",
        new_cats,
        text,
        count=1,
    )

    if "letter," not in text.split("CHARMS = [")[1][:200]:
        pass

    # Update letter hint to zip style
    text = text.replace(
        "hint: 'Raised sterling silver letter on brushed silver base.',",
        "hint: 'Sterling silver letter charm from the collection.',",
    )

    if "_BASE_CHARMS" not in text:
        text = text.replace("const CHARMS = [", "const _BASE_CHARMS = [", 1)
        text = text.replace(
            "\nconst CHARM_MAP = Object.fromEntries(CHARMS.map((c) => [c.id, c]));",
            "\n\nconst CHARMS = [..._BASE_CHARMS, ...ZIP_CHARMS];\n\nconst CHARM_MAP = Object.fromEntries(CHARMS.map((c) => [c.id, c]));",
        )

    charms_path.write_text(text, encoding="utf-8")

    (ROOT / "scripts" / "full-zip-catalog.json").write_text(
        json.dumps({"total": len(image_map), "extras": len(extra_charms), "image_map": image_map}, indent=2),
        encoding="utf-8",
    )
    print(f"\nDone: {len(image_map)} transparent charms ({len(extra_charms)} new from zip)")


if __name__ == "__main__":
    main()