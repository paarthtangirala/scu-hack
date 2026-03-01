"""
Driver-day simulation for realistic pickup economics.

Purpose:
- Generate realistic household listing mixes for Santa Clara County.
- Run the existing route optimizer under practical constraints.
- Print a believable stop-by-stop "mock drill" day.
- Stress-test whether a driver would actually do this under:
  - scrap-only (commodity value),
  - scrap + per-stop fees (realistic gig incentive),
  - optional commercial/partner pickups.

Run:
    python3 backend/tools/simulate_driver_day.py
"""
from __future__ import annotations

import argparse
import copy
import datetime as dt
import math
import random
import statistics
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Dict, Iterable, List, Tuple

PROJECT_ROOT = Path(__file__).resolve().parents[2]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from backend.models.listing import Listing
from backend.models.material import Material

# Import optimizer module directly to avoid importing backend.services package init.
SERVICES_DIR = Path(__file__).resolve().parents[1] / "services"
if str(SERVICES_DIR) not in sys.path:
    sys.path.insert(0, str(SERVICES_DIR))
import optimizer as optimizer_module

RouteOptimizer = optimizer_module.RouteOptimizer


# Santa Clara-ish center point (near current seed).
BASE_LAT = 37.3541
BASE_LNG = -121.9552

# Practical driver-day constraints.
SHIFT_MINUTES = 360  # pickup window (drop-off time is added separately in economics)
# User constraint from project notes: a pickup can only realistically handle ~500 lb of cardboard-equivalent.
TRUCK_CAPACITY_LBS = 500.0

# End-of-run drop-off (MRF/scrap yard) overhead. We model this even though the optimizer uses an "open route".
DROP_OFF_WAIT_MIN = 20  # scale line + unload + paperwork
DROP_OFF_EXTRA_MILES = 6.0  # typical detour to a yard/MRF after last stop (rough Bay Area estimate)

# Economic assumptions (tuneable).
# Note: vehicle cost per mile is intentionally closer to an all-in estimate than gas-only.
PAYOUT_REALIZATION = 0.85  # downgrade/contamination/scale loss haircut (applies to commodity value only)
VEHICLE_COST_PER_MILE = 0.55  # gas + wear + tires + depreciation (order-of-magnitude)
HANDLING_COST_PER_STOP = 1.50  # bags/tape/gloves + time friction
YARD_FEE_PER_LB = 0.020  # unload/processing friction estimate
POST_ROUTE_FIXED_MIN = 25  # unload + admin time (in addition to DROP_OFF_WAIT_MIN)

# Compensation policies (what makes this believable for drivers).
BASE_PICKUP_FEE = 0.0  # scrap-only baseline
FEE_PER_STOP_HOUSEHOLD = 7.0  # households paying for convenience (or a platform subsidy)
FEE_PER_STOP_COMMERCIAL = 30.0  # commercial cardboard pickup contract/subsidy
EWASTE_PICKUP_FEE = 15.0  # e-waste handled as a service (not a profitable commodity)
CRT_PICKUP_FEE = 35.0  # CRT pickup requires extra handling and typically has disposal friction

# Market generation assumptions.
DEFAULT_MARKET_LISTINGS = 90
HIGH_VALUE_TYPES = {"copper_wire", "scrap_aluminum", "aluminum_cans"}

# Public benchmark assumptions used for context (not optimizer input):
# EPA 2018: 1.16 lb/person/day recycled.
# Census QuickFacts Santa Clara County (2020-2024): 2.82 persons/household.
EPA_RECYCLING_LB_PER_PERSON_DAY = 1.16
SCC_PERSONS_PER_HOUSEHOLD = 2.82

FEE_TYPES = {"pickup_fee", "disposal_fee"}

# Conservative $/lb assumptions for what an *individual* actually realizes at a recycler.
# If you have contracts, a baler, or scale, these can be better. If you're small/unpredictable, they can be worse.
REALISTIC_RATES_PER_LB: dict[str, float] = {
    # Paper streams (low value, highly sensitive to contamination and moisture).
    "cardboard": 0.03,          # OCC
    "newspaper": 0.01,          # mixed paper / ONP

    # CRV streams (high $/lb, but limited by household generation and redemption rules).
    "aluminum_cans": 1.65,
    "plastic_pet": 1.31,
    "plastic_hdpe": 0.58,
    "glass_bottles": 0.10,

    # Scrap metal (varies a lot; copper especially depends on grade).
    "copper_wire": 2.75,
    "scrap_aluminum": 0.55,
    "steel_iron": 0.07,
    "scrap_metal_mixed": 0.10,

    # E-waste: treat as service. Most drop-off programs don't pay you per pound.
    "ewaste_noncrt": 0.00,
    # CRTs often cost money to handle; model disposal as a separate negative fee.
    "ewaste_crt": 0.00,
}


@dataclass
class DayResult:
    stops: int
    lbs: float
    miles: float
    gross_value: float
    realized_revenue: float
    operating_cost: float
    net_profit: float
    route_minutes: int
    hourly_net: float


def random_point_within(radius_miles: float, rng: random.Random) -> tuple[float, float]:
    """Sample a point around BASE_LAT/LNG within radius_miles."""
    theta = rng.uniform(0, 2 * math.pi)
    r = radius_miles * math.sqrt(rng.random())
    dlat = (r * math.cos(theta)) / 69.0
    dlng = (r * math.sin(theta)) / (69.0 * math.cos(math.radians(BASE_LAT)))
    return BASE_LAT + dlat, BASE_LNG + dlng


def choose_material_mix(rng: random.Random, include_commercial: bool) -> list[tuple[str, float]]:
    """
    Generate a realistic listing composition.

    Types:
    - routine: weekly recyclables, low-to-mid value
    - bulk: move-out/garage cleanup, heavier mostly low value
    - scrap_item: occasional dense scrap (BBQ, shelving, tools) that actually pays
    - ewaste: special-handling pickup (service fee model)
    - commercial: small-business cardboard pickup (usually only viable with a contract/permit)
    """
    roll = rng.random()
    mats: list[tuple[str, float]] = []

    if include_commercial and roll < 0.04:
        # Small commercial OCC load (flattened + tied). Volume-limited even if weight isn't.
        mats.append(("cardboard", round(rng.uniform(180, 520), 1)))
        if rng.random() < 0.40:
            mats.append(("newspaper", round(rng.uniform(10, 60), 1)))

    elif roll < 0.60:  # routine households
        mats.append(("cardboard", round(rng.uniform(3, 12), 1)))
        if rng.random() < 0.85:
            mats.append(("aluminum_cans", round(rng.uniform(0.1, 0.9), 1)))
        if rng.random() < 0.65:
            mats.append(("plastic_pet", round(rng.uniform(0.1, 0.8), 1)))
        if rng.random() < 0.35:
            mats.append(("plastic_hdpe", round(rng.uniform(0.1, 0.6), 1)))
        if rng.random() < 0.40:
            mats.append(("glass_bottles", round(rng.uniform(0.5, 6.0), 1)))

    elif roll < 0.88:  # bulk cleanup (move-out boxes, garage cleanup)
        mats.append(("cardboard", round(rng.uniform(25, 130), 1)))
        if rng.random() < 0.55:
            mats.append(("newspaper", round(rng.uniform(4, 35), 1)))
        if rng.random() < 0.45:
            mats.append(("scrap_metal_mixed", round(rng.uniform(1, 10), 1)))
        if rng.random() < 0.35:
            mats.append(("steel_iron", round(rng.uniform(5, 55), 1)))
        if rng.random() < 0.30:
            mats.append(("aluminum_cans", round(rng.uniform(0.2, 1.6), 1)))

    elif roll < 0.96:  # scrap item
        mats.append(("steel_iron", round(rng.uniform(25, 170), 1)))
        if rng.random() < 0.50:
            mats.append(("scrap_metal_mixed", round(rng.uniform(5, 35), 1)))
        if rng.random() < 0.25:
            mats.append(("copper_wire", round(rng.uniform(0.3, 2.5), 1)))
        if rng.random() < 0.20:
            mats.append(("scrap_aluminum", round(rng.uniform(3, 18), 1)))

    else:  # e-waste special pickup (service model)
        mats.append(("ewaste_noncrt", round(rng.uniform(6, 25), 1)))
        if rng.random() < 0.15:
            mats.append(("ewaste_crt", round(rng.uniform(20, 60), 1)))

    # Enforce at least one material.
    if not mats:
        mats = [("cardboard", round(rng.uniform(5, 15), 1))]
    return mats


def apply_quality_haircut(materials: list[tuple[str, float]], rng: random.Random) -> list[tuple[str, float]]:
    """
    Reduce saleable pounds for contamination/quality. This keeps simulation grounded.
    """
    quality = max(0.55, min(0.98, rng.gauss(0.83, 0.10)))
    adjusted = [(mtype, round(max(0.1, lbs * quality), 1)) for mtype, lbs in materials]
    return adjusted


def _rate_value(mtype: str, lbs: float) -> float:
    rate = REALISTIC_RATES_PER_LB.get(mtype, 0.0)
    return round(lbs * rate, 2)


def _add_policy_fees(listing: Listing, policy: str) -> None:
    """
    Add a zero-weight pseudo-material representing what the driver actually gets paid
    (or owes) per stop under a given policy.
    """
    if policy == "scrap_only":
        return

    if policy == "household_fees":
        fee = FEE_PER_STOP_HOUSEHOLD
        cardboard_lbs = sum(m.lbs for m in listing.materials if m.type == "cardboard")
        steel_lbs = sum(m.lbs for m in listing.materials if m.type == "steel_iron")
        # Households only pay for "extra work" scenarios: move-out boxes, bulky items, special handling.
        if cardboard_lbs >= 60:
            fee = max(fee, 10.0)
        if steel_lbs >= 80:
            fee = max(fee, 10.0)
        if any(m.type.startswith("ewaste_") for m in listing.materials):
            fee = max(fee, EWASTE_PICKUP_FEE)
        if any(m.type == "ewaste_crt" for m in listing.materials):
            fee = max(fee, CRT_PICKUP_FEE)
        listing.materials.append(Material(type="pickup_fee", lbs=0.0, value=round(fee, 2)))
        return

    if policy == "commercial_contracts":
        # Commercial loads are fewer, but pay a real service fee (contract/subsidy).
        fee = 0.0
        has_big_occ = sum(m.lbs for m in listing.materials if m.type == "cardboard") >= 160
        if has_big_occ:
            fee = FEE_PER_STOP_COMMERCIAL
        else:
            fee = FEE_PER_STOP_HOUSEHOLD
        if any(m.type.startswith("ewaste_") for m in listing.materials):
            fee = max(fee, EWASTE_PICKUP_FEE)
        if any(m.type == "ewaste_crt" for m in listing.materials):
            fee = max(fee, CRT_PICKUP_FEE)
        listing.materials.append(Material(type="pickup_fee", lbs=0.0, value=round(fee, 2)))
        return

    raise ValueError(f"Unknown policy: {policy}")


def build_market(
    count: int,
    rng: random.Random,
    *,
    include_commercial: bool,
    policy: str,
) -> list[Listing]:
    listings: list[Listing] = []
    for i in range(count):
        lat, lng = random_point_within(radius_miles=rng.uniform(1.0, 11.0), rng=rng)
        mats = apply_quality_haircut(choose_material_mix(rng, include_commercial=include_commercial), rng)
        materials: list[Material] = []
        for mtype, lbs in mats:
            m = Material(type=mtype, lbs=lbs)
            m.value = _rate_value(mtype, lbs)  # override model defaults for simulation realism
            materials.append(m)

        listing = Listing(
            address=f"{100 + i} Simulated Ave, Santa Clara County",
            lat=lat,
            lng=lng,
            household_name=f"Household {i+1}",
            phone=f"+1408555{i:04d}"[-12:],
            materials=materials,
            notes="Simulated listing (opt-in pickup via app)",
        )
        # Add disposal friction explicitly if we see CRT pounds (negative commodity value already models this),
        # but keep it as a separate line item to make the mock drill easier to explain.
        crt_lbs = sum(m.lbs for m in listing.materials if m.type == "ewaste_crt")
        if crt_lbs > 0:
            # CRT disposal handling is often a *cost*, not revenue.
            listing.materials.append(Material(type="disposal_fee", lbs=0.0, value=round(-crt_lbs * 0.20, 2)))
        _add_policy_fees(listing, policy)
        listings.append(listing)
    return listings


def prequalify(listings: Iterable[Listing], *, min_payout: float) -> list[Listing]:
    """
    Filter to realistic app-viable listings:
    - minimum expected payout (driver won't take $1 jobs).
    - allow a few "special handling" jobs if a fee is present.
    - avoid very heavy/low-value-only loads that destroy $/mile.
    """
    filtered: list[Listing] = []
    for listing in listings:
        high_value_present = any(m.type in HIGH_VALUE_TYPES for m in listing.materials)
        if listing.total_value >= min_payout or high_value_present:
            if not (listing.total_lbs > 180 and listing.total_value < max(min_payout * 1.8, 18)):
                filtered.append(listing)
    return filtered


def compute_day_result(
    route: list,
    summary: Dict[str, float],
    listing_by_id: Dict[str, Listing],
) -> DayResult:
    """
    Convert a chosen route into earnings/costs using a split between:
    - commodity value (haircut by PAYOUT_REALIZATION),
    - per-stop/service fees (not haircutted),
    - operating costs (miles + per-stop + per-lb + unload time).
    """
    miles = float(summary["total_miles"]) + DROP_OFF_EXTRA_MILES
    stops = int(summary["total_stops"])
    lbs = float(summary["total_lbs"])
    route_minutes = int(summary["estimated_minutes"]) + DROP_OFF_WAIT_MIN

    gross_commodity = 0.0
    gross_fees = 0.0
    for stop in route:
        listing = listing_by_id.get(stop.listing_id)
        if not listing:
            continue
        for m in listing.materials:
            if m.type in FEE_TYPES:
                gross_fees += float(m.value)
            else:
                gross_commodity += float(m.value)

    realized_revenue = round((gross_commodity * PAYOUT_REALIZATION) + gross_fees, 2)
    operating = round((miles * VEHICLE_COST_PER_MILE) + (stops * HANDLING_COST_PER_STOP) + (lbs * YARD_FEE_PER_LB), 2)
    net = round(realized_revenue - operating, 2)
    hours = (route_minutes + POST_ROUTE_FIXED_MIN) / 60.0
    hourly = net / hours if hours > 0 else 0.0
    return DayResult(
        stops=stops,
        lbs=lbs,
        miles=miles,
        gross_value=round(gross_commodity + gross_fees, 2),
        realized_revenue=realized_revenue,
        operating_cost=operating,
        net_profit=net,
        route_minutes=route_minutes,
        hourly_net=hourly,
    )


def percentile(values: list[float], p: float) -> float:
    if not values:
        return 0.0
    s = sorted(values)
    idx = int(round((len(s) - 1) * p))
    return s[max(0, min(idx, len(s) - 1))]


def summarize(results: list[DayResult], label: str) -> None:
    stops = [r.stops for r in results]
    lbs = [r.lbs for r in results]
    miles = [r.miles for r in results]
    gross = [r.gross_value for r in results]
    net = [r.net_profit for r in results]
    hourly = [r.hourly_net for r in results]

    print(f"\n=== {label} ===")
    print(f"Days simulated: {len(results)}")
    print(f"Stops/day: median {statistics.median(stops):.1f} | p25 {percentile(stops, 0.25):.0f} | p75 {percentile(stops, 0.75):.0f}")
    print(f"Lbs/day:   median {statistics.median(lbs):.1f} | p25 {percentile(lbs, 0.25):.1f} | p75 {percentile(lbs, 0.75):.1f}")
    print(f"Miles/day: median {statistics.median(miles):.1f} | p25 {percentile(miles, 0.25):.1f} | p75 {percentile(miles, 0.75):.1f}")
    print(f"Gross $:   median {statistics.median(gross):.2f} | p25 {percentile(gross, 0.25):.2f} | p75 {percentile(gross, 0.75):.2f}")
    print(f"Net $:     median {statistics.median(net):.2f} | p25 {percentile(net, 0.25):.2f} | p75 {percentile(net, 0.75):.2f}")
    print(f"Net $/hr:  median {statistics.median(hourly):.2f} | p25 {percentile(hourly, 0.25):.2f} | p75 {percentile(hourly, 0.75):.2f}")
    print(f"P(net >= $100): {sum(1 for n in net if n >= 100) / max(len(net), 1):.1%}")


def print_household_baseline() -> None:
    hh_day = EPA_RECYCLING_LB_PER_PERSON_DAY * SCC_PERSONS_PER_HOUSEHOLD
    hh_week = hh_day * 7
    low_stops = 10 * hh_week
    high_stops = 15 * hh_week
    print("=== Baseline household recyclables context ===")
    print(f"Assumed avg recyclable generation per household: {hh_day:.2f} lb/day (~{hh_week:.1f} lb/week)")
    print(f"10-15 stop route baseline material pool: ~{low_stops:.0f}-{high_stops:.0f} lb/week equivalent")
    print("Interpretation: scrap-only pickup is usually not worth it unless stops are pre-qualified or fees exist.")


def _material_breakdown(listing: Listing) -> tuple[str, float, float]:
    """
    Return: (short text, commodity_value, fee_value)
    """
    commodity_value = 0.0
    fee_value = 0.0
    parts: list[str] = []
    for m in listing.materials:
        if m.type in {"pickup_fee", "disposal_fee"}:
            fee_value += float(m.value)
            continue
        if m.lbs <= 0:
            continue
        parts.append(f"{m.type}:{m.lbs:.0f}lb")
        commodity_value += float(m.value)
    text = ", ".join(parts[:4]) + ("…" if len(parts) > 4 else "")
    return text, commodity_value, fee_value


def print_mock_drill(
    route: list,
    summary: dict,
    listing_by_id: dict[str, Listing],
    day: DayResult,
    *,
    label: str,
    start_time: dt.datetime,
) -> None:
    print(f"\n=== Mock Drill: {label} ===")
    print(f"Truck cap: {TRUCK_CAPACITY_LBS:.0f} lb | Shift: {SHIFT_MINUTES} min | Stops: {day.stops} | Miles: {day.miles:.1f}")
    print(f"Gross (incl fees): ${day.gross_value:.2f} | Realized: ${day.realized_revenue:.2f} | Costs: ${day.operating_cost:.2f}")
    print(f"Net: ${day.net_profit:.2f} | Net/hr: ${day.hourly_net:.2f}\n")

    cum_lbs = 0.0
    for idx, stop in enumerate(route, start=1):
        listing = listing_by_id.get(stop.listing_id)
        if not listing:
            continue
        cum_lbs += listing.total_lbs
        mat_text, commodity_value, fee_value = _material_breakdown(listing)
        eta = start_time + dt.timedelta(minutes=int(stop.eta_minutes))
        print(
            f"{idx:>2}. {eta.strftime('%I:%M %p').lstrip('0')}  "
            f"+{stop.distance_from_prev:>4.1f} mi  "
            f"load {cum_lbs:>5.1f}/{TRUCK_CAPACITY_LBS:.0f} lb  "
            f"${commodity_value:>6.2f} scrap  {fee_value:+7.2f} fee  "
            f"{stop.address}  ({mat_text})"
        )

    print(
        f"\nEnd: drive to drop-off (+{DROP_OFF_EXTRA_MILES:.1f} mi), wait/unload ~{DROP_OFF_WAIT_MIN + POST_ROUTE_FIXED_MIN} min."
    )
    if day.hourly_net >= 22:
        print("Driver decision: likely worth doing (>= ~$22/hr net).")
    elif day.hourly_net >= 15:
        print("Driver decision: borderline (works only if route density is high and no surprises).")
    else:
        print("Driver decision: not worth it on scrap-only economics; needs higher fees, denser stops, or commercial contracts.")


def run(
    days: int,
    seed: int,
    market_count: int,
    shift_minutes: int,
    truck_capacity_lbs: float,
    *,
    include_commercial: bool,
    mock_drill: bool,
) -> None:
    rng = random.Random(seed)
    optimizer = RouteOptimizer()

    scrap_only_naive: list[DayResult] = []
    scrap_only_qualified: list[DayResult] = []
    fees_qualified: list[DayResult] = []

    for _ in range(days):
        base_market = build_market(
            market_count,
            rng,
            include_commercial=include_commercial,
            policy="scrap_only",
        )

        naive_route, naive_summary = optimizer.optimize(
            driver_lat=BASE_LAT,
            driver_lng=BASE_LNG,
            listings=base_market,
            max_minutes=shift_minutes,
            truck_capacity_lbs=truck_capacity_lbs,
        )
        if naive_route:
            listing_by_id = {l.id: l for l in base_market}
            scrap_only_naive.append(compute_day_result(naive_route, naive_summary, listing_by_id))

        qualified_market = prequalify(base_market, min_payout=6.0)
        qualified_route, qualified_summary = optimizer.optimize(
            driver_lat=BASE_LAT,
            driver_lng=BASE_LNG,
            listings=qualified_market,
            max_minutes=shift_minutes,
            truck_capacity_lbs=truck_capacity_lbs,
        )
        if qualified_route:
            listing_by_id = {l.id: l for l in qualified_market}
            scrap_only_qualified.append(compute_day_result(qualified_route, qualified_summary, listing_by_id))

        # Same underlying market, but with per-stop fees/subsidies that make it driver-viable.
        market_with_fees = copy.deepcopy(base_market)
        for l in market_with_fees:
            _add_policy_fees(l, "commercial_contracts" if include_commercial else "household_fees")
        qualified_market_with_fees = prequalify(market_with_fees, min_payout=10.0)
        route_with_fees, summary_with_fees = optimizer.optimize(
            driver_lat=BASE_LAT,
            driver_lng=BASE_LNG,
            listings=qualified_market_with_fees,
            max_minutes=shift_minutes,
            truck_capacity_lbs=truck_capacity_lbs,
        )
        if route_with_fees:
            listing_by_id = {l.id: l for l in qualified_market_with_fees}
            fees_qualified.append(compute_day_result(route_with_fees, summary_with_fees, listing_by_id))

        if mock_drill:
            start_time = dt.datetime(2026, 2, 28, 8, 0)
            print_household_baseline()
            if naive_route:
                print_mock_drill(
                    naive_route,
                    naive_summary,
                    {l.id: l for l in base_market},
                    scrap_only_naive[-1],
                    label="Policy A: Scrap-only (no fees), no filtering",
                    start_time=start_time,
                )
            if qualified_route:
                print_mock_drill(
                    qualified_route,
                    qualified_summary,
                    {l.id: l for l in qualified_market},
                    scrap_only_qualified[-1],
                    label="Policy B: Scrap-only, value-aware filtering",
                    start_time=start_time,
                )
            if route_with_fees:
                print_mock_drill(
                    route_with_fees,
                    summary_with_fees,
                    {l.id: l for l in qualified_market_with_fees},
                    fees_qualified[-1],
                    label="Policy C: Fee-backed pickups (what makes drivers actually do it)",
                    start_time=start_time,
                )
            return

    print_household_baseline()
    summarize(scrap_only_naive, "Policy A: Scrap-only, no filtering (what happens if you just 'pick up recyclables')")
    summarize(scrap_only_qualified, "Policy B: Scrap-only, pre-qualified listings (driver avoids $1 stops)")
    summarize(fees_qualified, "Policy C: Fee-backed pickups (household fees or commercial contracts)")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Simulate realistic Bin2Bucks driver economics.")
    parser.add_argument("--days", type=int, default=300, help="Number of simulated days.")
    parser.add_argument("--seed", type=int, default=42, help="Random seed.")
    parser.add_argument("--market-count", type=int, default=DEFAULT_MARKET_LISTINGS, help="Listings available in local market.")
    parser.add_argument("--shift-minutes", type=int, default=SHIFT_MINUTES, help="Max pickup minutes before unload.")
    parser.add_argument("--truck-capacity-lbs", type=float, default=TRUCK_CAPACITY_LBS, help="Truck capacity constraint in pounds.")
    parser.add_argument("--include-commercial", action="store_true", help="Include a small % of commercial cardboard pickups.")
    parser.add_argument("--mock-drill", action="store_true", help="Print one believable stop-by-stop day and exit.")
    return parser.parse_args()


if __name__ == "__main__":
    args = parse_args()
    run(
        days=args.days,
        seed=args.seed,
        market_count=args.market_count,
        shift_minutes=args.shift_minutes,
        truck_capacity_lbs=args.truck_capacity_lbs,
        include_commercial=args.include_commercial,
        mock_drill=args.mock_drill,
    )
