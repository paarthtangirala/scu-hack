"""
Unit tests for RouteOptimizer.
Owner: Paarth (tests mirror the model contracts)
"""
import logging
from pathlib import Path
import sys
import pytest
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


@pytest.mark.parametrize(
    ("raw", "expected"),
    [
        ("value", "value"),
        ("profit", "value"),
        ("earnings", "value"),
        ("$", "value"),
        ("lbs", "lbs"),
        ("weight", "lbs"),
        ("impact", "lbs"),
        ("diversion", "lbs"),
        ("unknown", "value"),
        (None, "value"),
    ],
)
def test_objective_alias_normalization(raw, expected):
    assert optimizer_module._normalize_objective(raw) == expected

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


def test_ortools_exception_emits_fallback_telemetry(monkeypatch, caplog):
    opt = RouteOptimizer()
    listing = make_listing("a", 37.354, -121.956)
    monkeypatch.setattr(optimizer_module, "ORTOOLS_AVAILABLE", True)
    monkeypatch.setattr(RouteOptimizer, "_solve_ortools", lambda *args, **kwargs: (_ for _ in ()).throw(RuntimeError("boom")))

    with caplog.at_level(logging.WARNING):
        _, summary = opt.optimize(37.35, -121.95, [listing], 120)

    assert summary["solver"] == "greedy_fallback"
    assert "optimizer_fallback" in caplog.text
    assert "ortools_exception" in caplog.text
    assert "exception_type" in caplog.text


def test_forced_fallback_mode_is_deterministic_and_skips_ortools(monkeypatch):
    opt = RouteOptimizer()
    listings = [
        make_listing("a", 37.351, -121.951, lbs=7.0),
        make_listing("b", 37.352, -121.952, lbs=6.0),
        make_listing("c", 37.353, -121.953, lbs=8.0),
    ]
    monkeypatch.setattr(optimizer_module, "ORTOOLS_AVAILABLE", True)
    monkeypatch.setattr(
        RouteOptimizer,
        "_solve_ortools",
        lambda *args, **kwargs: (_ for _ in ()).throw(AssertionError("forced fallback should skip OR-Tools")),
    )

    stops1, summary1 = opt.optimize(
        37.35, -121.95, listings, 120, truck_capacity_lbs=500, objective="value", force_fallback=True
    )
    stops2, summary2 = opt.optimize(
        37.35, -121.95, listings, 120, truck_capacity_lbs=500, objective="value", force_fallback=True
    )

    assert [s.listing_id for s in stops1] == [s.listing_id for s in stops2]
    assert [s.eta_minutes for s in stops1] == [s.eta_minutes for s in stops2]
    assert summary1["solver"] == summary2["solver"] == "greedy_fallback"
    assert summary1["objective"] == summary2["objective"] == "value"
    for key in ("total_stops", "total_value", "total_lbs", "total_miles", "truck_fill_pct", "estimated_minutes", "lbs_per_hour"):
        assert summary1[key] == summary2[key]


def test_objective_specific_first_stop_ordering_differs(monkeypatch):
    monkeypatch.setattr(optimizer_module, "ORTOOLS_AVAILABLE", False)
    opt = RouteOptimizer()
    heavy_low_value = make_listing("heavy", 37.351, -121.951, mat_type="cardboard", lbs=180.0)
    high_value_low_lbs = make_listing("value", 37.351, -121.951, mat_type="copper_wire", lbs=3.0)
    listings = [heavy_low_value, high_value_low_lbs]

    stops_lbs, _ = opt.optimize(
        37.35, -121.95, listings, 60, truck_capacity_lbs=500, objective="lbs"
    )
    stops_value, _ = opt.optimize(
        37.35, -121.95, listings, 60, truck_capacity_lbs=500, objective="value"
    )

    assert stops_lbs and stops_value
    first_lbs = stops_lbs[0].listing_id
    first_value = stops_value[0].listing_id
    assert first_lbs != first_value
    assert first_lbs == heavy_low_value.id
    assert first_value == high_value_low_lbs.id


@pytest.mark.parametrize("objective", ["value", "lbs"])
def test_capacity_and_eta_invariants_hold_across_objectives(monkeypatch, objective):
    monkeypatch.setattr(optimizer_module, "ORTOOLS_AVAILABLE", False)
    opt = RouteOptimizer()
    listings = [
        make_listing("a", 37.351, -121.951, mat_type="cardboard", lbs=10.0),
        make_listing("b", 37.352, -121.952, mat_type="aluminum_cans", lbs=8.0),
        make_listing("c", 37.353, -121.953, mat_type="copper_wire", lbs=6.0),
        make_listing("d", 37.354, -121.954, mat_type="cardboard", lbs=12.0),
    ]

    capacity = 22.0
    stops, summary = opt.optimize(
        37.35, -121.95, listings, 120, truck_capacity_lbs=capacity, objective=objective
    )

    etas = [s.eta_minutes for s in stops]
    assert etas == sorted(etas)
    assert summary["total_lbs"] <= capacity

    remaining = capacity
    for stop in stops:
        assert stop.total_lbs <= remaining + 1e-9
        remaining -= stop.total_lbs


@pytest.mark.parametrize("objective", ["value", "lbs"])
def test_summary_contract_stability_across_objectives(monkeypatch, objective):
    monkeypatch.setattr(optimizer_module, "ORTOOLS_AVAILABLE", False)
    opt = RouteOptimizer()
    listings = [
        make_listing("a", 37.351, -121.951, lbs=7.0),
        make_listing("b", 37.353, -121.953, lbs=9.0),
    ]
    _, summary = opt.optimize(
        37.35, -121.95, listings, 120, truck_capacity_lbs=500, objective=objective
    )

    required_keys = {
        "total_stops",
        "total_value",
        "total_lbs",
        "total_miles",
        "truck_fill_pct",
        "estimated_minutes",
        "lbs_per_hour",
        "objective",
        "solver",
        "solve_time_ms",
    }
    assert set(summary.keys()) == required_keys
    assert summary["objective"] in {"value", "lbs"}
    assert summary["solver"] in {"none", "ortools", "greedy", "greedy_fallback"}
    assert isinstance(summary["solve_time_ms"], int)


def test_priority_listing_ids_are_included_when_feasible(monkeypatch):
    monkeypatch.setattr(optimizer_module, "ORTOOLS_AVAILABLE", False)
    opt = RouteOptimizer()

    high_value = make_listing("high_value", 37.351, -121.951, mat_type="copper_wire", lbs=2.0)
    priority_low_value = make_listing("priority", 37.352, -121.952, mat_type="cardboard", lbs=5.0)
    listings = [high_value, priority_low_value]

    stops, summary = opt.optimize(
        37.35,
        -121.95,
        listings,
        60,
        truck_capacity_lbs=1000,
        objective="value",
        priority_listing_ids=[priority_low_value.id],
    )

    ids = [s.listing_id for s in stops]
    assert priority_low_value.id in ids
    assert summary["total_stops"] >= 1


@pytest.mark.skipif(not optimizer_module.ORTOOLS_AVAILABLE, reason="OR-Tools not available in this environment")
def test_ortools_objective_changes_first_stop_under_capacity_constraint():
    opt = RouteOptimizer()
    heavy_low_value = make_listing("ort_heavy", 37.351, -121.951, mat_type="cardboard", lbs=48.0)
    high_value_low_lbs = make_listing("ort_value", 37.351, -121.951, mat_type="copper_wire", lbs=8.0)
    listings = [heavy_low_value, high_value_low_lbs]

    # Capacity allows either stop but not both.
    stops_lbs, summary_lbs = opt.optimize(
        37.35, -121.95, listings, 120, truck_capacity_lbs=50, objective="lbs"
    )
    stops_value, summary_value = opt.optimize(
        37.35, -121.95, listings, 120, truck_capacity_lbs=50, objective="value"
    )

    assert summary_lbs["solver"] in {"ortools", "greedy_fallback"}
    assert summary_value["solver"] in {"ortools", "greedy_fallback"}
    assert stops_lbs and stops_value
    assert stops_lbs[0].listing_id != stops_value[0].listing_id
    assert stops_lbs[0].listing_id == heavy_low_value.id
    assert stops_value[0].listing_id == high_value_low_lbs.id
