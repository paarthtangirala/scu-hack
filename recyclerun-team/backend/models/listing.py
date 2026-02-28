"""
Listing model — one household's recyclables.
Owner: Paarth
"""
import uuid
from dataclasses import dataclass, field
from datetime import datetime
from typing import List, Optional
from .material import Material

@dataclass
class Listing:
    address: str
    lat: float
    lng: float
    household_name: str
    phone: str
    listing_kind: str = "household"  # household | business (demo uses this for mixed markets)
    materials: List[Material] = field(default_factory=list)
    notes: str = ""
    id: str = field(default_factory=lambda: f"listing_{str(uuid.uuid4())[:8]}")
    status: str = "available"   # available | claimed | completed
    posted_at: str = field(default_factory=lambda: datetime.now().isoformat())
    photo_url: Optional[str] = None

    @property
    def total_value(self) -> float:
        return round(sum(m.value for m in self.materials), 2)

    @property
    def total_lbs(self) -> float:
        return round(sum(m.lbs for m in self.materials), 1)

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "address": self.address,
            "lat": self.lat,
            "lng": self.lng,
            "household_name": self.household_name,
            "phone": self.phone,
            "listing_kind": self.listing_kind,
            "materials": [m.to_dict() for m in self.materials],
            "notes": self.notes,
            "status": self.status,
            "posted_at": self.posted_at,
            "photo_url": self.photo_url,
            "total_value": self.total_value,
            "total_lbs": self.total_lbs,
        }
