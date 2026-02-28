"""
Unit tests for RouteOptimizer.
Owner: Paarth (tests mirror the model contracts)
"""
from pathlib import Path
import sys
from backend.models.listing import Listing
from backend.models.material import Material

SERVICE_DIR = Path(__file__).resolve().parents[1] / "services"
if str(SERVICE_DIR) not in sys.path:
    sys.path.insert(0, str(SERVICE_DIR))

import optimizer as optimizer_module

RouteOptimizer = optimizer_module.RouteOptimizer


def make_listing(id_suffix, lat, lng, mat_type="aluminum_cans", lbs=5.0):
    l = Listing(
        address=f"Test Address {id_suffix}", lat=lat, lng=lng,
        household_name="Test", phone="555",
        materials=[Material(type=mat_type, lbs=lbs)]
    )
    l.id = f"test_{id_suffix}"
    return l

def test_empty_listings():
    opt = RouteOptimizer()
    stops, summary = opt.optimize(37.35, -121.95, [], 120)
    assert stops == []
    assert summary["total_stops"] == 0
    assert summary["solver"] == "none"


def test_single_listing():
    opt = RouteOptimizer()
    listing = make_listing("a", 37.354, -121.956)
    stops, summary = opt.optimize(37.35, -121.95, [listing], 120)
    assert len(stops) == 1
    assert summary["total_value"] > 0
    assert "solver" in summary
    assert "solve_time_ms" in summary


def test_truck_capacity_limit():
    opt = RouteOptimizer()
    listings = [make_listing(str(i), 37.35 + i*0.01, -121.95, "cardboard", lbs=200) for i in range(10)]
    _, summary = opt.optimize(37.35, -121.95, listings, 240, truck_capacity_lbs=300)
    assert summary["total_lbs"] <= 300


def test_time_limit():
    opt = RouteOptimizer()
    # Far-away listings should not be included with tight time budget
    listings = [make_listing("far", 38.5, -122.5)]  # ~80 miles away
    stops, _ = opt.optimize(37.35, -121.95, listings, 5)  # only 5 min
    assert len(stops) == 0


def test_skips_unavailable_listings():
    opt = RouteOptimizer()
    available = make_listing("open", 37.351, -121.951)
    unavailable = make_listing("closed", 37.352, -121.952)
    unavailable.status = "claimed"
    stops, _ = opt.optimize(37.35, -121.95, [available, unavailable], 120)
    ids = [s.listing_id for s in stops]
    assert "test_open" in ids
    assert "test_closed" not in ids


def test_eta_is_monotonic():
    opt = RouteOptimizer()
    listings = [
        make_listing("1", 37.351, -121.951, lbs=5),
        make_listing("2", 37.353, -121.953, lbs=5),
        make_listing("3", 37.355, -121.955, lbs=5),
    ]
    stops, _ = opt.optimize(37.35, -121.95, listings, 180)
    etas = [s.eta_minutes for s in stops]
    assert etas == sorted(etas)


def test_zero_truck_capacity_does_not_crash():
    opt = RouteOptimizer()
    listing = make_listing("a", 37.354, -121.956, lbs=1)
    _, summary = opt.optimize(37.35, -121.95, [listing], 120, truck_capacity_lbs=0)
    assert summary["truck_fill_pct"] == 0.0


def test_ortools_failure_falls_back_to_greedy(monkeypatch):
    opt = RouteOptimizer()
    listing = make_listing("a", 37.354, -121.956)

    monkeypatch.setattr(optimizer_module, "ORTOOLS_AVAILABLE", True)

    def fail_solver(*args, **kwargs):
        raise RuntimeError("forced failure")

    monkeypatch.setattr(RouteOptimizer, "_solve_ortools", fail_solver)
    stops, summary = opt.optimize(37.35, -121.95, [listing], 120)
    assert len(stops) == 1
    assert summary["solver"] == "greedy_fallback"
