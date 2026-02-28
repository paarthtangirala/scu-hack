"""
Route optimization engine — greedy $/minute algorithm.
Owner: Soham
"""
import math
from typing import List
from backend.models.listing import Listing
from backend.models.route import RouteStop

MPH = 25.0  # urban Bay Area estimate
STOP_TIME_MIN = 5  # minutes per stop to load

class RouteOptimizer:
    def optimize(
        self,
        driver_lat: float,
        driver_lng: float,
        listings: List[Listing],
        max_minutes: float,
        truck_capacity_lbs: float = 1000.0
    ) -> tuple[list[RouteStop], dict]:
        
        available = [l for l in listings if l.status == "available"]
        route: list[RouteStop] = []
        cur_lat, cur_lng = driver_lat, driver_lng
        remaining_cap = truck_capacity_lbs
        remaining_time = max_minutes
        visited = set()

        while available:
            best = None
            best_score = -1
            best_dist = 0.0
            best_travel = 0.0

            for listing in available:
                if listing.id in visited:
                    continue
                if listing.total_lbs > remaining_cap:
                    continue
                dist = self._haversine(cur_lat, cur_lng, listing.lat, listing.lng)
                travel_min = (dist / MPH) * 60
                total_time = travel_min + STOP_TIME_MIN
                if total_time > remaining_time:
                    continue
                score = listing.total_value / max(total_time, 0.01)
                if score > best_score:
                    best, best_score, best_dist, best_travel = listing, score, dist, travel_min

            if best is None:
                break

            cumulative_min = sum(
                (s.travel_minutes + STOP_TIME_MIN) for s in route
            ) + best_travel + STOP_TIME_MIN

            stop = RouteStop(
                listing_id=best.id,
                address=best.address,
                lat=best.lat,
                lng=best.lng,
                household_name=best.household_name,
                phone=best.phone,
                total_value=best.total_value,
                total_lbs=best.total_lbs,
                distance_from_prev=round(best_dist, 2),
                travel_minutes=round(best_travel, 1),
                eta_minutes=round(cumulative_min),
                notes=best.notes,
            )
            route.append(stop)
            visited.add(best.id)
            remaining_cap -= best.total_lbs
            remaining_time -= (best_travel + STOP_TIME_MIN)
            cur_lat, cur_lng = best.lat, best.lng

        total_lbs = sum(s.total_lbs for s in route)
        summary = {
            "total_stops": len(route),
            "total_value": round(sum(s.total_value for s in route), 2),
            "total_lbs": round(total_lbs, 1),
            "total_miles": round(sum(s.distance_from_prev for s in route), 1),
            "truck_fill_pct": round((total_lbs / truck_capacity_lbs) * 100, 1),
            "estimated_minutes": round(sum(s.travel_minutes + STOP_TIME_MIN for s in route)),
        }
        return route, summary

    @staticmethod
    def _haversine(lat1, lng1, lat2, lng2) -> float:
        R = 3958.8
        phi1, phi2 = math.radians(lat1), math.radians(lat2)
        dphi = math.radians(lat2 - lat1)
        dl = math.radians(lng2 - lng1)
        a = math.sin(dphi/2)**2 + math.cos(phi1)*math.cos(phi2)*math.sin(dl/2)**2
        return R * 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))
