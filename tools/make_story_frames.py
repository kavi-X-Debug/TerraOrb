"""
Cut the nine animation frames of the landing page's "How it works" section out of one Google Flow storyboard sheet.

    .venv\\Scripts\\python tools\\make_story_frames.py <path to the downloaded 3 x 3 sheet>

The sheet is a 3 x 3 grid of 16:9 frames on a flat very dark background. The gutters are found by looking at which columns and rows contain
only background, so the cut does not depend on exact pixel positions. Each frame is trimmed a few pixels (edge shading), cropped to
16:9 and saved as web/img/landing/story-1.jpg ... story-9.jpg (1280 x 720), in reading order. The pictures are AI-made (Google Flow).
"""
import sys
from pathlib import Path

from PIL import Image

OUT = Path(__file__).resolve().parent.parent / "web" / "img" / "landing"
W, H = 1280, 720
TRIM = 0.006            # share of a frame's size cut from each edge


def segments(profile, min_len):
    """Runs of True in a list of booleans, longer than min_len: [(start, end)] (end exclusive)."""
    runs, start = [], None
    for i, v in enumerate(profile + [False]):
        if v and start is None:
            start = i
        elif not v and start is not None:
            if i - start >= min_len:
                runs.append((start, i))
            start = None
    return runs


def find_tiles(img, bg, tol=22):
    w, h = img.size
    px = img.load()
    far = lambda p: max(abs(p[k] - bg[k]) for k in range(3)) > tol          # noqa: E731
    cols = [any(far(px[x, y]) for y in range(0, h, 4)) for x in range(w)]    # does this column hold any picture?
    xs = segments(cols, w // 12)
    tiles = []
    ys_all = []
    for (x0, x1) in xs:
        rows = [any(far(px[x, y]) for x in range(x0, x1, 4)) for y in range(h)]
        ys_all.append(segments(rows, h // 12))
    return xs, ys_all


def main(path):
    img = Image.open(path).convert("RGB")
    bg = img.getpixel((3, 3))
    xs, ys_all = find_tiles(img, bg)
    if len(xs) != 3 or any(len(r) != 3 for r in ys_all):
        sys.exit(f"Expected a 3 x 3 grid but found {len(xs)} columns and rows per column {[len(r) for r in ys_all]}. Is this the storyboard sheet?")
    OUT.mkdir(parents=True, exist_ok=True)
    n = 0
    for r in range(3):
        for c in range(3):
            x0, x1 = xs[c]
            y0, y1 = ys_all[c][r]
            tw, th = x1 - x0, y1 - y0
            tile = img.crop((x0 + int(tw * TRIM), y0 + int(th * TRIM), x1 - int(tw * TRIM), y1 - int(th * TRIM)))
            scale = max(W / tile.width, H / tile.height)                   # cover, then centre-crop to exactly 16:9
            tile = tile.resize((round(tile.width * scale), round(tile.height * scale)), Image.LANCZOS)
            left, top = (tile.width - W) // 2, (tile.height - H) // 2
            n += 1
            tile.crop((left, top, left + W, top + H)).save(OUT / f"story-{n}.jpg", quality=86, optimize=True)
            print("saved", f"story-{n}.jpg", "from", (x0, y0, x1, y1))


if __name__ == "__main__":
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    main(sys.argv[1])
