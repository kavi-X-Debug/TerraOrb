"""
Cut the home-page pictures out of the Google Flow sheets and put them in web/img/home/.

    .venv\\Scripts\\python tools\\make_home_images.py farmer  <sheet.png>     # 3 columns x 2 rows -> farmer-1..6.jpg
    .venv\\Scripts\\python tools\\make_home_images.py officer <sheet.png>     # 2 x 2              -> officer-1..4.jpg
    .venv\\Scripts\\python tools\\make_home_images.py research <sheet.png>    # 2 x 2              -> research-1..4.jpg
    .venv\\Scripts\\python tools\\make_home_images.py hero <end> <picture>    # one wide picture   -> hero-<end>.jpg  (farmer|learn|officer|research|plan)

Each sheet is a grid of separate rounded tiles on a flat dark background. A tile is found by looking, inside its grid cell, for the pixels
that differ from the background; it is then trimmed a little (rounded corners), cropped to 16:10 and saved at 640 x 400. The pictures are
AI-made (Google Flow).
"""
import sys
from pathlib import Path

from PIL import Image

OUT = Path(__file__).resolve().parent.parent / "web" / "img" / "home"
GRIDS = {"farmer": (3, 2), "officer": (2, 2), "research": (2, 2)}
W, H = 640, 400


def far(px, bg, tol=26):
    return max(abs(px[i] - bg[i]) for i in range(3)) > tol


def cover(im, w, h):
    """Resize and centre-crop to exactly w x h."""
    scale = max(w / im.width, h / im.height)
    im = im.resize((round(im.width * scale), round(im.height * scale)), Image.LANCZOS)
    x, y = (im.width - w) // 2, (im.height - h) // 2
    return im.crop((x, y, x + w, y + h))


def sheet(name, path):
    cols, rows = GRIDS[name]
    img = Image.open(path).convert("RGB")
    bg = img.getpixel((4, 4))
    cw, ch = img.width // cols, img.height // rows
    OUT.mkdir(parents=True, exist_ok=True)
    n = 0
    for r in range(rows):
        for c in range(cols):
            cell = img.crop((c * cw, r * ch, (c + 1) * cw, (r + 1) * ch))
            px = cell.load()
            xs, ys = [], []
            for y in range(0, ch, 3):
                for x in range(0, cw, 3):
                    if far(px[x, y], bg):
                        xs.append(x); ys.append(y)
            if not xs:
                print("no picture in cell", r, c); continue
            x0, x1, y0, y1 = min(xs), max(xs), min(ys), max(ys)
            trim = int(0.035 * min(x1 - x0, y1 - y0))                    # drop the rounded corners and any edge glow
            tile = cell.crop((x0 + trim, y0 + trim, x1 - trim, y1 - trim))
            n += 1
            cover(tile, W, H).save(OUT / f"{name}-{n}.jpg", quality=88, optimize=True)
            print("saved", f"{name}-{n}.jpg", "from", (x0, y0, x1, y1))


def hero(end, path):
    OUT.mkdir(parents=True, exist_ok=True)
    img = Image.open(path).convert("RGB")
    scale = min(1.0, 1600 / img.width)
    if scale < 1:
        img = img.resize((round(img.width * scale), round(img.height * scale)), Image.LANCZOS)
    img.save(OUT / f"hero-{end}.jpg", quality=86, optimize=True)
    print("saved", f"hero-{end}.jpg", img.size)


if __name__ == "__main__":
    a = sys.argv[1:]
    if len(a) == 2 and a[0] in GRIDS:
        sheet(a[0], a[1])
    elif len(a) == 3 and a[0] == "hero":
        hero(a[1], a[2])
    else:
        sys.exit(__doc__)
