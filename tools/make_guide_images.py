"""
Cut guide pictures out of a Google Flow sheet and save them in web/img/guide/.

    .venv\\Scripts\\python tools\\make_guide_images.py <sheet.png> <cols> <rows> <end>-<section> <end>-<section> ...

The sheet is a grid of separate tiles on a flat dark background; tiles are read in order (left to right, top to bottom) and saved as
web/img/guide/<name>.jpg at 640 x 400 (16:10). The tile of each grid cell is found by looking for pixels that differ from the background.
Pictures are AI-made (Google Flow).
"""
import sys
from pathlib import Path

from PIL import Image

OUT = Path(__file__).resolve().parent.parent / "web" / "img" / "guide"
W, H = 640, 400


def far(px, bg, tol=26):
    return max(abs(px[i] - bg[i]) for i in range(3)) > tol


def tile_box(img, bg, x0, y0, x1, y1):
    px = img.load()
    xs = [x for x in range(x0, x1, 2) if any(far(px[x, y], bg) for y in range(y0, y1, 6))]
    ys = [y for y in range(y0, y1, 2) if any(far(px[x, y], bg) for x in range(x0, x1, 6))]
    if not xs or not ys:
        return (x0, y0, x1, y1)
    return (min(xs), min(ys), max(xs) + 1, max(ys) + 1)


def main(path, cols, rows, names):
    img = Image.open(path).convert("RGB")
    bg = img.getpixel((3, 3))
    cw, ch = img.width / cols, img.height / rows
    OUT.mkdir(parents=True, exist_ok=True)
    for i, name in enumerate(names):
        r, c = divmod(i, cols)
        x0, y0, x1, y1 = tile_box(img, bg, int(c * cw), int(r * ch), int((c + 1) * cw), int((r + 1) * ch))
        tw, th = x1 - x0, y1 - y0
        tile = img.crop((x0 + int(tw * 0.012), y0 + int(th * 0.012), x1 - int(tw * 0.012), y1 - int(th * 0.012)))
        scale = max(W / tile.width, H / tile.height)
        tile = tile.resize((round(tile.width * scale), round(tile.height * scale)), Image.LANCZOS)
        left, top = (tile.width - W) // 2, (tile.height - H) // 2
        tile.crop((left, top, left + W, top + H)).save(OUT / f"{name}.jpg", quality=84, optimize=True)
        print("saved", f"{name}.jpg", "from", (x0, y0, x1, y1))


if __name__ == "__main__":
    if len(sys.argv) < 5:
        sys.exit(__doc__)
    main(sys.argv[1], int(sys.argv[2]), int(sys.argv[3]), sys.argv[4:])
