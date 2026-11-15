"""
Cut the nine trip-planner icons out of one Google Flow image (a 3x3 sheet on a flat navy background).

    .venv\\Scripts\\python tools\\make_trip_icons.py <path to the downloaded sheet>

Order in the sheet (left to right, top to bottom): dry, maybe, wet, hourly, dates, compare, where, packing, copilot.
Each icon is found by looking for the pixels that differ from the background inside its cell, then centred on a square tile of the
sheet's own background colour and saved as web/img/trip/icons/<name>.png (256 x 256). The pictures are AI-made (Google Flow).
"""
import sys
from pathlib import Path

from PIL import Image

NAMES = ["dry", "maybe", "wet", "hourly", "dates", "compare", "where", "packing", "copilot"]
OUT = Path(__file__).resolve().parent.parent / "web" / "img" / "trip" / "icons"
SIZE = 256
MARGIN = 0.14          # empty border around each icon, as a share of the tile


def far(px, bg, tol=38):
    return max(abs(px[i] - bg[i]) for i in range(3)) > tol


def main(path):
    sheet = Image.open(path).convert("RGB")
    w, h = sheet.size
    bg = sheet.getpixel((8, 8))                                   # the flat background colour
    cw, ch = w // 3, h // 3
    OUT.mkdir(parents=True, exist_ok=True)
    for i, name in enumerate(NAMES):
        r, c = divmod(i, 3)
        cell = sheet.crop((c * cw, r * ch, (c + 1) * cw, (r + 1) * ch))
        px = cell.load()
        xs, ys = [], []
        for y in range(0, ch, 2):
            for x in range(0, cw, 2):
                if far(px[x, y], bg):
                    xs.append(x); ys.append(y)
        if not xs:
            print("no icon found in cell", name); continue
        x0, x1, y0, y1 = min(xs), max(xs), min(ys), max(ys)
        side = int(max(x1 - x0, y1 - y0) * (1 + 2 * MARGIN))
        cx, cy = (x0 + x1) // 2, (y0 + y1) // 2
        box = (cx - side // 2, cy - side // 2, cx + side // 2, cy + side // 2)
        tile = Image.new("RGB", (side, side), bg)
        tile.paste(cell.crop(box), (0, 0))                        # crop() pads with black outside the cell, so start from the background
        # (the box stays inside the cell because each icon has a generous margin; if not, the padding is the background colour)
        tile = tile.resize((SIZE, SIZE), Image.LANCZOS)
        tile.save(OUT / f"{name}.png", optimize=True)
        print("saved", name, "bbox", (x0, y0, x1, y1))


if __name__ == "__main__":
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    main(sys.argv[1])
