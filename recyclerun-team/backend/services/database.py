"""
In-memory listing store with seed data.
Owner: Soham
Replace with Firebase in production.
"""
from __future__ import annotations

import threading
from typing import Dict, List

from backend.models.listing import Listing
from backend.models.material import Material


VALID_STATUSES = {"available", "claimed", "completed"}
STATUS_TRANSITIONS = {
    "available": {"claimed", "completed"},
    "claimed": {"available", "completed"},
    "completed": set(),
}


class ListingStore:
    def __init__(self):
        self._lock = threading.RLock()
        self._listings: Dict[str, Listing] = {}
        self._seed_count = 0
        self._seed()
        self._seed_count = len(self._listings)

    def _seed(self):
        seed_data = [
            ("742 Everglade Ave, Santa Clara", 37.3541, -121.9552, "Chen Family",       "+14085550101",
             [("cardboard",18),("aluminum_cans",3.2),("plastic_pet",2.1)],     "Near garage door"),
            ("1208 Kiely Blvd, Santa Clara",   37.3498, -121.9621, "Rivera Household",  "+14085550102",
             [("ewaste_noncrt",8.5),("cardboard",12),("scrap_aluminum",4.0)],  "Old laptop + router"),
            ("3301 Pruneridge Ave, Santa Clara",37.3612, -121.9789, "Park Residence",   "+14085550103",
             [("copper_wire",2.5),("scrap_metal_mixed",11.0),("steel_iron",8.0)],"Old wiring + scrap"),
            ("985 Homestead Rd, Sunnyvale",    37.3688, -122.0141, "Nguyen Family",     "+14085550104",
             [("aluminum_cans",8.5),("glass_bottles",12.0),("plastic_hdpe",3.5)],"Party cleanup"),
            ("2187 Monroe St, Santa Clara",    37.3449, -121.9701, "Thompson Residence","+14085550105",
             [("ewaste_crt",35.0),("ewaste_noncrt",6.0)],                       "2 CRT TVs + tablets. Heavy!"),
            ("4421 Stevens Creek Blvd, San Jose",37.3229,-121.9876,"Garcia Family",    "+14085550106",
             [("cardboard",45.0),("newspaper",8.0),("plastic_pet",4.5)],        "Moving boxes"),
            ("671 Pastoria Ave, Sunnyvale",    37.3751, -122.0052, "Kim Household",     "+14085550107",
             [("copper_wire",4.2),("scrap_aluminum",7.5),("ewaste_noncrt",3.0)],"Workshop cleanout"),
            ("1833 Benton St, Santa Clara",    37.3578, -121.9834, "Patel Family",      "+14085550108",
             [("aluminum_cans",5.5),("plastic_pet",3.0),("glass_bottles",8.0),("cardboard",10.0)],"Weekly recyclables"),
            ("905 Lawrence Expy, Sunnyvale",   37.3821, -121.9945, "Wilson Residence",  "+14085550109",
             [("steel_iron",28.0),("scrap_metal_mixed",15.0),("copper_wire",1.5)],"Old BBQ + fence posts"),
            ("2244 El Camino Real, Santa Clara",37.3501,-122.0012, "Anderson Family",  "+14085550110",
             [("ewaste_noncrt",22.0),("aluminum_cans",4.0),("plastic_hdpe",2.5)],"5 old laptops"),
            ("3788 Lochinvar Ave, Santa Clara", 37.3634,-121.9667, "Martinez Family",  "+14085550111",
             [("cardboard",30.0),("aluminum_cans",6.5),("newspaper",12.0)],     "Garage cleanout"),
            ("559 Showers Dr, Mountain View",  37.3989, -122.0820, "Lee Household",     "+14085550112",
             [("copper_wire",6.0),("ewaste_noncrt",14.0),("scrap_aluminum",9.0)],"Solar wiring + servers"),
            ("1102 Saratoga Ave, San Jose",    37.3145, -121.9567, "Johnson Family",    "+14085550113",
             [("glass_bottles",22.0),("plastic_pet",5.5),("aluminum_cans",3.5)],"Very sorted already"),
            ("447 N Winchester Blvd, Santa Clara",37.3712,-121.9523,"Davis Residence", "+14085550114",
             [("ewaste_crt",52.0),("steel_iron",18.0)],                         "3 large CRT TVs. Very heavy."),
            ("2890 Moorpark Ave, San Jose",    37.3301, -121.9712, "Hernandez Family",  "+14085550115",
             [("aluminum_cans",11.0),("plastic_pet",6.0),("plastic_hdpe",4.0),("cardboard",20.0)],"Big family"),

            # Small businesses (opt-in partners). These are impact-heavy and help fill a truck quickly.
            ("2525 Augustine Dr, Santa Clara",  37.3732, -121.9828, "Mailroom Partner (Business)", "+14085550201",
             [("cardboard",320.0),("newspaper",60.0)], "Flattened boxes behind loading dock (8-11am)", "business"),
            ("3250 Scott Blvd, Santa Clara",    37.3756, -121.9727, "Cafe + Roastery (Business)", "+14085550202",
             [("cardboard",210.0),("glass_bottles",18.0)], "Back alley bins, clean/dry only", "business"),
            ("99 S Market St, San Jose",        37.3346, -121.8916, "Event Venue Cleanup (Business)", "+14085550203",
             [("aluminum_cans",18.0),("plastic_pet",10.0),("cardboard",45.0)], "Weekend event leftovers (sorted bags)", "business"),
            ("1111 Morse Ave, Sunnyvale",       37.3877, -122.0176, "Retail Stockroom (Business)", "+14085550204",
             [("cardboard",420.0),("newspaper",40.0)], "Pallet of broken-down boxes, ready to load", "business"),
            ("700 Lawrence Expy, Santa Clara",  37.3681, -121.9952, "Hardware Shop (Business)", "+14085550205",
             [("scrap_metal_mixed",35.0),("steel_iron",120.0),("cardboard",60.0)], "Old shelving + packaging (tie-down needed)", "business"),
        ]
        for item in seed_data:
            if len(item) == 8:
                addr, lat, lng, name, phone, mats, notes, kind = item
            else:
                addr, lat, lng, name, phone, mats, notes = item
                kind = "household"
            listing = Listing(
                address=addr, lat=lat, lng=lng,
                household_name=name, phone=phone, notes=notes,
                listing_kind=kind,
                materials=[Material(type=m[0], lbs=m[1]) for m in mats]
            )
            self._listings[listing.id] = listing

    def all(self, status: str = "available") -> List[Listing]:
        with self._lock:
            if status in (None, "all"):
                return list(self._listings.values())
            if status not in VALID_STATUSES:
                raise ValueError(f"Unsupported status '{status}'")
            return [l for l in self._listings.values() if l.status == status]

    def get(self, listing_id: str) -> Listing | None:
        with self._lock:
            return self._listings.get(listing_id)

    def add(self, listing: Listing) -> Listing:
        with self._lock:
            self._listings[listing.id] = listing
            return listing

    def update_status(self, listing_id: str, status: str) -> bool:
        new_status = (status or "").strip().lower()
        if new_status not in VALID_STATUSES:
            raise ValueError(f"Unsupported status '{status}'")

        with self._lock:
            listing = self._listings.get(listing_id)
            if listing is None:
                return False

            cur = listing.status
            if cur == new_status:
                return True
            allowed = STATUS_TRANSITIONS.get(cur, set())
            if new_status not in allowed:
                raise ValueError(f"Invalid status transition '{cur}' -> '{new_status}'")

            listing.status = new_status
            return True

    def claim_listing(self, listing_id: str) -> str:
        """
        Claim a listing if and only if it is currently available.
        Returns: claimed | not_found | already_claimed | already_completed
        """
        with self._lock:
            listing = self._listings.get(listing_id)
            if listing is None:
                return "not_found"
            if listing.status == "available":
                listing.status = "claimed"
                return "claimed"
            if listing.status == "claimed":
                return "already_claimed"
            return "already_completed"

    def reset_demo(self):
        """Restore deterministic demo seed inventory and statuses."""
        with self._lock:
            self._listings.clear()
            self._seed()

    def reset_all(self):
        # Backward-compatible alias used by existing route handlers.
        self.reset_demo()

    def status_counts(self) -> Dict[str, int]:
        with self._lock:
            counts = {s: 0 for s in sorted(VALID_STATUSES)}
            for listing in self._listings.values():
                if listing.status in counts:
                    counts[listing.status] += 1
            return counts

    def impact_stats(self):
        with self._lock:
            completed = [l for l in self._listings.values() if l.status == "completed"]
            total_lbs = sum(l.total_lbs for l in completed)
            counts = {s: 0 for s in sorted(VALID_STATUSES)}
            for listing in self._listings.values():
                if listing.status in counts:
                    counts[listing.status] += 1
            return {
                "completed_pickups": len(completed),
                "total_lbs_diverted": round(total_lbs, 1),
                "total_value_paid": round(sum(l.total_value for l in completed), 2),
                "co2_saved_lbs": round(total_lbs * 0.5, 1),
                "co2_saved_tons": round(total_lbs * 0.5 / 2000, 3),
                "status_counts": counts,
            }

    def health_stats(self) -> Dict[str, object]:
        counts = self.status_counts()
        total = sum(counts.values())
        return {
            "status": "ok",
            "total_listings": total,
            "seeded_listings": self._seed_count,
            "status_counts": counts,
        }
