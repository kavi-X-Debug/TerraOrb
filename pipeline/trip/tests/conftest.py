"""
Shared fixtures for pipeline/trip tests. All data here is SYNTHETIC TEST DATA made in the test (never real measurements),
so the tests run offline and every expected number can be checked by hand.
"""

import sys
from pathlib import Path

import numpy as np
import pandas as pd
import pytest

REPO = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(REPO))
sys.path.insert(0, str(REPO / "pipeline"))        # so "import rain" works in test_cell_key

from pipeline.trip import common  # noqa: E402


@pytest.fixture(scope="session")
def cfg():
    return common.load_config()


@pytest.fixture
def synthetic_rain():
    """SYNTHETIC: 4 years of daily rain with a wet season (days 150-270) and a dry rest. Seeded, so always the same."""
    rng = np.random.default_rng(1)
    idx = pd.date_range("2001-01-01", "2004-12-31", freq="D")
    doy = idx.dayofyear.to_numpy()
    p_wet = np.where((doy > 150) & (doy < 270), 0.6, 0.1)
    wet = rng.random(len(idx)) < p_wet
    mm = np.where(wet, rng.gamma(1.5, 6.0, len(idx)) + 1.0, 0.0)
    return pd.Series(mm, index=idx)
