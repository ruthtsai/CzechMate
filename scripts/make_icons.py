"""Generate the CzechMate app icons into public/icons (run: npm run icons).

The mark is a cream "C" with a brick-red háček above it ("Č"), on forest green.
Drawn at 4x and downsampled for smooth edges.
"""
from pathlib import Path

from PIL import Image, ImageDraw

FOREST = (52, 78, 65)
CREAM = (245, 243, 235)
BRICK = (166, 75, 60)
OUT = Path(__file__).resolve().parent.parent / "public" / "icons"


def draw(size: int, scale: float) -> Image.Image:
    """scale = share of the canvas used by the glyph (maskable icons need a safe zone)."""
    s = size * 4
    img = Image.new("RGB", (s, s), FOREST)
    d = ImageDraw.Draw(img)
    g = s * scale
    cx, cy = s / 2, s / 2 + g * 0.08
    r = g * 0.30
    w = g * 0.11
    d.arc([cx - r, cy - r, cx + r, cy + r], start=40, end=320, fill=CREAM, width=int(w))
    # háček
    hw, hy, hd = g * 0.13, cy - r - g * 0.13, g * 0.08
    d.line([(cx - hw, hy - hd), (cx, hy + hd * 0.4), (cx + hw, hy - hd)], fill=BRICK, width=int(w * 0.62), joint="curve")
    return img.resize((size, size), Image.LANCZOS)


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    draw(180, 0.86).save(OUT / "apple-touch-icon.png")
    draw(192, 0.86).save(OUT / "icon-192.png")
    draw(512, 0.86).save(OUT / "icon-512.png")
    draw(512, 0.66).save(OUT / "icon-maskable-512.png")
    print("icons written to", OUT)


if __name__ == "__main__":
    main()
