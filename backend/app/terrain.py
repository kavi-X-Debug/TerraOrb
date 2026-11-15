"""
Terrain analysis for the farm planner (pure functions, no database, no web framework).

What it does, in order (see docs/farm-spec.md section 6):
  1. fetch open elevation tiles ("terrarium" tiles on AWS, made from SRTM and similar sources) and decode them to metres,
     caching every tile on disk under backend/data/dem_cache/ (a tile is downloaded once);
  2. slope in percent (rise over run), D8 flow accumulation (after filling pits), zone classes
        flat < 5 %, gentle 5 to 15 %, steep 15 to 30 %, very_steep > 30 %, and wet_low (lots of water arrives, but the ground is flat);
  3. a RELATIVE erosion index in the style of RUSLE: A = R x K x LS x C x P. It is a relative number for comparing parts of
     one farm. It is NOT tonnes per hectare and must never be shown as such;
  4. zone polygons as GeoJSON (small patches are merged into their neighbours first).

Honesty rules: if the tiles cannot be fetched, `DemUnavailable` is raised and nobody invents elevation. The DEM is about 30 m
in origin (resampled to a finer grid), so on a small plot the slope is an estimate, and the zones say so. Constants marked
"placeholder" are drafts for an expert to review.

Pillow decodes the PNG tiles if it is installed; otherwise a small standard-library decoder is used (needs only numpy).
"""
import heapq
import math
import os
import zlib
from pathlib import Path

import numpy as np

BACKEND = Path(__file__).resolve().parent.parent
DEM_CACHE = BACKEND / "data" / "dem_cache"
TILE_URL = "https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png"
DEM_SOURCE = "AWS Terrain Tiles (terrarium), built from SRTM and other open sources; about 30 m native resolution"

# class numbers used in the grids
FLAT, GENTLE, STEEP, VERY_STEEP, WET_LOW = 0, 1, 2, 3, 4
KINDS = ["flat", "gentle", "steep", "very_steep", "wet_low"]
SLOPE_LIMITS = (5.0, 15.0, 30.0)               # percent: flat < 5, gentle < 15, steep < 30, very_steep above (from the spec)

# --- placeholders (drafts, to be reviewed by an agronomist) ---
WET_AREA_M2 = 5000.0           # a cell is "wet low" if at least this much ground drains through it (and the slope is under 5 %)
MIN_PATCH_HA = 0.02            # patches smaller than this are merged into the neighbour they share the most edge with
AS_CAP_M = 100.0               # cap on the "slope length" term of LS (flow length is not slope length on a rough DEM)
C_FACTOR_DEFAULT = 0.3         # cover factor, annual crop with some residue (assumption)
P_CONTOUR_HEDGES = 0.5         # support practice factor with contour hedges (assumption; spec example halves the index)
EROSION_CUTS = (0.15, 0.5)     # mean relative index: below the first = low, below the second = medium, else high
K_DEFAULT = 0.3                # relative soil erodibility when the soil is unknown (flagged in the output)
K_BY_TEXTURE = {               # draft relative K values by USDA texture class (OMAFRA-style table), not Sri Lanka specific
    "sand": 0.03, "loamy_sand": 0.04, "sandy_loam": 0.13, "loam": 0.30, "silt_loam": 0.38,
    "sandy_clay_loam": 0.20, "clay_loam": 0.30, "silty_clay_loam": 0.32, "clay": 0.22, "silty_clay": 0.26, "silt": 0.40,
}


class DemUnavailable(Exception):
    """The elevation tiles could not be fetched or decoded. Nothing is made up in that case."""


# ----------------------------------------------------------------- tiles and coordinates

def world_size(z):
    return 256 * (2 ** z)


def lonlat_to_pixel(lon, lat, z):
    """Global web-mercator pixel (float) at zoom z."""
    n = world_size(z)
    x = (lon + 180.0) / 360.0 * n
    s = math.sin(math.radians(max(min(lat, 85.0511), -85.0511)))
    y = (0.5 - math.log((1 + s) / (1 - s)) / (4 * math.pi)) * n
    return x, y


def pixel_to_lonlat(x, y, z):
    n = world_size(z)
    lon = x / n * 360.0 - 180.0
    lat = math.degrees(math.atan(math.sinh(math.pi * (1 - 2 * y / n))))
    return lon, lat


def cell_size_m(lat, z):
    """Ground size of one pixel in metres (web mercator is conformal, so x and y are the same)."""
    return 40075016.686 * math.cos(math.radians(lat)) / world_size(z)


def decode_terrarium(rgb):
    """Terrarium encoding: elevation in metres = R*256 + G + B/256 - 32768. `rgb` is an (h, w, 3+) uint8 array."""
    a = np.asarray(rgb, dtype=np.float64)
    return a[..., 0] * 256.0 + a[..., 1] + a[..., 2] / 256.0 - 32768.0


def encode_terrarium(elev):
    """Inverse of decode_terrarium (used to build synthetic test tiles)."""
    v = np.asarray(elev, dtype=np.float64) + 32768.0
    r = np.floor(v / 256.0)
    g = np.floor(v) - r * 256.0
    b = np.floor((v - np.floor(v)) * 256.0)
    return np.stack([r, g, b], axis=-1).astype(np.uint8)


def _png_to_rgb(data):
    """PNG bytes to an (h, w, 3) uint8 array. Pillow if available, else a minimal 8-bit non-interlaced decoder."""
    try:
        from PIL import Image
        import io
        return np.asarray(Image.open(io.BytesIO(data)).convert("RGB"), dtype=np.uint8)
    except ImportError:
        return _png_to_rgb_stdlib(data)


def _png_to_rgb_stdlib(data):
    """Minimal PNG reader (8-bit RGB or RGBA, not interlaced) using only zlib and numpy."""
    if data[:8] != b"\x89PNG\r\n\x1a\n":
        raise DemUnavailable("a tile was not a PNG image")
    pos, idat, ihdr = 8, b"", None
    while pos < len(data):
        length = int.from_bytes(data[pos:pos + 4], "big")
        ctype, body = data[pos + 4:pos + 8], data[pos + 8:pos + 8 + length]
        if ctype == b"IHDR":
            ihdr = body
        elif ctype == b"IDAT":
            idat += body
        pos += 12 + length
    w, h = int.from_bytes(ihdr[0:4], "big"), int.from_bytes(ihdr[4:8], "big")
    depth, color, interlace = ihdr[8], ihdr[9], ihdr[12]
    channels = {2: 3, 6: 4}.get(color)
    if depth != 8 or channels is None or interlace:
        raise DemUnavailable("unsupported PNG type (install Pillow to read it)")
    raw = zlib.decompress(idat)
    stride = w * channels
    out = np.zeros((h, stride), dtype=np.uint8)
    prev = np.zeros(stride, dtype=np.int64)
    p = 0
    for y in range(h):
        f = raw[p]
        line = np.frombuffer(raw, dtype=np.uint8, count=stride, offset=p + 1).astype(np.int64)
        p += stride + 1
        if f == 0:
            cur = line
        elif f == 2:
            cur = (line + prev) & 255
        elif f in (1, 3, 4):                      # these depend on the pixel to the left, so go pixel by pixel
            cur = line.copy()
            for i in range(stride):
                a = cur[i - channels] if i >= channels else 0
                b = prev[i]
                c = prev[i - channels] if i >= channels else 0
                if f == 1:
                    pred = a
                elif f == 3:
                    pred = (a + b) // 2
                else:
                    pa, pb, pc = abs(b - c), abs(a - c), abs(a + b - 2 * c)
                    pred = a if pa <= pb and pa <= pc else (b if pb <= pc else c)
                cur[i] = (cur[i] + pred) & 255
        else:
            raise DemUnavailable("bad PNG filter")
        out[y] = cur
        prev = cur
    return out.reshape(h, w, channels)[..., :3]


def cache_dir():
    return Path(os.environ.get("MC_DEM_CACHE") or DEM_CACHE)


def fetch_tile(z, x, y, client=None):
    """One terrarium tile as an (256, 256, 3) uint8 array. Read from the disk cache, else downloaded once and cached."""
    path = cache_dir() / str(z) / str(x) / f"{y}.png"
    if path.exists():
        try:
            return _png_to_rgb(path.read_bytes())
        except Exception:
            path.unlink(missing_ok=True)           # a damaged cache file is simply fetched again
    try:
        import httpx
        own = client is None
        client = client or httpx.Client(timeout=20.0, follow_redirects=True)
        try:
            r = client.get(TILE_URL.format(z=z, x=x, y=y))
        finally:
            if own:
                client.close()
    except Exception as err:
        raise DemUnavailable(f"could not reach the elevation service: {type(err).__name__}") from err
    if r.status_code != 200:
        raise DemUnavailable(f"the elevation service answered {r.status_code} for tile {z}/{x}/{y}")
    rgb = _png_to_rgb(r.content)
    if rgb.shape[:2] != (256, 256):
        raise DemUnavailable("an elevation tile had an unexpected size")
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(r.content)
    return rgb


def build_dem(bbox, zoom=15, pad_m=120.0, max_cells=420, tile_getter=None):
    """
    Elevation grid covering bbox = (west, south, east, north) plus a margin (water from uphill must be able to flow in).
    Returns {"elev" (h, w) metres, "px0", "py0" (global pixel of the top-left corner), "z", "cell_m", "source"}.
    The zoom is lowered if the area would need more than `max_cells` cells on a side. Raises DemUnavailable on any failure.
    """
    getter = tile_getter or fetch_tile
    west, south, east, north = bbox
    lat0 = (south + north) / 2.0
    for z in range(min(zoom, 15), 11, -1):
        pad_px = pad_m / cell_size_m(lat0, z)
        x0, y1 = lonlat_to_pixel(west, south, z)
        x1, y0 = lonlat_to_pixel(east, north, z)
        px0, py0 = int(math.floor(x0 - pad_px)), int(math.floor(y0 - pad_px))
        px1, py1 = int(math.ceil(x1 + pad_px)), int(math.ceil(y1 + pad_px))
        if max(px1 - px0, py1 - py0) <= max_cells:
            break
    else:
        raise ValueError("the plot is too large for terrain analysis")
    if max(px1 - px0, py1 - py0) > max_cells:
        raise ValueError("the plot is too large for terrain analysis")
    grid = np.zeros((py1 - py0, px1 - px0))
    for ty in range(py0 // 256, (py1 - 1) // 256 + 1):
        for tx in range(px0 // 256, (px1 - 1) // 256 + 1):
            tile = decode_terrarium(getter(z, tx, ty))
            gx0, gy0 = max(px0, tx * 256), max(py0, ty * 256)
            gx1, gy1 = min(px1, tx * 256 + 256), min(py1, ty * 256 + 256)
            grid[gy0 - py0:gy1 - py0, gx0 - px0:gx1 - px0] = tile[gy0 - ty * 256:gy1 - ty * 256, gx0 - tx * 256:gx1 - tx * 256]
    return {"elev": grid, "px0": px0, "py0": py0, "z": z, "cell_m": cell_size_m(lat0, z), "source": DEM_SOURCE}


# ----------------------------------------------------------------- plot polygon helpers

def circle_polygon(lat, lon, area_ha, points=32):
    """GeoJSON Polygon: a circle of the given area around the pin (used when the farmer did not draw the field)."""
    r = math.sqrt(max(area_ha, 0.0001) * 10000.0 / math.pi)
    dlat = r / 111320.0
    dlon = r / (111320.0 * math.cos(math.radians(lat)))
    ring = [[lon + dlon * math.cos(2 * math.pi * i / points), lat + dlat * math.sin(2 * math.pi * i / points)] for i in range(points)]
    ring.append(ring[0])
    return {"type": "Polygon", "coordinates": [ring]}


def outer_ring(geojson):
    """The outer ring of a Polygon / MultiPolygon (first polygon) / Feature, as a list of [lon, lat]."""
    g = geojson.get("geometry") if geojson.get("type") == "Feature" else geojson
    if g.get("type") == "Polygon":
        return g["coordinates"][0]
    if g.get("type") == "MultiPolygon":
        return g["coordinates"][0][0]
    raise ValueError("the plot must be a Polygon")


def ring_area_m2(ring):
    """Area of a lon/lat ring in square metres (local flat approximation, fine for farm-sized shapes)."""
    lat0 = sum(p[1] for p in ring) / len(ring)
    kx, ky = 111320.0 * math.cos(math.radians(lat0)), 110540.0
    pts = [(p[0] * kx, p[1] * ky) for p in ring]
    s = sum(pts[i][0] * pts[(i + 1) % len(pts)][1] - pts[(i + 1) % len(pts)][0] * pts[i][1] for i in range(len(pts)))
    return abs(s) / 2.0


def polygon_area_ha(geometry):
    if geometry["type"] == "Polygon":
        polys = [geometry["coordinates"]]
    elif geometry["type"] == "MultiPolygon":
        polys = geometry["coordinates"]
    else:
        raise ValueError("not a polygon")
    return sum(ring_area_m2(p[0]) - sum(ring_area_m2(h) for h in p[1:]) for p in polys) / 10000.0


def ring_bbox(ring):
    xs, ys = [p[0] for p in ring], [p[1] for p in ring]
    return min(xs), min(ys), max(xs), max(ys)


def _points_in_ring(xs, ys, ring):
    """Even-odd test for arrays of points against one ring (vectorised over the points)."""
    inside = np.zeros(xs.shape, dtype=bool)
    n = len(ring)
    for i in range(n):
        x1, y1 = ring[i][0], ring[i][1]
        x2, y2 = ring[(i + 1) % n][0], ring[(i + 1) % n][1]
        if y1 == y2:
            continue
        cond = (y1 > ys) != (y2 > ys)
        xcross = (x2 - x1) * (ys - y1) / (y2 - y1) + x1
        inside ^= cond & (xs < xcross)
    return inside


def plot_mask(dem, ring):
    """Boolean grid: which DEM cells have their centre inside the plot ring."""
    h, w = dem["elev"].shape
    cols, rows = np.meshgrid(np.arange(w) + 0.5 + dem["px0"], np.arange(h) + 0.5 + dem["py0"])
    n = world_size(dem["z"])
    lon = cols / n * 360.0 - 180.0
    lat = np.degrees(np.arctan(np.sinh(np.pi * (1 - 2 * rows / n))))
    return _points_in_ring(lon, lat, ring)


# ----------------------------------------------------------------- slope, flow accumulation

def smooth3(elev):
    """3 by 3 mean. The source DEM is blocky (30 m), so a light smoothing keeps slope from jumping at block edges."""
    p = np.pad(elev, 1, mode="edge")
    h, w = elev.shape
    return sum(p[i:i + h, j:j + w] for i in range(3) for j in range(3)) / 9.0


def slope_percent(elev, cell_m):
    """Slope in percent = 100 x rise / run, from the central differences."""
    gy, gx = np.gradient(elev, cell_m)
    return 100.0 * np.hypot(gx, gy)


_NEIGHBOURS = [(-1, -1), (-1, 0), (-1, 1), (0, -1), (0, 1), (1, -1), (1, 0), (1, 1)]


def fill_depressions(elev, eps=1e-4):
    """Priority-flood: raise pits so every cell has a downhill path to the edge of the grid (each step rises by `eps`)."""
    h, w = elev.shape
    filled = elev.astype(np.float64).ravel().copy()
    closed = np.zeros(h * w, dtype=bool)
    heap = []
    for r in range(h):
        for c in range(w):
            if r in (0, h - 1) or c in (0, w - 1):
                i = r * w + c
                closed[i] = True
                heap.append((filled[i], i))
    heapq.heapify(heap)
    while heap:
        e, i = heapq.heappop(heap)
        r, c = divmod(i, w)
        for dr, dc in _NEIGHBOURS:
            rr, cc = r + dr, c + dc
            if 0 <= rr < h and 0 <= cc < w:
                j = rr * w + cc
                if not closed[j]:
                    closed[j] = True
                    if filled[j] < e + eps:
                        filled[j] = e + eps
                    heapq.heappush(heap, (filled[j], j))
    return filled.reshape(h, w)


def flow_accumulation(elev):
    """
    D8 flow accumulation: for every cell, how many cells (itself included) drain through it. Each cell sends all its water to its
    steepest downhill neighbour. Cells on the border of the grid are outlets.
    """
    h, w = elev.shape
    f = fill_depressions(elev)
    best = np.zeros((h, w))
    target = np.full((h, w), -1, dtype=np.int64)
    idx = np.arange(h * w).reshape(h, w)
    inner = (slice(1, h - 1), slice(1, w - 1))
    for dr, dc in _NEIGHBOURS:
        dist = math.hypot(dr, dc)
        nb = f[1 + dr:h - 1 + dr, 1 + dc:w - 1 + dc]
        drop = (f[inner] - nb) / dist
        better = drop > best[inner]
        best[inner] = np.where(better, drop, best[inner])
        target[inner] = np.where(better, idx[1 + dr:h - 1 + dr, 1 + dc:w - 1 + dc], target[inner])
    acc = [1.0] * (h * w)
    tgt = target.ravel().tolist()
    for i in np.argsort(-f.ravel(), kind="stable").tolist():
        t = tgt[i]
        if t >= 0:
            acc[t] += acc[i]
    return np.array(acc).reshape(h, w)


# ----------------------------------------------------------------- classes, patches, polygons

def classify(slope, acc, cell_m, wet_area_m2=WET_AREA_M2):
    """Class number per cell (see FLAT..WET_LOW)."""
    cls = np.full(slope.shape, VERY_STEEP, dtype=np.int8)
    cls[slope < SLOPE_LIMITS[2]] = STEEP
    cls[slope < SLOPE_LIMITS[1]] = GENTLE
    cls[slope < SLOPE_LIMITS[0]] = FLAT
    cls[(acc * cell_m * cell_m >= wet_area_m2) & (slope < SLOPE_LIMITS[0])] = WET_LOW
    return cls


def label_patches(cls, mask):
    """4-connected patches of equal class inside the mask. Returns (labels, count); outside the mask the label is 0."""
    h, w = cls.shape
    labels = np.zeros((h, w), dtype=np.int32)
    n = 0
    for r0 in range(h):
        for c0 in range(w):
            if not mask[r0, c0] or labels[r0, c0]:
                continue
            n += 1
            labels[r0, c0] = n
            stack = [(r0, c0)]
            while stack:
                r, c = stack.pop()
                for rr, cc in ((r - 1, c), (r + 1, c), (r, c - 1), (r, c + 1)):
                    if 0 <= rr < h and 0 <= cc < w and mask[rr, cc] and not labels[rr, cc] and cls[rr, cc] == cls[r0, c0]:
                        labels[rr, cc] = n
                        stack.append((rr, cc))
    return labels, n


def merge_small_patches(cls, mask, min_cells):
    """Give every patch smaller than `min_cells` to the neighbouring class it shares the most edge with; repeat until stable."""
    cls = cls.copy()
    h, w = cls.shape
    for _ in range(10):
        labels, n = label_patches(cls, mask)
        sizes = np.bincount(labels.ravel(), minlength=n + 1)
        changed = False
        for lab in np.argsort(sizes[1:]) + 1:            # smallest first
            if sizes[lab] >= min_cells:
                break
            cells = np.argwhere(labels == lab)
            votes = {}
            for r, c in cells:
                for rr, cc in ((r - 1, c), (r + 1, c), (r, c - 1), (r, c + 1)):
                    if 0 <= rr < h and 0 <= cc < w and mask[rr, cc] and labels[rr, cc] != lab:
                        votes[int(cls[rr, cc])] = votes.get(int(cls[rr, cc]), 0) + 1
            if votes:
                new = max(votes, key=votes.get)
                for r, c in cells:
                    cls[r, c] = new
                changed = True
        if not changed:
            break
    return cls


def _trace_rings(comp):
    """Outline of a boolean grid as rings of integer (x, y) grid corners (x = column, y = row)."""
    out = {}
    h, w = comp.shape
    for r, c in np.argwhere(comp):
        if r == 0 or not comp[r - 1, c]:
            out.setdefault((c, r), []).append((c + 1, r))
        if c == w - 1 or not comp[r, c + 1]:
            out.setdefault((c + 1, r), []).append((c + 1, r + 1))
        if r == h - 1 or not comp[r + 1, c]:
            out.setdefault((c + 1, r + 1), []).append((c, r + 1))
        if c == 0 or not comp[r, c - 1]:
            out.setdefault((c, r + 1), []).append((c, r))
    rings = []
    while out:
        start = next(iter(out))
        ring, cur = [start], start
        while True:
            nxt = out[cur].pop()
            if not out[cur]:
                del out[cur]
            if nxt == start:
                break
            ring.append(nxt)
            cur = nxt
        # drop corners that lie on a straight line
        keep = []
        for i, p in enumerate(ring):
            a, b = ring[i - 1], ring[(i + 1) % len(ring)]
            if (p[0] - a[0]) * (b[1] - p[1]) != (p[1] - a[1]) * (b[0] - p[0]):
                keep.append(p)
        rings.append(keep)
    return rings


def _signed_area(ring):
    return sum(ring[i][0] * ring[(i + 1) % len(ring)][1] - ring[(i + 1) % len(ring)][0] * ring[i][1] for i in range(len(ring))) / 2.0


def patch_geometry(comp, dem):
    """GeoJSON Polygon (outer ring plus holes, [lon, lat]) for one connected patch of cells; MultiPolygon if cells only touch at corners."""
    rings = [r for r in _trace_rings(comp) if len(r) >= 3]
    outers = sorted([r for r in rings if _signed_area(r) > 0], key=_signed_area)      # smallest first
    holes = [r for r in rings if _signed_area(r) < 0]
    if not outers:
        return None
    mine = {i: [] for i in range(len(outers))}
    for hole in holes:
        px, py = np.array([float(hole[0][0])]), np.array([float(hole[0][1])])
        home = next((i for i, o in enumerate(outers) if _points_in_ring(px, py, o).any()), len(outers) - 1)
        mine[home].append(hole)

    def conv(ring):
        pts = [pixel_to_lonlat(dem["px0"] + x, dem["py0"] + y, dem["z"]) for x, y in ring]
        pts = [[round(lon, 7), round(lat, 7)] for lon, lat in pts]
        pts.append(pts[0])
        return pts

    polys = [[conv(o)] + [conv(hh) for hh in mine[i]] for i, o in enumerate(outers)]
    return {"type": "Polygon", "coordinates": polys[0]} if len(polys) == 1 else {"type": "MultiPolygon", "coordinates": polys}


# ----------------------------------------------------------------- erosion (relative RUSLE-style index)

def ls_factor(slope_pct, acc, cell_m):
    """Moore and Burch style slope-length-and-steepness term from slope and the upslope area (capped, see AS_CAP_M)."""
    sin_b = np.sin(np.arctan(slope_pct / 100.0))
    a_s = np.minimum(acc * cell_m, AS_CAP_M)                     # specific contributing area, metres
    return (a_s / 22.13) ** 0.4 * (sin_b / 0.0896) ** 1.3


def erosion_index(slope_pct, acc, cell_m, k=K_DEFAULT, r=1.0, c=C_FACTOR_DEFAULT, p=1.0):
    """
    RELATIVE erosion index A = R x K x LS x C x P per cell. R is 1 (no rain erosivity data is used), K is a relative erodibility,
    C and P are the cover and practice factors. The result has no unit: compare parts of the same farm, do not read it as
    tonnes per hectare.
    """
    return r * k * ls_factor(slope_pct, acc, cell_m) * c * p


def erosion_level(mean_index):
    low, med = EROSION_CUTS
    return "low" if mean_index < low else ("medium" if mean_index < med else "high")


def k_from_texture(texture):
    """(K, was_known) for a soil texture class name; unknown soil gives the default and False."""
    t = (texture or "").strip().lower().replace(" ", "_")
    return (K_BY_TEXTURE[t], True) if t in K_BY_TEXTURE else (K_DEFAULT, False)


# ----------------------------------------------------------------- the whole analysis

def analyse(dem, ring, texture=None, c_factor=C_FACTOR_DEFAULT, wet_area_m2=WET_AREA_M2, min_patch_ha=MIN_PATCH_HA):
    """
    Zones and erosion for one plot. `dem` comes from build_dem (or from a test fixture), `ring` is the plot's outer ring [lon, lat].
    Returns {"zones": [...], "summary": {...}}; each zone has kind, geometry, area_ha, mean_slope_pct and the relative erosion
    index (with and without contour hedges). Raises ValueError if the plot covers no DEM cell.
    """
    elev, cell = dem["elev"], dem["cell_m"]
    mask = plot_mask(dem, ring)
    if not mask.any():
        raise ValueError("the plot is smaller than one elevation cell")
    slope = slope_percent(smooth3(elev), cell)
    acc = flow_accumulation(elev)
    cls = classify(slope, acc, cell, wet_area_m2)
    cls = merge_small_patches(cls, mask, max(1, int(round(min_patch_ha * 10000.0 / (cell * cell)))))
    k, k_known = k_from_texture(texture)
    idx = erosion_index(slope, acc, cell, k=k, c=c_factor)
    labels, n = label_patches(cls, mask)
    zones = []
    for lab in range(1, n + 1):
        comp = labels == lab
        geom = patch_geometry(comp, dem)
        if geom is None:
            continue
        mean_idx = float(idx[comp].mean())
        zones.append({
            "kind": KINDS[int(cls[comp][0])], "geometry": geom, "cells": int(comp.sum()),
            "area_ha": round(comp.sum() * cell * cell / 10000.0, 4), "mean_slope_pct": round(float(slope[comp].mean()), 1),
            "erosion_index": round(mean_idx, 4), "erosion_level": erosion_level(mean_idx),
            "erosion_index_with_contour_hedges": round(mean_idx * P_CONTOUR_HEDGES, 4),
        })
    zones.sort(key=lambda z: -z["area_ha"])
    inside = elev[mask]
    return {"zones": zones, "summary": {
        "dem_source": dem.get("source", DEM_SOURCE), "zoom": dem["z"], "cell_m": round(cell, 2), "cells_in_plot": int(mask.sum()),
        "elevation_m": {"min": round(float(inside.min()), 1), "mean": round(float(inside.mean()), 1), "max": round(float(inside.max()), 1)},
        "erosion": {"unit": "relative index (R x K x LS x C x P), not tonnes per hectare", "k_factor": k, "k_from_soil": k_known,
                    "c_factor": c_factor, "p_with_contour_hedges": P_CONTOUR_HEDGES, "status": "placeholder constants, draft"},
        "notes": ["Elevation is about 30 m in origin: on a small plot slopes are estimates. Check on the ground.",
                  "Modelled from open satellite elevation data, not measured on the farm."],
    }}


def level_up(level):
    return {"low": "medium", "medium": "high"}.get(level, level)


def computed_threats(zones, farm, soil=None):
    """
    The four computed threats from stored computed zones (dicts with kind, area_ha, erosion_index), the farm row and the effective soil
    ({property: value}). Returns a list of {kind, level, note, zone_kind}. Level is None where it cannot be computed honestly.
    """
    soil = soil or {}
    out = []
    total = sum(z["area_ha"] or 0 for z in zones)
    if total > 0:
        mean_idx = sum((z.get("erosion_index") or 0) * z["area_ha"] for z in zones) / total
        steep = sum(z["area_ha"] for z in zones if z["kind"] in ("steep", "very_steep")) / total
        out.append({"kind": "erosion", "level": erosion_level(mean_idx),
                    "note": f"relative erosion index {mean_idx:.2f} (not tonnes); {round(steep * 100)}% of the plot is steep or very steep. Modelled from satellite elevation."})
        wet = sum(z["area_ha"] for z in zones if z["kind"] == "wet_low") / total
        level = "high" if wet >= 0.15 else ("medium" if wet >= 0.05 else "low")
        if str(soil.get("drainage", "")).lower() == "poor":
            level = level_up(level)
        out.append({"kind": "waterlogging", "level": level,
                    "note": f"{round(wet * 100)}% of the plot is a wet low spot (flat ground where water gathers)."
                            + (" Soil drainage is reported as poor." if str(soil.get("drainage", "")).lower() == "poor" else "")})
    src, yala = (farm.get("water_source") or "").lower(), (farm.get("yala_water") or "").lower()
    if src or yala:
        level = "high" if (src == "rain-fed" and yala == "no") else ("medium" if (src == "rain-fed" or yala in ("limited", "no")) else "low")
        if str(soil.get("texture", "")).lower() in ("sand", "loamy_sand", "sandy_loam") and level != "high":
            level = level_up(level)
        out.append({"kind": "drought", "level": level,
                    "note": "from the farmer's own answers (water source, Yala water) and soil texture; the area dry-spell table adds climate later."})
    else:
        out.append({"kind": "drought", "level": None, "note": "needs the water source and Yala water answers."})
    out.append({"kind": "heat", "level": None, "note": "not computed yet: it needs the area-level climate table (hot-day counts). Shown as unknown rather than guessed."})
    return out


# ----------------------------------------------------------------- soil (SoilGrids, modelled)

SOILGRIDS_URL = "https://rest.isric.org/soilgrids/v2.0/properties/query"


def usda_texture(sand, silt, clay):
    """USDA texture class from percentages (sand + silt + clay about 100)."""
    if silt + 1.5 * clay < 15:
        return "sand"
    if silt + 2 * clay < 30:
        return "loamy_sand"
    if (7 <= clay < 20 and sand > 52) or (clay < 7 and silt < 50):
        return "sandy_loam"
    if 7 <= clay < 27 and 28 <= silt < 50 and sand <= 52:
        return "loam"
    if (silt >= 50 and 12 <= clay < 27) or (50 <= silt < 80 and clay < 12):
        return "silt_loam"
    if silt >= 80 and clay < 12:
        return "silt"
    if 20 <= clay < 35 and silt < 28 and sand > 45:
        return "sandy_clay_loam"
    if 27 <= clay < 40 and 20 < sand <= 45:
        return "clay_loam"
    if 27 <= clay < 40 and sand <= 20:
        return "silty_clay_loam"
    if clay >= 35 and sand > 45:
        return "sandy_clay"
    if clay >= 40 and silt >= 40:
        return "silty_clay"
    if clay >= 40:
        return "clay"
    return "loam"


def parse_soilgrids(payload):
    """SoilGrids JSON to {"texture", "ph", "organic_carbon", ...} for the 0 to 5 cm layer, with units. Raises ValueError if the layout is unexpected."""
    vals = {}
    for layer in payload["properties"]["layers"]:
        d = layer["depths"][0]["values"].get("mean")
        factor = layer.get("unit_measure", {}).get("d_factor", 1) or 1
        if d is not None:
            vals[layer["name"]] = d / factor
    if not {"sand", "silt", "clay"} <= set(vals):
        raise ValueError("SoilGrids returned no texture for this point (it may be water or have no data)")
    out = {"texture": usda_texture(vals["sand"], vals["silt"], vals["clay"])}
    if "phh2o" in vals:
        out["ph"] = round(vals["phh2o"], 1)
    if "soc" in vals:
        out["organic_carbon"] = round(vals["soc"], 1)       # g per kg (SoilGrids soc is dg/kg, d_factor 10)
    return out


def fetch_soilgrids(lat, lon, client=None):
    """Modelled soil at a point from ISRIC SoilGrids (about 250 m, a model, not a measurement). Raises DemUnavailable-style errors as ValueError/RuntimeError."""
    import httpx
    own = client is None
    client = client or httpx.Client(timeout=30.0)
    try:
        params = [("lon", lon), ("lat", lat), ("depth", "0-5cm"), ("value", "mean")] + [("property", p) for p in ("sand", "silt", "clay", "phh2o", "soc")]
        r = client.get(SOILGRIDS_URL, params=params)
    except Exception as err:
        raise RuntimeError(f"could not reach SoilGrids: {type(err).__name__}") from err
    finally:
        if own:
            client.close()
    if r.status_code != 200:
        raise RuntimeError(f"SoilGrids answered {r.status_code}")
    return parse_soilgrids(r.json())
