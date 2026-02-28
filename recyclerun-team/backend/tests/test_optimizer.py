"""
Unit tests for RouteOptimizer.
Owner: Paarth (tests mirror the model contracts)
"""
import pytest
from backend.services.optimizer import RouteOptimizer
from backend.models.listing import Listing
from backend.models.material import Material

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

def test_single_listing():
    opt = RouteOptimizer()
    listing = make_listing("a", 37.354, -121.956)
    stops, summary = opt.optimize(37.35, -121.95, [listing], 120)
    assert len(stops) == 1
    assert summary["total_value"] > 0

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
