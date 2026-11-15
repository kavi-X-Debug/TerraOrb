"""
NASA GPM IMERG rain estimates: documented STUB (not used yet).

IMERG (Integrated Multi-satellitE Retrievals for GPM, half-hourly 0.1 degree rain) needs an NASA Earthdata login.
There is no token in this environment, so this module refuses to run without one and never produces data of its own.
`model_metadata.json` therefore says  "imerg": {"used": false, "reason": "no Earthdata token"}  and the web app says
"GPM IMERG: not used yet". Never imply IMERG is used.

To switch it on later (a human decision, not done here):
  1. Create an Earthdata account and set the token in the environment variable EARTHDATA_TOKEN (never write it into a file).
     Tokens expire after about 60 days (see AGENTS.md "Secrets").
  2. Implement `fetch_daily` below: search collection GPM_3IMERGDL (daily, late run) with the earthaccess or CMR API,
     read `precipitationCal` at each destination, and write the values to pipeline/cache/trip/imerg_<id>.json.
  3. Add a cleaning step and a comparison against NASA POWER before using it for anything shown to users.
"""

import os


class ImergNotAvailable(RuntimeError):
    pass


def status():
    """The `imerg` block of model_metadata.json."""
    if os.environ.get("EARTHDATA_TOKEN") or (os.environ.get("EARTHDATA_USERNAME") and os.environ.get("EARTHDATA_PASSWORD")):
        return {"used": False, "reason": "Earthdata login found, but the IMERG download is not implemented yet"}
    return {"used": False, "reason": "no Earthdata token"}


def fetch_daily(*_args, **_kwargs):
    """Stub: refuses to run without an Earthdata token, and is not implemented even with one. Never fakes data."""
    if not (os.environ.get("EARTHDATA_TOKEN") or os.environ.get("EARTHDATA_USERNAME")):
        raise ImergNotAvailable("GPM IMERG needs an Earthdata token (environment variable EARTHDATA_TOKEN). None found: skipped.")
    raise NotImplementedError("IMERG download is not implemented yet (see the module docstring).")


if __name__ == "__main__":
    print(status())
