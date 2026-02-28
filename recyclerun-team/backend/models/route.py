"""
Route and RouteStop models.
Owner: Paarth
"""
import uuid
from dataclasses import dataclass, field
from datetime import datetime
from typing import List

@dataclass
class RouteStop:
    listing_id: str
    address: str
    lat: float
    lng: float
    household_name: str
    phone: str
    total_value: float
    total_lbs: float
    distance_from_prev: float
    travel_minutes: float
    eta_minutes: int
    notes: str = ""
    status: str = "pending"   # pending | arrived | completed

    def to_dict(self) -> dict:
        return self.__dict__.copy()

@dataclass
class Route:
    stops: List[RouteStop]
    driver_name: str
    id: str = field(default_factory=lambda: f"route_{str(uuid.uuid4())[:8]}")
    accepted_at: str = field(default_factory=lambda: datetime.now().isoformat())
    status: str = "active"

    @property
    def total_value(self): return round(sum(s.total_value for s in self.stops), 2)
    @property
    def total_lbs(self): return round(sum(s.total_lbs for s in self.stops), 1)
    @property
    def total_miles(self): return round(sum(s.distance_from_prev for s in self.stops), 1)

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "driver_name": self.driver_name,
            "stops": [s.to_dict() for s in self.stops],
            "total_value": self.total_value,
            "total_lbs": self.total_lbs,
            "total_miles": self.total_miles,
            "accepted_at": self.accepted_at,
            "status": self.status,
        }
