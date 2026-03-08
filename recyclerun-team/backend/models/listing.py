"""
Listing model — one household's recyclables.
Owner: Paarth
"""
import uuid
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any, Dict, List, Optional
from .material import Material


def _estimated_row_to_dict(row: Any) -> Dict[str, Any]:
    if isinstance(row, Material):
        return row.to_dict()
    if not isinstance(row, dict):
        return {}
    m_type = str(row.get("type", "")).strip()
    if not m_type:
        return {}
    try:
        lbs = round(float(row.get("lbs", row.get("weight_lbs", 0))), 1)
    except (TypeError, ValueError):
        return {}
    if lbs <= 0:
        return {}
    material = Material(type=m_type, lbs=lbs)
    payload = material.to_dict()
    payload["count"] = max(1, int(row.get("count", 1) or 1))
    payload["confidence"] = round(float(row.get("confidence", 0.0) or 0.0), 2)
    payload["weight_confidence"] = round(float(row.get("weight_confidence", payload["confidence"]) or payload["confidence"]), 2)
    payload["weight_low"] = round(float(row.get("weight_low", lbs) or lbs), 1)
    payload["weight_high"] = round(float(row.get("weight_high", lbs) or lbs), 1)
    payload["provenance"] = str(row.get("provenance", "") or "").strip()
    payload["candidate_id"] = str(row.get("candidate_id", "") or "").strip()
    return payload

@dataclass
class Listing:
    address: str
    lat: float
    lng: float
    household_name: str
    phone: str
    listing_kind: str = "household"  # household | business (demo uses this for mixed markets)
    materials: List[Material] = field(default_factory=list)
    estimated_materials: List[Dict[str, Any]] = field(default_factory=list)
    notes: str = ""
    capture_mode: str = "manual"
    source_session_id: str = ""
    estimated_total_lbs: float = 0.0
    estimated_confidence: float = 0.0
    org_id: str = "org_santa_clara_demo"
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
        estimated_materials = self.estimated_materials or self.materials
        estimated_rows = [_estimated_row_to_dict(row) for row in estimated_materials]
        estimated_rows = [row for row in estimated_rows if row]
        estimated_total_lbs = self.estimated_total_lbs or round(
            sum(float(row.get("lbs", 0) or 0) for row in estimated_rows),
            1,
        )
        return {
            "id": self.id,
            "address": self.address,
            "lat": self.lat,
            "lng": self.lng,
            "household_name": self.household_name,
            "phone": self.phone,
            "listing_kind": self.listing_kind,
            "materials": [m.to_dict() for m in self.materials],
            "estimated_materials": estimated_rows,
            "notes": self.notes,
            "status": self.status,
            "posted_at": self.posted_at,
            "photo_url": self.photo_url,
            "capture_mode": self.capture_mode,
            "source_session_id": self.source_session_id,
            "estimated_total_lbs": estimated_total_lbs,
            "estimated_confidence": round(float(self.estimated_confidence or 0.0), 2),
            "org_id": self.org_id,
            "total_value": self.total_value,
            "total_lbs": self.total_lbs,
        }
