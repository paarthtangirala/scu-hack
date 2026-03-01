"""
Route optimization engine.
Primary solver: OR-Tools prize-collecting VRP.
Fallback: greedy value-per-minute heuristic.
"""
import logging
import math
import os
import time
from typing import List, Optional
from backend.models.listing import Listing
from backend.models.route import RouteStop

try:
    from ortools.constraint_solver import pywrapcp, routing_enums_pb2
    ORTOOLS_AVAILABLE = True
except ImportError:  # pragma: no cover - tested via monkeypatch
    ORTOOLS_AVAILABLE = False

MPH = 25.0  # urban Bay Area estimate
STOP_TIME_MIN = 5  # minutes per stop to load
LNS_TIME_SEC = 2
CAPACITY_SCALE = 10  # tenths of pounds for integer capacity constraints
# Tuned to make objective preference clearer in OR-Tools prize collection:
# value objective remains dollar-driven while lbs objective more aggressively favors truck fill.
VALUE_PENALTY_MULTIPLIER = 60
LBS_PENALTY_MULTIPLIER = 180  # converts lbs "prize" into distance-like objective scale
MILES_TO_METERS = 1609.34
GREEDY_TIE_EPSILON = 1e-12
PRIORITY_PENALTY_BOOST = 1_000_000_000
PRIORITY_SCORE_BOOST = 1_000_000.0

logger = logging.getLogger(__name__)


def _normalize_objective(obj: Optional[str]) -> str:
    o = (obj or "value").strip().lower()
    if o in {"value", "profit", "earnings", "$"}:
        return "value"
    if o in {"lbs", "weight", "impact", "diversion"}:
        return "lbs"
    return "value"


class RouteOptimizer:
    def optimize(
        self,
        driver_lat: float,
        driver_lng: float,
        listings: List[Listing],
        max_minutes: float,
        truck_capacity_lbs: float = 1000.0,
        objective: str = "value",
        force_fallback: bool = False,
        priority_listing_ids: Optional[List[str]] = None,
    ) -> tuple[list[RouteStop], dict]:
        objective = _normalize_objective(objective)
        force_fallback = force_fallback or _env_truthy("OPTIMIZER_FORCE_FALLBACK")
        priority_ids = {
            str(listing_id).strip()
            for listing_id in (priority_listing_ids or [])
            if str(listing_id).strip()
        }
        available = [l for l in listings if l.status == "available"]
        if not available:
            return [], self._build_summary([], truck_capacity_lbs, solver="none", solve_time_ms=0, objective=objective)

        start = time.perf_counter()
        if ORTOOLS_AVAILABLE and not force_fallback:
            try:
                route = self._solve_ortools(
                    driver_lat=driver_lat,
                    driver_lng=driver_lng,
                    listings=available,
                    max_minutes=max_minutes,
                    truck_capacity_lbs=truck_capacity_lbs,
                    objective=objective,
                    priority_ids=priority_ids,
                )
                solve_time_ms = int((time.perf_counter() - start) * 1000)
                return route, self._build_summary(route, truck_capacity_lbs, solver="ortools", solve_time_ms=solve_time_ms, objective=objective)
            except Exception as exc:
                logger.warning(
                    "optimizer_fallback %s",
                    {
                        "event": "optimizer_fallback",
                        "reason": "ortools_exception",
                        "exception_type": exc.__class__.__name__,
                        "objective": objective,
                        "listing_count": len(available),
                    },
                )
        elif force_fallback:
            logger.info(
                "optimizer_fallback %s",
                {
                    "event": "optimizer_fallback",
                    "reason": "forced_fallback_mode",
                    "objective": objective,
                    "listing_count": len(available),
                },
            )

        route = self._solve_greedy(
            driver_lat=driver_lat,
            driver_lng=driver_lng,
            listings=available,
            max_minutes=max_minutes,
            truck_capacity_lbs=truck_capacity_lbs,
            objective=objective,
            priority_ids=priority_ids,
        )
        solve_time_ms = int((time.perf_counter() - start) * 1000)
        solver_name = "greedy_fallback" if ORTOOLS_AVAILABLE else "greedy"
        return route, self._build_summary(route, truck_capacity_lbs, solver=solver_name, solve_time_ms=solve_time_ms, objective=objective)

    def _solve_ortools(
        self,
        driver_lat: float,
        driver_lng: float,
        listings: List[Listing],
        max_minutes: float,
        truck_capacity_lbs: float,
        objective: str,
        priority_ids: set[str],
    ) -> list[RouteStop]:
        node_lats = [driver_lat] + [l.lat for l in listings]
        node_lngs = [driver_lng] + [l.lng for l in listings]
        node_count = len(node_lats)

        distance_miles = [
            [
                self._haversine(node_lats[i], node_lngs[i], node_lats[j], node_lngs[j])
                for j in range(node_count)
            ]
            for i in range(node_count)
        ]
        distance_meters = [
            [int(round(miles * MILES_TO_METERS)) for miles in row]
            for row in distance_miles
        ]
        travel_seconds = [
            [int(round((miles / MPH) * 3600)) for miles in row]
            for row in distance_miles
        ]
        demands = [0] + [max(0, int(round(l.total_lbs * CAPACITY_SCALE))) for l in listings]
        # Prize-collecting objective: pay a penalty if we skip a stop.
        # "value" objective favors higher $ stops; "lbs" favors heavier pickups (impact, faster fill).
        if objective == "lbs":
            base_prizes = [max(0, int(round(l.total_lbs * LBS_PENALTY_MULTIPLIER))) for l in listings]
        else:
            base_prizes = [
                max(1, int(round(l.total_value * 100)) * VALUE_PENALTY_MULTIPLIER)
                for l in listings
            ]
        prizes = [0]
        for listing, prize in zip(listings, base_prizes):
            if listing.id in priority_ids:
                prize += PRIORITY_PENALTY_BOOST
            prizes.append(max(1, int(prize)))

        manager = pywrapcp.RoutingIndexManager(node_count, 1, 0)
        routing = pywrapcp.RoutingModel(manager)

        def cost_callback(from_index: int, to_index: int) -> int:
            from_node = manager.IndexToNode(from_index)
            to_node = manager.IndexToNode(to_index)
            if from_node != 0 and to_node == 0:
                return 0  # open route: no return-to-depot penalty
            return distance_meters[from_node][to_node]

        cost_callback_idx = routing.RegisterTransitCallback(cost_callback)
        routing.SetArcCostEvaluatorOfAllVehicles(cost_callback_idx)

        def time_callback(from_index: int, to_index: int) -> int:
            from_node = manager.IndexToNode(from_index)
            to_node = manager.IndexToNode(to_index)
            travel = 0 if (from_node != 0 and to_node == 0) else travel_seconds[from_node][to_node]
            service = STOP_TIME_MIN * 60 if from_node != 0 else 0
            return travel + service

        time_callback_idx = routing.RegisterTransitCallback(time_callback)
        routing.AddDimension(
            time_callback_idx,
            0,
            max(0, int(round(max_minutes * 60))),
            True,
            "Time",
        )

        def capacity_callback(from_index: int) -> int:
            from_node = manager.IndexToNode(from_index)
            return demands[from_node]

        capacity_callback_idx = routing.RegisterUnaryTransitCallback(capacity_callback)
        routing.AddDimensionWithVehicleCapacity(
            capacity_callback_idx,
            0,
            [max(0, int(round(truck_capacity_lbs * CAPACITY_SCALE)))],
            True,
            "Capacity",
        )

        for node in range(1, node_count):
            penalty = max(1, prizes[node])
            routing.AddDisjunction([manager.NodeToIndex(node)], int(penalty))

        search_params = pywrapcp.DefaultRoutingSearchParameters()
        search_params.first_solution_strategy = routing_enums_pb2.FirstSolutionStrategy.PATH_CHEAPEST_ARC
        search_params.local_search_metaheuristic = routing_enums_pb2.LocalSearchMetaheuristic.GUIDED_LOCAL_SEARCH
        search_params.time_limit.FromSeconds(LNS_TIME_SEC)

        solution = routing.SolveWithParameters(search_params)
        if solution is None:
            raise RuntimeError("OR-Tools could not find a solution.")

        route: list[RouteStop] = []
        cur_index = routing.Start(0)
        cur_lat, cur_lng = driver_lat, driver_lng
        elapsed_minutes = 0.0

        while True:
            next_index = solution.Value(routing.NextVar(cur_index))
            if routing.IsEnd(next_index):
                break

            next_node = manager.IndexToNode(next_index)
            listing = listings[next_node - 1]
            distance = self._haversine(cur_lat, cur_lng, listing.lat, listing.lng)
            travel_minutes = (distance / MPH) * 60
            elapsed_minutes += travel_minutes + STOP_TIME_MIN

            route.append(
                RouteStop(
                    listing_id=listing.id,
                    address=listing.address,
                    lat=listing.lat,
                    lng=listing.lng,
                    household_name=listing.household_name,
                    phone=listing.phone,
                    total_value=listing.total_value,
                    total_lbs=listing.total_lbs,
                    listing_kind=getattr(listing, "listing_kind", "household"),
                    materials=[m.to_dict() for m in listing.materials],
                    distance_from_prev=round(distance, 2),
                    travel_minutes=round(travel_minutes, 1),
                    eta_minutes=round(elapsed_minutes),
                    notes=listing.notes,
                )
            )

            cur_lat, cur_lng = listing.lat, listing.lng
            cur_index = next_index

        return route

    def _solve_greedy(
        self,
        driver_lat: float,
        driver_lng: float,
        listings: List[Listing],
        max_minutes: float,
        truck_capacity_lbs: float,
        objective: str,
        priority_ids: set[str],
    ) -> list[RouteStop]:
        route: list[RouteStop] = []
        cur_lat, cur_lng = driver_lat, driver_lng
        remaining_cap = truck_capacity_lbs
        remaining_time = max_minutes
        visited: set[str] = set()
        elapsed_minutes = 0.0

        while listings:
            best = None
            best_score = -1.0
            best_dist = 0.0
            best_travel = 0.0

            for listing in listings:
                if listing.id in visited:
                    continue
                if listing.total_lbs > remaining_cap:
                    continue

                dist = self._haversine(cur_lat, cur_lng, listing.lat, listing.lng)
                travel_min = (dist / MPH) * 60
                total_time = travel_min + STOP_TIME_MIN
                if total_time > remaining_time:
                    continue

                prize = listing.total_lbs if objective == "lbs" else listing.total_value
                score = prize / max(total_time, 0.01)
                if listing.id in priority_ids:
                    score += PRIORITY_SCORE_BOOST
                if score > (best_score + GREEDY_TIE_EPSILON):
                    best, best_score, best_dist, best_travel = listing, score, dist, travel_min
                    continue

                # Stable tie-breakers make fallback path deterministic for repeated runs.
                if abs(score - best_score) <= GREEDY_TIE_EPSILON and best is not None:
                    cur_key = (round(travel_min, 9), round(dist, 9), str(listing.id))
                    best_key = (round(best_travel, 9), round(best_dist, 9), str(best.id))
                    if cur_key < best_key:
                        best, best_score, best_dist, best_travel = listing, score, dist, travel_min

            if best is None:
                break

            elapsed_minutes += best_travel + STOP_TIME_MIN
            route.append(
                RouteStop(
                    listing_id=best.id,
                    address=best.address,
                    lat=best.lat,
                    lng=best.lng,
                    household_name=best.household_name,
                    phone=best.phone,
                    total_value=best.total_value,
                    total_lbs=best.total_lbs,
                    listing_kind=getattr(best, "listing_kind", "household"),
                    materials=[m.to_dict() for m in best.materials],
                    distance_from_prev=round(best_dist, 2),
                    travel_minutes=round(best_travel, 1),
                    eta_minutes=round(elapsed_minutes),
                    notes=best.notes,
                )
            )
            visited.add(best.id)
            remaining_cap -= best.total_lbs
            remaining_time -= (best_travel + STOP_TIME_MIN)
            cur_lat, cur_lng = best.lat, best.lng

        return route

    @staticmethod
    def _build_summary(
        route: list[RouteStop],
        truck_capacity_lbs: float,
        solver: str,
        solve_time_ms: int,
        objective: str,
    ) -> dict:
        total_lbs = sum(s.total_lbs for s in route)
        fill_pct = (total_lbs / truck_capacity_lbs) * 100 if truck_capacity_lbs > 0 else 0.0
        est_minutes = round(sum(s.travel_minutes + STOP_TIME_MIN for s in route))
        hours = max(est_minutes / 60.0, 1e-6)
        lbs_per_hour = total_lbs / hours if total_lbs > 0 else 0.0
        return {
            "total_stops": len(route),
            "total_value": round(sum(s.total_value for s in route), 2),
            "total_lbs": round(total_lbs, 1),
            "total_miles": round(sum(s.distance_from_prev for s in route), 1),
            "truck_fill_pct": round(fill_pct, 1),
            "estimated_minutes": est_minutes,
            "lbs_per_hour": round(lbs_per_hour, 1),
            "objective": objective,
            "solver": solver,
            "solve_time_ms": solve_time_ms,
        }

    @staticmethod
    def _haversine(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
        radius_miles = 3958.8
        phi1, phi2 = math.radians(lat1), math.radians(lat2)
        dphi = math.radians(lat2 - lat1)
        dlambda = math.radians(lng2 - lng1)
        a = math.sin(dphi / 2) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(dlambda / 2) ** 2
        return radius_miles * 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))


def _env_truthy(name: str) -> bool:
    raw = os.getenv(name, "")
    return raw.strip().lower() in {"1", "true", "yes", "on"}
