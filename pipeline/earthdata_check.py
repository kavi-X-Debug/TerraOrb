"""
Check that your Earthdata login can really download a DSWx file (and what goes wrong if not).

    $env:EARTHDATA_TOKEN = "<token>"
    .\\.venv\\Scripts\\python.exe pipeline\\earthdata_check.py

It never prints the token. Run it when water.py says "not recognized as being in a supported file format".
"""
import os
import sys

import requests

# One real DSWx band from the failing run (a small public GeoTIFF).
URL = ("https://archive.podaac.earthdata.nasa.gov/podaac-ops-cumulus-protected/OPERA_L3_DSWX-HLS_V1/"
       "OPERA_L3_DSWx-HLS_T44PMQ_20170101T050212Z_20260616T024807Z_S2A_30_v1.1_B01_WTR.tif")

token = os.environ.get("EARTHDATA_TOKEN")
if not token:
    sys.exit("EARTHDATA_TOKEN is not set in this window.")

# 1. Ask for the file the normal way. requests drops the Authorization header when a redirect
#    goes to another host (NASA's login, then the storage server), which is what we want.
r = requests.get(URL, headers={"Authorization": f"Bearer {token}"}, stream=True, timeout=60)
head = next(r.iter_content(64), b"")
print("1. requests: HTTP", r.status_code, "| type:", r.headers.get("content-type"), "| final host:", r.url.split("/")[2])
print("   first bytes:", head[:8], "(a GeoTIFF starts with b'II*' or b'MM')")
for h in r.history:
    print("   redirect:", h.status_code, h.url.split("/")[2], "->", h.headers.get("location", "")[:80].split("?")[0])

# 2. Let GDAL (what water.py uses) read the same file.
try:
    import rasterio
    with rasterio.Env(GDAL_HTTP_HEADERS=f"Authorization: Bearer {token}",
                      CPL_VSIL_CURL_ALLOWED_EXTENSIONS=".tif", GDAL_DISABLE_READDIR_ON_OPEN="EMPTY_DIR"):
        with rasterio.open(URL) as ds:
            print("2. GDAL: opened OK,", ds.width, "x", ds.height, "pixels")
except Exception as err:
    print("2. GDAL: FAILED:", str(err)[:200])
