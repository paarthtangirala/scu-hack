"""
Route optimization + route acceptance endpoints.
Owner: Atharva
"""
from flask import Blueprint, request, jsonify
from backend.services.optimizer import RouteOptimizer
from backend.services.voice import VoiceNotifier
from backend.services.database import ListingStore

optimize_bp = Blueprint("optimize", __name__, url_prefix="/api")
optimizer = RouteOptimizer()
notifier = VoiceNotifier()
store = ListingStore()

@optimize_bp.post("/optimize-route")
def optimize_route():
    data = request.json
    stops, summary = optimizer.optimize(
        driver_lat=data.get("lat", 37.3541),
        driver_lng=data.get("lng", -121.9552),
        listings=store.all("available"),
        max_minutes=data.get("max_minutes", 120),
        truck_capacity_lbs=data.get("truck_capacity_lbs", 1000),
    )
    return jsonify({"stops": [s.to_dict() for s in stops], "summary": summary})

@optimize_bp.post("/accept-route")
def accept_route():
    data = request.json
    route_stops = data.get("stops", [])
    driver_name = data.get("driver_name", "your RecycleRun driver")
    notifications = []

    for stop in route_stops:
        lid = stop.get("listing_id") or stop.get("id")
        listing = store.get(lid)
        if listing:
            store.update_status(lid, "claimed")
            result = notifier.notify(
                phone=listing.phone,
                household_name=listing.household_name,
                eta_minutes=stop.get("eta_minutes", 30),
                driver_name=driver_name
            )
            notifications.append({"listing_id": lid, "household": listing.household_name,
                                   "phone": listing.phone, "notification": result})

    return jsonify({"success": True, "notifications_sent": len(notifications), "notifications": notifications})
