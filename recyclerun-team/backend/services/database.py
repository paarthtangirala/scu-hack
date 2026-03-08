"""
Persistent listing store backed by SQLite.
Owner: Soham
"""
from __future__ import annotations

import json
import os
import sqlite3
import threading
import uuid
import hashlib
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Dict, Iterable, List

from backend.models.listing import Listing
from backend.models.material import MATERIAL_RATES, Material


VALID_STATUSES = {"available", "claimed", "completed"}
PROFILE_ROLES = {"giver", "driver"}
DEFAULT_ORG_ID = "org_santa_clara_demo"
DEFAULT_ORG_NAME = "Santa Clara Diversion Pilot"
STATUS_TRANSITIONS = {
    "available": {"claimed", "completed"},
    "claimed": {"completed"},
    "completed": set(),
}

DEFAULT_PROFILE_ACTIONS: Dict[str, List[Dict[str, str]]] = {
    "giver": [
        {
            "id": "post_listing",
            "label": "Post Listing",
            "target_tab": "post",
            "icon": "hand-heart",
            "description": "Create a recyclable pickup listing quickly.",
        },
        {
            "id": "check_rates",
            "label": "Check Rates",
            "target_tab": "rates",
            "icon": "currency-usd",
            "description": "Review current payout rates by material.",
        },
        {
            "id": "view_impact",
            "label": "See Impact",
            "target_tab": "impact",
            "icon": "chart-bar-stacked",
            "description": "Track your recycling contribution.",
        },
    ],
    "driver": [
        {
            "id": "build_route",
            "label": "Build Route",
            "target_tab": "driver",
            "icon": "truck-fast",
            "description": "Build the highest-value route for your shift.",
        },
        {
            "id": "collect_now",
            "label": "Driver Dashboard",
            "target_tab": "driver",
            "icon": "map-marker-path",
            "description": "Accept route and start turn-by-turn workflow.",
        },
        {
            "id": "track_impact",
            "label": "Track Impact",
            "target_tab": "impact",
            "icon": "leaf",
            "description": "Watch lbs diverted and earnings in real time.",
        },
    ],
}


SEED_DATA = [
    ("742 Everglade Ave, Santa Clara", 37.3541, -121.9552, "Chen Family", "+14085550101",
     [("cardboard", 18), ("aluminum_cans", 3.2), ("plastic_pet", 2.1)], "Near garage door"),
    ("1208 Kiely Blvd, Santa Clara", 37.3498, -121.9621, "Rivera Household", "+14085550102",
     [("ewaste_noncrt", 8.5), ("cardboard", 12), ("scrap_aluminum", 4.0)], "Old laptop + router"),
    ("3301 Pruneridge Ave, Santa Clara", 37.3612, -121.9789, "Park Residence", "+14085550103",
     [("copper_wire", 2.5), ("scrap_metal_mixed", 11.0), ("steel_iron", 8.0)], "Old wiring + scrap"),
    ("985 Homestead Rd, Sunnyvale", 37.3688, -122.0141, "Nguyen Family", "+14085550104",
     [("aluminum_cans", 8.5), ("glass_bottles", 12.0), ("plastic_hdpe", 3.5)], "Party cleanup"),
    ("2187 Monroe St, Santa Clara", 37.3449, -121.9701, "Thompson Residence", "+14085550105",
     [("ewaste_crt", 35.0), ("ewaste_noncrt", 6.0)], "2 CRT TVs + tablets. Heavy!"),
    ("4421 Stevens Creek Blvd, San Jose", 37.3229, -121.9876, "Garcia Family", "+14085550106",
     [("cardboard", 45.0), ("newspaper", 8.0), ("plastic_pet", 4.5)], "Moving boxes"),
    ("671 Pastoria Ave, Sunnyvale", 37.3751, -122.0052, "Kim Household", "+14085550107",
     [("copper_wire", 4.2), ("scrap_aluminum", 7.5), ("ewaste_noncrt", 3.0)], "Workshop cleanout"),
    ("1833 Benton St, Santa Clara", 37.3578, -121.9834, "Patel Family", "+14085550108",
     [("aluminum_cans", 5.5), ("plastic_pet", 3.0), ("glass_bottles", 8.0), ("cardboard", 10.0)], "Weekly recyclables"),
    ("905 Lawrence Expy, Sunnyvale", 37.3821, -121.9945, "Wilson Residence", "+14085550109",
     [("steel_iron", 28.0), ("scrap_metal_mixed", 15.0), ("copper_wire", 1.5)], "Old BBQ + fence posts"),
    ("2244 El Camino Real, Santa Clara", 37.3501, -122.0012, "Anderson Family", "+14085550110",
     [("ewaste_noncrt", 22.0), ("aluminum_cans", 4.0), ("plastic_hdpe", 2.5)], "5 old laptops"),
    ("3788 Lochinvar Ave, Santa Clara", 37.3634, -121.9667, "Martinez Family", "+14085550111",
     [("cardboard", 30.0), ("aluminum_cans", 6.5), ("newspaper", 12.0)], "Garage cleanout"),
    ("559 Showers Dr, Mountain View", 37.3989, -122.0820, "Lee Household", "+14085550112",
     [("copper_wire", 6.0), ("ewaste_noncrt", 14.0), ("scrap_aluminum", 9.0)], "Solar wiring + servers"),
    ("1102 Saratoga Ave, San Jose", 37.3145, -121.9567, "Johnson Family", "+14085550113",
     [("glass_bottles", 22.0), ("plastic_pet", 5.5), ("aluminum_cans", 3.5)], "Very sorted already"),
    ("447 N Winchester Blvd, Santa Clara", 37.3712, -121.9523, "Davis Residence", "+14085550114",
     [("ewaste_crt", 52.0), ("steel_iron", 18.0)], "3 large CRT TVs. Very heavy."),
    ("2890 Moorpark Ave, San Jose", 37.3301, -121.9712, "Hernandez Family", "+14085550115",
     [("aluminum_cans", 11.0), ("plastic_pet", 6.0), ("plastic_hdpe", 4.0), ("cardboard", 20.0)], "Big family"),

    # Small businesses (opt-in partners). These are impact-heavy and help fill a truck quickly.
    ("2525 Augustine Dr, Santa Clara", 37.3732, -121.9828, "Mailroom Partner (Business)", "+14085550201",
     [("cardboard", 320.0), ("newspaper", 60.0)], "Flattened boxes behind loading dock (8-11am)", "business"),
    ("3250 Scott Blvd, Santa Clara", 37.3756, -121.9727, "Cafe + Roastery (Business)", "+14085550202",
     [("cardboard", 210.0), ("glass_bottles", 18.0)], "Back alley bins, clean/dry only", "business"),
    ("99 S Market St, San Jose", 37.3346, -121.8916, "Event Venue Cleanup (Business)", "+14085550203",
     [("aluminum_cans", 18.0), ("plastic_pet", 10.0), ("cardboard", 45.0)], "Weekend event leftovers (sorted bags)", "business"),
    ("1111 Morse Ave, Sunnyvale", 37.3877, -122.0176, "Retail Stockroom (Business)", "+14085550204",
     [("cardboard", 420.0), ("newspaper", 40.0)], "Pallet of broken-down boxes, ready to load", "business"),
    ("700 Lawrence Expy, Santa Clara", 37.3681, -121.9952, "Hardware Shop (Business)", "+14085550205",
     [("scrap_metal_mixed", 35.0), ("steel_iron", 120.0), ("cardboard", 60.0)], "Old shelving + packaging (tie-down needed)", "business"),
]


class ListingStore:
    def __init__(self, db_path: str | None = None):
        self._lock = threading.RLock()
        configured_path = db_path or os.getenv("STORE_DB_PATH", "/tmp/bin2bucks_store.sqlite3")
        normalized_path = configured_path.strip() or "/tmp/bin2bucks_store.sqlite3"
        self._db_path = Path(normalized_path)
        self._db_path.parent.mkdir(parents=True, exist_ok=True)
        self._seed_count = len(SEED_DATA)
        self._initialize_database()

    def _connect(self) -> sqlite3.Connection:
        conn = sqlite3.connect(self._db_path, timeout=10.0)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA journal_mode=WAL;")
        conn.execute("PRAGMA busy_timeout=5000;")
        return conn

    def _initialize_database(self) -> None:
        with self._lock, self._connect() as conn:
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS listings (
                    id TEXT PRIMARY KEY,
                    address TEXT NOT NULL,
                    lat REAL NOT NULL,
                    lng REAL NOT NULL,
                    household_name TEXT NOT NULL,
                    phone TEXT NOT NULL,
                    listing_kind TEXT NOT NULL DEFAULT 'household',
                    notes TEXT NOT NULL DEFAULT '',
                    materials_json TEXT NOT NULL,
                    status TEXT NOT NULL DEFAULT 'available',
                    posted_at TEXT NOT NULL,
                    photo_url TEXT
                )
                """
            )
            self._ensure_listing_columns(conn)
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS accept_route_results (
                    request_id TEXT PRIMARY KEY,
                    response_json TEXT NOT NULL,
                    created_at TEXT NOT NULL DEFAULT (datetime('now'))
                )
                """
            )
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS organizations (
                    id TEXT PRIMARY KEY,
                    name TEXT NOT NULL,
                    org_type TEXT NOT NULL DEFAULT 'city',
                    region TEXT NOT NULL DEFAULT 'Santa Clara County',
                    created_at TEXT NOT NULL DEFAULT (datetime('now'))
                )
                """
            )
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS pickup_jobs (
                    id TEXT PRIMARY KEY,
                    listing_id TEXT NOT NULL,
                    org_id TEXT NOT NULL,
                    driver_name TEXT NOT NULL,
                    eta_minutes INTEGER NOT NULL DEFAULT 0,
                    accepted_at TEXT NOT NULL,
                    completed_at TEXT,
                    status TEXT NOT NULL DEFAULT 'accepted',
                    actual_materials_json TEXT NOT NULL DEFAULT '[]',
                    actual_total_lbs REAL,
                    contamination_flags_json TEXT NOT NULL DEFAULT '[]',
                    completion_media_id TEXT NOT NULL DEFAULT '',
                    driver_lat REAL,
                    driver_lng REAL,
                    receipt_id TEXT,
                    request_id TEXT NOT NULL DEFAULT ''
                )
                """
            )
            conn.execute(
                "CREATE INDEX IF NOT EXISTS idx_pickup_jobs_listing_id ON pickup_jobs(listing_id)"
            )
            conn.execute(
                "CREATE INDEX IF NOT EXISTS idx_pickup_jobs_org_id ON pickup_jobs(org_id)"
            )
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS pickup_receipts (
                    id TEXT PRIMARY KEY,
                    pickup_job_id TEXT NOT NULL UNIQUE,
                    listing_id TEXT NOT NULL,
                    org_id TEXT NOT NULL,
                    driver_name TEXT NOT NULL,
                    household_name TEXT NOT NULL,
                    address TEXT NOT NULL,
                    listing_lat REAL NOT NULL,
                    listing_lng REAL NOT NULL,
                    capture_mode TEXT NOT NULL DEFAULT 'manual',
                    source_session_id TEXT NOT NULL DEFAULT '',
                    completion_media_id TEXT NOT NULL DEFAULT '',
                    estimated_materials_json TEXT NOT NULL,
                    actual_materials_json TEXT NOT NULL,
                    estimated_total_lbs REAL NOT NULL,
                    actual_total_lbs REAL NOT NULL,
                    estimated_confidence REAL NOT NULL DEFAULT 0,
                    variance_lbs REAL NOT NULL DEFAULT 0,
                    variance_pct REAL NOT NULL DEFAULT 0,
                    contamination_flags_json TEXT NOT NULL DEFAULT '[]',
                    created_at TEXT NOT NULL,
                    completed_at TEXT NOT NULL
                )
                """
            )
            conn.execute(
                "CREATE INDEX IF NOT EXISTS idx_pickup_receipts_org_id ON pickup_receipts(org_id)"
            )
            conn.execute(
                "CREATE INDEX IF NOT EXISTS idx_pickup_receipts_completed_at ON pickup_receipts(completed_at)"
            )
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS media_assets (
                    id TEXT PRIMARY KEY,
                    purpose TEXT NOT NULL,
                    file_name TEXT NOT NULL,
                    mime_type TEXT NOT NULL,
                    size_bytes INTEGER NOT NULL,
                    sha256 TEXT NOT NULL,
                    content_blob BLOB NOT NULL,
                    created_at TEXT NOT NULL
                )
                """
            )
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS user_profiles (
                    id TEXT PRIMARY KEY,
                    role TEXT NOT NULL,
                    display_name TEXT NOT NULL,
                    email TEXT,
                    phone TEXT,
                    onboarding_completed INTEGER NOT NULL DEFAULT 0,
                    quick_actions_json TEXT NOT NULL DEFAULT '[]',
                    created_at TEXT NOT NULL DEFAULT (datetime('now')),
                    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
                    CHECK (role IN ('giver', 'driver')),
                    UNIQUE(role, email),
                    UNIQUE(role, phone)
                )
                """
            )
            self._migrate_user_profiles_if_needed(conn)
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS user_sessions (
                    session_id TEXT PRIMARY KEY,
                    profile_id TEXT NOT NULL,
                    role TEXT NOT NULL,
                    device_label TEXT NOT NULL DEFAULT 'mobile',
                    created_at TEXT NOT NULL DEFAULT (datetime('now')),
                    last_active_at TEXT NOT NULL DEFAULT (datetime('now')),
                    CHECK (role IN ('giver', 'driver')),
                    FOREIGN KEY(profile_id) REFERENCES user_profiles(id) ON DELETE CASCADE
                )
                """
            )
            conn.execute(
                "CREATE INDEX IF NOT EXISTS idx_user_sessions_profile_id ON user_sessions(profile_id)"
            )
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS live_vision_sessions (
                    id TEXT PRIMARY KEY,
                    profile_id TEXT NOT NULL DEFAULT '',
                    provider TEXT NOT NULL DEFAULT 'gemini_live',
                    transport TEXT NOT NULL DEFAULT 'direct_websocket',
                    model TEXT NOT NULL DEFAULT '',
                    status TEXT NOT NULL DEFAULT 'issued',
                    token_expires_at TEXT NOT NULL DEFAULT '',
                    new_session_expires_at TEXT NOT NULL DEFAULT '',
                    device_label TEXT NOT NULL DEFAULT '',
                    app_version TEXT NOT NULL DEFAULT '',
                    platform TEXT NOT NULL DEFAULT '',
                    device_tier TEXT NOT NULL DEFAULT '',
                    network_type TEXT NOT NULL DEFAULT '',
                    fallback_mode TEXT NOT NULL DEFAULT '',
                    fallback_reason TEXT NOT NULL DEFAULT '',
                    confirmed_count INTEGER NOT NULL DEFAULT 0,
                    skipped_count INTEGER NOT NULL DEFAULT 0,
                    error_summary TEXT NOT NULL DEFAULT '',
                    listing_id TEXT NOT NULL DEFAULT '',
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                )
                """
            )
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS live_vision_events (
                    session_id TEXT NOT NULL,
                    event_id TEXT NOT NULL,
                    event_type TEXT NOT NULL,
                    ts_ms INTEGER NOT NULL,
                    latency_ms INTEGER,
                    candidate_id TEXT NOT NULL DEFAULT '',
                    track_id TEXT NOT NULL DEFAULT '',
                    reason TEXT NOT NULL DEFAULT '',
                    details_json TEXT NOT NULL DEFAULT '{}',
                    platform TEXT NOT NULL DEFAULT '',
                    device_tier TEXT NOT NULL DEFAULT '',
                    network_type TEXT NOT NULL DEFAULT '',
                    created_at TEXT NOT NULL,
                    PRIMARY KEY (session_id, event_id)
                )
                """
            )
            conn.execute(
                "CREATE INDEX IF NOT EXISTS idx_live_vision_events_session_id ON live_vision_events(session_id)"
            )
            self._ensure_default_organization(conn)
            current_total = conn.execute("SELECT COUNT(*) FROM listings").fetchone()[0]
            if current_total == 0:
                self._seed_into_connection(conn)

    def _migrate_user_profiles_if_needed(self, conn: sqlite3.Connection) -> None:
        columns = conn.execute("PRAGMA table_info(user_profiles)").fetchall()
        if not columns:
            return

        by_name = {row["name"]: row for row in columns}
        email_col = by_name.get("email")
        phone_col = by_name.get("phone")
        if email_col is None or phone_col is None:
            return

        # Legacy schema stored empty-string contact fields as NOT NULL values,
        # which breaks profile uniqueness across sessions.
        requires_migration = bool(email_col["notnull"]) or bool(phone_col["notnull"])
        if not requires_migration:
            return

        conn.execute("PRAGMA foreign_keys=OFF")
        try:
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS user_profiles_migrated (
                    id TEXT PRIMARY KEY,
                    role TEXT NOT NULL,
                    display_name TEXT NOT NULL,
                    email TEXT,
                    phone TEXT,
                    onboarding_completed INTEGER NOT NULL DEFAULT 0,
                    quick_actions_json TEXT NOT NULL DEFAULT '[]',
                    created_at TEXT NOT NULL DEFAULT (datetime('now')),
                    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
                    CHECK (role IN ('giver', 'driver')),
                    UNIQUE(role, email),
                    UNIQUE(role, phone)
                )
                """
            )
            conn.execute("DELETE FROM user_profiles_migrated")
            conn.execute(
                """
                INSERT INTO user_profiles_migrated (
                    id, role, display_name, email, phone,
                    onboarding_completed, quick_actions_json, created_at, updated_at
                )
                SELECT
                    id,
                    CASE
                        WHEN lower(trim(coalesce(role, ''))) IN ('giver', 'driver')
                            THEN lower(trim(role))
                        ELSE 'giver'
                    END AS role,
                    CASE
                        WHEN trim(coalesce(display_name, '')) <> ''
                            THEN trim(display_name)
                        WHEN lower(trim(coalesce(role, ''))) = 'driver'
                            THEN 'Driver'
                        ELSE 'Giver'
                    END AS display_name,
                    NULLIF(trim(coalesce(email, '')), '') AS email,
                    NULLIF(trim(coalesce(phone, '')), '') AS phone,
                    CASE WHEN coalesce(onboarding_completed, 0) = 1 THEN 1 ELSE 0 END AS onboarding_completed,
                    coalesce(NULLIF(quick_actions_json, ''), '[]') AS quick_actions_json,
                    coalesce(created_at, datetime('now')) AS created_at,
                    coalesce(updated_at, datetime('now')) AS updated_at
                FROM user_profiles
                """
            )
            conn.execute("DROP TABLE user_profiles")
            conn.execute("ALTER TABLE user_profiles_migrated RENAME TO user_profiles")
        finally:
            conn.execute("PRAGMA foreign_keys=ON")

    def _ensure_listing_columns(self, conn: sqlite3.Connection) -> None:
        columns = {row["name"] for row in conn.execute("PRAGMA table_info(listings)").fetchall()}
        migrations = {
            "capture_mode": "ALTER TABLE listings ADD COLUMN capture_mode TEXT NOT NULL DEFAULT 'manual'",
            "source_session_id": "ALTER TABLE listings ADD COLUMN source_session_id TEXT NOT NULL DEFAULT ''",
            "estimated_materials_json": "ALTER TABLE listings ADD COLUMN estimated_materials_json TEXT NOT NULL DEFAULT '[]'",
            "estimated_total_lbs": "ALTER TABLE listings ADD COLUMN estimated_total_lbs REAL NOT NULL DEFAULT 0",
            "estimated_confidence": "ALTER TABLE listings ADD COLUMN estimated_confidence REAL NOT NULL DEFAULT 0",
            "org_id": f"ALTER TABLE listings ADD COLUMN org_id TEXT NOT NULL DEFAULT '{DEFAULT_ORG_ID}'",
        }
        for column_name, statement in migrations.items():
            if column_name not in columns:
                conn.execute(statement)

    def _ensure_default_organization(self, conn: sqlite3.Connection) -> None:
        conn.execute(
            """
            INSERT INTO organizations (id, name, org_type, region)
            VALUES (?, ?, 'city', 'Santa Clara County')
            ON CONFLICT(id) DO UPDATE SET name=excluded.name
            """,
            (DEFAULT_ORG_ID, DEFAULT_ORG_NAME),
        )

    def _seed_into_connection(self, conn: sqlite3.Connection) -> None:
        for item in SEED_DATA:
            if len(item) == 8:
                addr, lat, lng, name, phone, mats, notes, kind = item
            else:
                addr, lat, lng, name, phone, mats, notes = item
                kind = "household"
            listing = Listing(
                address=addr,
                lat=lat,
                lng=lng,
                household_name=name,
                phone=phone,
                notes=notes,
                listing_kind=kind,
                materials=[Material(type=m[0], lbs=m[1]) for m in mats],
            )
            self._insert_listing(conn, listing)

    @staticmethod
    def _materials_payload(materials: Iterable[Any]) -> str:
        payload_rows: List[Dict[str, Any]] = []
        for item in materials:
            if isinstance(item, Material):
                payload_rows.append({"type": item.type, "lbs": item.lbs})
                continue
            if not isinstance(item, dict):
                continue
            m_type = str(item.get("type", "")).strip()
            try:
                lbs = round(float(item.get("lbs", item.get("weight_lbs", 0))), 1)
            except (TypeError, ValueError):
                continue
            if not m_type or lbs <= 0:
                continue
            row = {"type": m_type, "lbs": lbs}
            for key in ("count", "confidence", "weight_confidence", "weight_low", "weight_high", "provenance", "candidate_id"):
                if item.get(key) is not None:
                    row[key] = item.get(key)
            payload_rows.append(row)
        return json.dumps(payload_rows, separators=(",", ":"))

    @staticmethod
    def _material_rows_from_json(payload: str) -> List[Material]:
        materials_raw = json.loads(payload or "[]")
        materials: List[Material] = []
        for item in materials_raw:
            if not isinstance(item, dict):
                continue
            m_type = str(item.get("type", "")).strip()
            try:
                lbs = float(item.get("lbs", item.get("weight_lbs", 0)))
            except (TypeError, ValueError):
                continue
            if not m_type or lbs <= 0:
                continue
            materials.append(Material(type=m_type, lbs=round(lbs, 1)))
        return materials

    @staticmethod
    def _material_rows_to_response(materials: Iterable[Material]) -> List[Dict[str, Any]]:
        return [material.to_dict() for material in materials]

    @staticmethod
    def _estimated_rows_from_json(payload: str) -> List[Dict[str, Any]]:
        rows_raw = json.loads(payload or "[]")
        estimated_rows: List[Dict[str, Any]] = []
        for item in rows_raw:
            if not isinstance(item, dict):
                continue
            m_type = str(item.get("type", "")).strip()
            try:
                lbs = float(item.get("lbs", item.get("weight_lbs", 0)))
            except (TypeError, ValueError):
                continue
            if not m_type or lbs <= 0:
                continue
            material = Material(type=m_type, lbs=round(lbs, 1))
            row = material.to_dict()
            row["count"] = max(1, int(item.get("count", 1) or 1))
            row["confidence"] = round(float(item.get("confidence", 0.0) or 0.0), 2)
            row["weight_confidence"] = round(float(item.get("weight_confidence", row["confidence"]) or row["confidence"]), 2)
            row["weight_low"] = round(float(item.get("weight_low", material.lbs) or material.lbs), 1)
            row["weight_high"] = round(float(item.get("weight_high", material.lbs) or material.lbs), 1)
            row["provenance"] = str(item.get("provenance", "") or "").strip()
            row["candidate_id"] = str(item.get("candidate_id", "") or "").strip()
            estimated_rows.append(row)
        return estimated_rows

    @staticmethod
    def _estimated_rows_to_response(materials: Iterable[Dict[str, Any]]) -> List[Dict[str, Any]]:
        return [dict(material) for material in materials]

    @staticmethod
    def _sum_material_lbs(materials: Iterable[Any]) -> float:
        total = 0.0
        for material in materials:
            if isinstance(material, Material):
                total += material.lbs
                continue
            if isinstance(material, dict):
                try:
                    total += float(material.get("lbs", material.get("weight_lbs", 0)) or 0)
                except (TypeError, ValueError):
                    continue
        return round(total, 1)

    @staticmethod
    def _sum_material_value(materials: Iterable[Material]) -> float:
        return round(sum(material.value for material in materials), 2)

    @staticmethod
    def _parse_iso8601(value: str) -> datetime:
        raw = str(value or "").strip()
        if raw.endswith("Z"):
            raw = raw[:-1] + "+00:00"
        dt = datetime.fromisoformat(raw)
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt

    @staticmethod
    def _now_iso() -> str:
        return datetime.now(timezone.utc).isoformat()

    def _insert_listing(self, conn: sqlite3.Connection, listing: Listing) -> None:
        estimated_materials = listing.estimated_materials or list(listing.materials)
        estimated_total_lbs = listing.estimated_total_lbs or self._sum_material_lbs(estimated_materials)
        conn.execute(
            """
            INSERT INTO listings (
                id, address, lat, lng, household_name, phone, listing_kind, notes,
                materials_json, status, posted_at, photo_url, capture_mode,
                source_session_id, estimated_materials_json, estimated_total_lbs,
                estimated_confidence, org_id
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                listing.id,
                listing.address,
                listing.lat,
                listing.lng,
                listing.household_name,
                listing.phone,
                listing.listing_kind,
                listing.notes,
                self._materials_payload(listing.materials),
                listing.status,
                listing.posted_at,
                listing.photo_url,
                listing.capture_mode,
                listing.source_session_id,
                self._materials_payload(estimated_materials),
                estimated_total_lbs,
                round(float(listing.estimated_confidence or 0.0), 2),
                listing.org_id or DEFAULT_ORG_ID,
            ),
        )

    @staticmethod
    def _row_to_listing(row: sqlite3.Row) -> Listing:
        materials = ListingStore._material_rows_from_json(row["materials_json"] or "[]")
        estimated_materials = ListingStore._estimated_rows_from_json(row["estimated_materials_json"] or "[]")

        listing = Listing(
            address=row["address"],
            lat=float(row["lat"]),
            lng=float(row["lng"]),
            household_name=row["household_name"],
            phone=row["phone"],
            listing_kind=row["listing_kind"] or "household",
            materials=materials,
            estimated_materials=estimated_materials or list(materials),
            notes=row["notes"] or "",
            capture_mode=row["capture_mode"] or "manual",
            source_session_id=row["source_session_id"] or "",
            estimated_total_lbs=float(row["estimated_total_lbs"] or 0),
            estimated_confidence=float(row["estimated_confidence"] or 0),
            org_id=row["org_id"] or DEFAULT_ORG_ID,
        )
        listing.id = row["id"]
        listing.status = row["status"]
        listing.posted_at = row["posted_at"]
        listing.photo_url = row["photo_url"]
        return listing

    @staticmethod
    def _normalize_role(role: str) -> str:
        normalized = str(role or "").strip().lower()
        aliases = {"user": "giver", "household": "giver", "collector": "driver"}
        return aliases.get(normalized, normalized)

    @staticmethod
    def _normalize_email(email: str) -> str:
        return str(email or "").strip().lower()

    @staticmethod
    def _normalize_phone(phone: str) -> str:
        return str(phone or "").strip()

    @staticmethod
    def _safe_display_name(display_name: str, role: str) -> str:
        value = str(display_name or "").strip()
        if value:
            return value
        return "Giver" if role == "giver" else "Driver"

    @staticmethod
    def _profile_actions_for_role(role: str) -> List[Dict[str, str]]:
        actions = DEFAULT_PROFILE_ACTIONS.get(role) or DEFAULT_PROFILE_ACTIONS["giver"]
        return [dict(item) for item in actions]

    def _row_to_profile(self, row: sqlite3.Row) -> Dict[str, Any]:
        quick_actions_raw = row["quick_actions_json"] or "[]"
        try:
            quick_actions = json.loads(quick_actions_raw)
            if not isinstance(quick_actions, list):
                quick_actions = self._profile_actions_for_role(row["role"])
        except json.JSONDecodeError:
            quick_actions = self._profile_actions_for_role(row["role"])
        return {
            "id": row["id"],
            "role": row["role"],
            "display_name": row["display_name"],
            "email": row["email"] or "",
            "phone": row["phone"] or "",
            "onboarding_completed": bool(row["onboarding_completed"]),
            "quick_actions": quick_actions,
            "created_at": row["created_at"],
            "updated_at": row["updated_at"],
            "last_session_at": row["last_session_at"],
        }

    def _get_profile_row(self, conn: sqlite3.Connection, profile_id: str) -> sqlite3.Row | None:
        return conn.execute(
            """
            SELECT
                p.*,
                (
                    SELECT MAX(s.last_active_at)
                    FROM user_sessions s
                    WHERE s.profile_id = p.id
                ) AS last_session_at
            FROM user_profiles p
            WHERE p.id = ?
            """,
            (profile_id,),
        ).fetchone()

    def _get_session_bundle(
        self, conn: sqlite3.Connection, session_id: str
    ) -> Dict[str, Any] | None:
        row = conn.execute(
            """
            SELECT session_id, profile_id, role, device_label, created_at, last_active_at
            FROM user_sessions
            WHERE session_id = ?
            """,
            (session_id,),
        ).fetchone()
        if row is None:
            return None

        profile_row = self._get_profile_row(conn, row["profile_id"])
        if profile_row is None:
            return None

        session_payload = {
            "session_id": row["session_id"],
            "profile_id": row["profile_id"],
            "role": row["role"],
            "device_label": row["device_label"],
            "created_at": row["created_at"],
            "last_active_at": row["last_active_at"],
        }
        return {"session": session_payload, "profile": self._row_to_profile(profile_row)}

    def all(self, status: str = "available") -> List[Listing]:
        normalized_status = (status or "available").strip().lower()
        if normalized_status not in VALID_STATUSES and normalized_status != "all":
            raise ValueError(f"Unsupported status '{status}'")

        with self._lock, self._connect() as conn:
            if normalized_status == "all":
                rows = conn.execute("SELECT * FROM listings ORDER BY posted_at ASC, id ASC").fetchall()
            else:
                rows = conn.execute(
                    "SELECT * FROM listings WHERE status = ? ORDER BY posted_at ASC, id ASC",
                    (normalized_status,),
                ).fetchall()
            return [self._row_to_listing(row) for row in rows]

    def get(self, listing_id: str) -> Listing | None:
        with self._lock, self._connect() as conn:
            row = conn.execute("SELECT * FROM listings WHERE id = ?", (listing_id,)).fetchone()
            if row is None:
                return None
            return self._row_to_listing(row)

    def add(self, listing: Listing) -> Listing:
        with self._lock, self._connect() as conn:
            self._insert_listing(conn, listing)
            return listing

    def update_status(self, listing_id: str, status: str) -> bool:
        new_status = (status or "").strip().lower()
        if new_status not in VALID_STATUSES:
            raise ValueError(f"Unsupported status '{status}'")

        with self._lock, self._connect() as conn:
            row = conn.execute("SELECT status FROM listings WHERE id = ?", (listing_id,)).fetchone()
            if row is None:
                return False

            cur = row["status"]
            if cur == new_status:
                return True

            allowed = STATUS_TRANSITIONS.get(cur, set())
            if new_status not in allowed:
                raise ValueError(f"Invalid status transition '{cur}' -> '{new_status}'")

            conn.execute("UPDATE listings SET status = ? WHERE id = ?", (new_status, listing_id))
            return True

    def claim_listing(self, listing_id: str) -> str:
        """
        Claim a listing if and only if it is currently available.
        Returns: claimed | not_found | already_claimed | already_completed
        """
        with self._lock, self._connect() as conn:
            cursor = conn.execute(
                "UPDATE listings SET status = 'claimed' WHERE id = ? AND status = 'available'",
                (listing_id,),
            )
            if cursor.rowcount == 1:
                return "claimed"

            row = conn.execute("SELECT status FROM listings WHERE id = ?", (listing_id,)).fetchone()
            if row is None:
                return "not_found"
            if row["status"] == "claimed":
                return "already_claimed"
            return "already_completed"

    def _row_to_pickup_job(self, row: sqlite3.Row) -> Dict[str, Any]:
        return {
            "pickup_job_id": row["id"],
            "listing_id": row["listing_id"],
            "org_id": row["org_id"],
            "driver_name": row["driver_name"],
            "eta_minutes": int(row["eta_minutes"] or 0),
            "accepted_at": row["accepted_at"],
            "completed_at": row["completed_at"],
            "status": row["status"],
            "completion_media_id": row["completion_media_id"] or "",
            "contamination_flags": json.loads(row["contamination_flags_json"] or "[]"),
            "actual_total_lbs": float(row["actual_total_lbs"] or 0),
            "receipt_id": row["receipt_id"] or "",
            "request_id": row["request_id"] or "",
        }

    def _row_to_media_asset(self, row: sqlite3.Row, *, include_bytes: bool = False) -> Dict[str, Any]:
        payload = {
            "media_id": row["id"],
            "purpose": row["purpose"],
            "file_name": row["file_name"],
            "mime_type": row["mime_type"],
            "size_bytes": int(row["size_bytes"] or 0),
            "sha256": row["sha256"],
            "created_at": row["created_at"],
        }
        if include_bytes:
            payload["content_bytes"] = bytes(row["content_blob"] or b"")
        return payload

    def _row_to_receipt(self, row: sqlite3.Row) -> Dict[str, Any]:
        estimated_materials = self._estimated_rows_from_json(row["estimated_materials_json"] or "[]")
        actual_materials = self._material_rows_from_json(row["actual_materials_json"] or "[]")
        return {
            "receipt_id": row["id"],
            "pickup_job_id": row["pickup_job_id"],
            "listing_id": row["listing_id"],
            "org_id": row["org_id"],
            "driver_name": row["driver_name"],
            "household_name": row["household_name"],
            "address": row["address"],
            "lat": float(row["listing_lat"]),
            "lng": float(row["listing_lng"]),
            "capture_mode": row["capture_mode"],
            "source_session_id": row["source_session_id"] or "",
            "completion_media_id": row["completion_media_id"] or "",
            "estimated_materials": self._estimated_rows_to_response(estimated_materials),
            "actual_materials": self._material_rows_to_response(actual_materials),
            "estimated_total_lbs": round(float(row["estimated_total_lbs"] or 0), 1),
            "actual_total_lbs": round(float(row["actual_total_lbs"] or 0), 1),
            "estimated_confidence": round(float(row["estimated_confidence"] or 0), 2),
            "variance_lbs": round(float(row["variance_lbs"] or 0), 1),
            "variance_pct": round(float(row["variance_pct"] or 0), 1),
            "contamination_flags": json.loads(row["contamination_flags_json"] or "[]"),
            "created_at": row["created_at"],
            "completed_at": row["completed_at"],
            "actual_total_value": self._sum_material_value(actual_materials),
        }

    def create_pickup_job(
        self,
        *,
        listing_id: str,
        driver_name: str,
        eta_minutes: int,
        request_id: str = "",
    ) -> Dict[str, Any]:
        with self._lock, self._connect() as conn:
            listing_row = conn.execute("SELECT * FROM listings WHERE id = ?", (listing_id,)).fetchone()
            if listing_row is None:
                raise ValueError("Listing not found")
            listing = self._row_to_listing(listing_row)
            job_id = f"pickup_{uuid.uuid4().hex[:12]}"
            accepted_at = self._now_iso()
            conn.execute(
                """
                INSERT INTO pickup_jobs (
                    id, listing_id, org_id, driver_name, eta_minutes,
                    accepted_at, status, request_id
                ) VALUES (?, ?, ?, ?, ?, ?, 'accepted', ?)
                """,
                (
                    job_id,
                    listing.id,
                    listing.org_id or DEFAULT_ORG_ID,
                    driver_name,
                    int(eta_minutes),
                    accepted_at,
                    request_id,
                ),
            )
            row = conn.execute("SELECT * FROM pickup_jobs WHERE id = ?", (job_id,)).fetchone()
            return self._row_to_pickup_job(row)

    def get_pickup_job(self, pickup_id: str) -> Dict[str, Any] | None:
        with self._lock, self._connect() as conn:
            row = conn.execute("SELECT * FROM pickup_jobs WHERE id = ?", (pickup_id,)).fetchone()
            if row is None:
                return None
            return self._row_to_pickup_job(row)

    def complete_pickup_job(
        self,
        pickup_id: str,
        *,
        actual_materials: List[Material],
        actual_total_lbs: float,
        contamination_flags: List[str],
        completion_media_id: str,
        completed_at: str,
        driver_lat: float | None,
        driver_lng: float | None,
    ) -> Dict[str, Any] | None:
        with self._lock, self._connect() as conn:
            job_row = conn.execute("SELECT * FROM pickup_jobs WHERE id = ?", (pickup_id,)).fetchone()
            if job_row is None:
                return None
            if job_row["status"] == "completed" and str(job_row["receipt_id"] or "").strip():
                receipt_row = conn.execute(
                    "SELECT * FROM pickup_receipts WHERE id = ?",
                    (job_row["receipt_id"],),
                ).fetchone()
                if receipt_row is not None:
                    return self._row_to_receipt(receipt_row)

            listing_row = conn.execute("SELECT * FROM listings WHERE id = ?", (job_row["listing_id"],)).fetchone()
            if listing_row is None:
                return None
            listing = self._row_to_listing(listing_row)
            completed_ts = completed_at or self._now_iso()
            estimated_materials = listing.estimated_materials or list(listing.materials)
            estimated_total_lbs = listing.estimated_total_lbs or self._sum_material_lbs(estimated_materials)
            actual_total = round(float(actual_total_lbs), 1)
            variance_lbs = round(actual_total - estimated_total_lbs, 1)
            variance_pct = round((variance_lbs / estimated_total_lbs) * 100, 1) if estimated_total_lbs > 0 else 0.0
            receipt_id = job_row["receipt_id"] or f"receipt_{uuid.uuid4().hex[:12]}"
            created_at = self._now_iso()

            conn.execute(
                """
                INSERT INTO pickup_receipts (
                    id, pickup_job_id, listing_id, org_id, driver_name, household_name,
                    address, listing_lat, listing_lng, capture_mode, source_session_id,
                    completion_media_id, estimated_materials_json, actual_materials_json,
                    estimated_total_lbs, actual_total_lbs, estimated_confidence,
                    variance_lbs, variance_pct, contamination_flags_json, created_at, completed_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(pickup_job_id) DO UPDATE SET
                    completion_media_id=excluded.completion_media_id,
                    actual_materials_json=excluded.actual_materials_json,
                    actual_total_lbs=excluded.actual_total_lbs,
                    variance_lbs=excluded.variance_lbs,
                    variance_pct=excluded.variance_pct,
                    contamination_flags_json=excluded.contamination_flags_json,
                    completed_at=excluded.completed_at
                """,
                (
                    receipt_id,
                    pickup_id,
                    listing.id,
                    listing.org_id or DEFAULT_ORG_ID,
                    job_row["driver_name"],
                    listing.household_name,
                    listing.address,
                    listing.lat,
                    listing.lng,
                    listing.capture_mode,
                    listing.source_session_id,
                    completion_media_id,
                    self._materials_payload(estimated_materials),
                    self._materials_payload(actual_materials),
                    estimated_total_lbs,
                    actual_total,
                    round(float(listing.estimated_confidence or 0.0), 2),
                    variance_lbs,
                    variance_pct,
                    json.dumps(contamination_flags, separators=(",", ":")),
                    created_at,
                    completed_ts,
                ),
            )
            conn.execute(
                """
                UPDATE pickup_jobs
                SET status = 'completed',
                    completed_at = ?,
                    actual_materials_json = ?,
                    actual_total_lbs = ?,
                    contamination_flags_json = ?,
                    completion_media_id = ?,
                    driver_lat = ?,
                    driver_lng = ?,
                    receipt_id = ?
                WHERE id = ?
                """,
                (
                    completed_ts,
                    self._materials_payload(actual_materials),
                    actual_total,
                    json.dumps(contamination_flags, separators=(",", ":")),
                    completion_media_id,
                    driver_lat,
                    driver_lng,
                    receipt_id,
                    pickup_id,
                ),
            )
            conn.execute("UPDATE listings SET status = 'completed' WHERE id = ?", (listing.id,))
            receipt_row = conn.execute("SELECT * FROM pickup_receipts WHERE id = ?", (receipt_id,)).fetchone()
            return self._row_to_receipt(receipt_row)

    def get_receipt(self, receipt_id: str) -> Dict[str, Any] | None:
        with self._lock, self._connect() as conn:
            row = conn.execute("SELECT * FROM pickup_receipts WHERE id = ?", (receipt_id,)).fetchone()
            if row is None:
                return None
            return self._row_to_receipt(row)

    def create_media_asset(
        self,
        *,
        purpose: str,
        file_name: str,
        mime_type: str,
        content_bytes: bytes,
    ) -> Dict[str, Any]:
        media_id = f"media_{uuid.uuid4().hex[:16]}"
        created_at = self._now_iso()
        blob = bytes(content_bytes or b"")
        sha256 = hashlib.sha256(blob).hexdigest()
        with self._lock, self._connect() as conn:
            conn.execute(
                """
                INSERT INTO media_assets (
                    id, purpose, file_name, mime_type, size_bytes, sha256, content_blob, created_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    media_id,
                    purpose,
                    file_name,
                    mime_type,
                    len(blob),
                    sha256,
                    sqlite3.Binary(blob),
                    created_at,
                ),
            )
            row = conn.execute("SELECT * FROM media_assets WHERE id = ?", (media_id,)).fetchone()
            return self._row_to_media_asset(row)

    def get_media_asset(self, media_id: str, *, include_bytes: bool = False) -> Dict[str, Any] | None:
        with self._lock, self._connect() as conn:
            columns = "*" if include_bytes else "id, purpose, file_name, mime_type, size_bytes, sha256, created_at"
            row = conn.execute(
                f"SELECT {columns} FROM media_assets WHERE id = ?",
                (media_id,),
            ).fetchone()
            if row is None:
                return None
            return self._row_to_media_asset(row, include_bytes=include_bytes)

    @staticmethod
    def _dashboard_since(window: str) -> datetime | None:
        now = datetime.now(timezone.utc)
        if window == "7d":
            return now - timedelta(days=7)
        if window == "30d":
            return now - timedelta(days=30)
        if window == "90d":
            return now - timedelta(days=90)
        return None

    def org_dashboard(self, org_id: str, *, window: str = "30d") -> Dict[str, Any]:
        with self._lock, self._connect() as conn:
            org_row = conn.execute("SELECT * FROM organizations WHERE id = ?", (org_id,)).fetchone()
            if org_row is None:
                raise ValueError("Organization not found")

            receipt_rows = conn.execute(
                "SELECT * FROM pickup_receipts WHERE org_id = ? ORDER BY completed_at DESC",
                (org_id,),
            ).fetchall()
            receipts = [self._row_to_receipt(row) for row in receipt_rows]
            since = self._dashboard_since(window)
            if since is not None:
                receipts = [
                    receipt
                    for receipt in receipts
                    if self._parse_iso8601(receipt["completed_at"]) >= since
                ]

            total_receipts = len(receipts)
            total_lbs = round(sum(receipt["actual_total_lbs"] for receipt in receipts), 1)
            total_value = round(sum(receipt["actual_total_value"] for receipt in receipts), 2)
            contaminated = [receipt for receipt in receipts if receipt["contamination_flags"]]
            mean_variance = round(
                sum(abs(receipt["variance_lbs"]) for receipt in receipts) / total_receipts,
                1,
            ) if total_receipts else 0.0
            mean_confidence = round(
                sum(receipt["estimated_confidence"] for receipt in receipts) / total_receipts,
                2,
            ) if total_receipts else 0.0

            pickup_times: List[float] = []
            for receipt in receipts:
                listing_row = conn.execute(
                    "SELECT posted_at FROM listings WHERE id = ?",
                    (receipt["listing_id"],),
                ).fetchone()
                if listing_row is None:
                    continue
                try:
                    posted_at = self._parse_iso8601(listing_row["posted_at"])
                    completed_at = self._parse_iso8601(receipt["completed_at"])
                except Exception:
                    continue
                pickup_times.append(round((completed_at - posted_at).total_seconds() / 60, 1))

            hotspots = [
                {
                    "receipt_id": receipt["receipt_id"],
                    "lat": receipt["lat"],
                    "lng": receipt["lng"],
                    "household_name": receipt["household_name"],
                    "actual_total_lbs": receipt["actual_total_lbs"],
                    "completed_at": receipt["completed_at"],
                }
                for receipt in receipts[:8]
            ]

            material_mix: Dict[str, Dict[str, Any]] = {}
            for receipt in receipts:
                for material in receipt["actual_materials"]:
                    material_type = str(material.get("type", "")).strip()
                    if not material_type:
                        continue
                    current = material_mix.setdefault(
                        material_type,
                        {
                            "type": material_type,
                            "label": material.get("label") or MATERIAL_RATES.get(material_type, {}).get("label") or material_type,
                            "emoji": material.get("emoji") or MATERIAL_RATES.get(material_type, {}).get("emoji") or "♻️",
                            "total_lbs": 0.0,
                            "total_value": 0.0,
                            "pickup_count": 0,
                        },
                    )
                    current["total_lbs"] = round(current["total_lbs"] + float(material.get("lbs", 0) or 0), 1)
                    current["total_value"] = round(current["total_value"] + float(material.get("value", 0) or 0), 2)
                    current["pickup_count"] += 1

            material_mix_rows = sorted(
                material_mix.values(),
                key=lambda row: (-float(row["total_lbs"]), row["type"]),
            )

            return {
                "success": True,
                "org": {
                    "id": org_row["id"],
                    "name": org_row["name"],
                    "org_type": org_row["org_type"],
                    "region": org_row["region"],
                },
                "window": window,
                "summary": {
                    "completed_pickups": total_receipts,
                    "completion_rate": 1.0 if total_receipts else 0.0,
                    "total_lbs_diverted": total_lbs,
                    "total_value_paid": total_value,
                    "contamination_rate": round(len(contaminated) / total_receipts, 2) if total_receipts else 0.0,
                    "mean_pickup_time_minutes": round(sum(pickup_times) / len(pickup_times), 1) if pickup_times else 0.0,
                    "mean_estimated_confidence": mean_confidence,
                    "mean_variance_lbs": mean_variance,
                },
                "receipt_count": total_receipts,
                "material_mix": material_mix_rows,
                "hotspots": hotspots,
                "latest_receipts": receipts[:5],
                "all_receipts": receipts,
                "export_links": {
                    "json": f"/api/orgs/{org_id}/dashboard?window={window}",
                    "csv": f"/api/orgs/{org_id}/dashboard?window={window}&format=csv",
                },
            }

    def create_live_vision_session(
        self,
        session_id: str,
        *,
        profile_id: str = "",
        provider: str = "gemini_live",
        transport: str = "direct_websocket",
        model: str = "",
        token_expires_at: str = "",
        new_session_expires_at: str = "",
        device_label: str = "",
        app_version: str = "",
        platform: str = "",
        device_tier: str = "",
        network_type: str = "",
    ) -> Dict[str, Any]:
        now = self._now_iso()
        with self._lock, self._connect() as conn:
            conn.execute(
                """
                INSERT OR REPLACE INTO live_vision_sessions (
                    id, profile_id, provider, transport, model, status,
                    token_expires_at, new_session_expires_at, device_label, app_version,
                    platform, device_tier, network_type, created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, 'issued', ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    session_id[:80],
                    profile_id[:80],
                    provider[:40],
                    transport[:40],
                    model[:120],
                    token_expires_at[:40],
                    new_session_expires_at[:40],
                    device_label[:80],
                    app_version[:40],
                    platform[:40],
                    device_tier[:40],
                    network_type[:40],
                    now,
                    now,
                ),
            )
        return self.get_live_vision_session(session_id)

    def get_live_vision_session(self, session_id: str) -> Dict[str, Any] | None:
        with self._lock, self._connect() as conn:
            row = conn.execute(
                """
                SELECT
                    id, profile_id, provider, transport, model, status,
                    token_expires_at, new_session_expires_at, device_label, app_version,
                    platform, device_tier, network_type, fallback_mode, fallback_reason,
                    confirmed_count, skipped_count, error_summary, listing_id,
                    created_at, updated_at
                FROM live_vision_sessions
                WHERE id = ?
                """,
                (session_id[:80],),
            ).fetchone()
            if row is None:
                return None
            return {
                "session_id": row["id"],
                "profile_id": row["profile_id"] or "",
                "provider": row["provider"] or "gemini_live",
                "transport": row["transport"] or "direct_websocket",
                "model": row["model"] or "",
                "status": row["status"] or "issued",
                "token_expires_at": row["token_expires_at"] or "",
                "new_session_expires_at": row["new_session_expires_at"] or "",
                "device_label": row["device_label"] or "",
                "app_version": row["app_version"] or "",
                "platform": row["platform"] or "",
                "device_tier": row["device_tier"] or "",
                "network_type": row["network_type"] or "",
                "fallback_mode": row["fallback_mode"] or "",
                "fallback_reason": row["fallback_reason"] or "",
                "confirmed_count": int(row["confirmed_count"] or 0),
                "skipped_count": int(row["skipped_count"] or 0),
                "error_summary": row["error_summary"] or "",
                "listing_id": row["listing_id"] or "",
                "created_at": row["created_at"] or "",
                "updated_at": row["updated_at"] or "",
            }

    def record_live_vision_events(self, session_id: str, events: Iterable[Dict[str, Any]]) -> int:
        rows = list(events or [])
        if not rows:
            return 0
        now = self._now_iso()
        inserted = 0
        with self._lock, self._connect() as conn:
            for event in rows:
                event_id = str(event.get("event_id", "") or "").strip()
                event_type = str(event.get("event_type", "") or "").strip()
                if not event_id or not event_type:
                    continue
                details = event.get("details", {})
                if not isinstance(details, dict):
                    details = {"value": details}
                for key in (
                    "device_model",
                    "os_version",
                    "transport_mode",
                    "preview_fps_p50",
                    "preview_fps_p95",
                    "detector_ms_p50",
                    "detector_ms_p95",
                    "stable_candidate_ms_p50",
                    "stable_candidate_ms_p95",
                    "gemini_rtt_ms_p50",
                    "gemini_rtt_ms_p95",
                    "resume_count",
                    "fallback_reason",
                ):
                    if event.get(key) is not None and key not in details:
                        details[key] = event.get(key)
                conn.execute(
                    """
                    INSERT OR REPLACE INTO live_vision_events (
                        session_id, event_id, event_type, ts_ms, latency_ms, candidate_id,
                        track_id, reason, details_json, platform, device_tier, network_type, created_at
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        session_id[:80],
                        event_id[:80],
                        event_type[:80],
                        int(event.get("ts_ms") or 0),
                        int(event["latency_ms"]) if event.get("latency_ms") is not None else None,
                        str(event.get("candidate_id", "") or "")[:80],
                        str(event.get("track_id", "") or "")[:80],
                        str(event.get("reason", "") or "")[:160],
                        json.dumps(details, separators=(",", ":"), sort_keys=True),
                        str(event.get("platform", "") or "")[:40],
                        str(event.get("device_tier", "") or "")[:40],
                        str(event.get("network_type", "") or "")[:40],
                        now,
                    ),
                )
                inserted += 1
            conn.execute(
                "UPDATE live_vision_sessions SET status = ?, updated_at = ? WHERE id = ?",
                ("streaming", now, session_id[:80]),
            )
        return inserted

    def finish_live_vision_session(
        self,
        session_id: str,
        *,
        confirmed_count: int = 0,
        skipped_count: int = 0,
        fallback_mode: str = "",
        error_summary: str = "",
        listing_id: str = "",
    ) -> Dict[str, Any] | None:
        now = self._now_iso()
        with self._lock, self._connect() as conn:
            conn.execute(
                """
                UPDATE live_vision_sessions
                SET
                    status = 'closed',
                    confirmed_count = ?,
                    skipped_count = ?,
                    fallback_mode = ?,
                    error_summary = ?,
                    listing_id = CASE WHEN ? <> '' THEN ? ELSE listing_id END,
                    updated_at = ?
                WHERE id = ?
                """,
                (
                    max(0, int(confirmed_count)),
                    max(0, int(skipped_count)),
                    fallback_mode[:80],
                    error_summary[:400],
                    listing_id[:80],
                    listing_id[:80],
                    now,
                    session_id[:80],
                ),
            )
        return self.get_live_vision_session(session_id)

    def link_live_vision_session(self, session_id: str, listing_id: str) -> None:
        if not session_id or not listing_id:
            return
        with self._lock, self._connect() as conn:
            conn.execute(
                """
                UPDATE live_vision_sessions
                SET listing_id = ?, updated_at = ?
                WHERE id = ?
                """,
                (listing_id[:80], self._now_iso(), session_id[:80]),
            )

    def reset_demo(self):
        """Restore deterministic demo seed inventory and statuses."""
        with self._lock, self._connect() as conn:
            conn.execute("DELETE FROM live_vision_events")
            conn.execute("DELETE FROM live_vision_sessions")
            conn.execute("DELETE FROM media_assets")
            conn.execute("DELETE FROM pickup_receipts")
            conn.execute("DELETE FROM pickup_jobs")
            conn.execute("DELETE FROM accept_route_results")
            conn.execute("DELETE FROM listings")
            self._seed_into_connection(conn)

    def reset_all(self):
        # Backward-compatible alias used by existing route handlers.
        self.reset_demo()

    def status_counts(self) -> Dict[str, int]:
        with self._lock, self._connect() as conn:
            rows = conn.execute(
                "SELECT status, COUNT(*) AS total FROM listings GROUP BY status"
            ).fetchall()
            counts = {s: 0 for s in sorted(VALID_STATUSES)}
            for row in rows:
                status = row["status"]
                if status in counts:
                    counts[status] = int(row["total"])
            return counts

    def impact_stats(self):
        completed = self.all("completed")
        total_lbs = sum(l.total_lbs for l in completed)
        counts = self.status_counts()
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

    def create_or_update_profile(
        self,
        *,
        role: str,
        display_name: str,
        email: str,
        phone: str,
    ) -> Dict[str, Any]:
        normalized_role = self._normalize_role(role)
        if normalized_role not in PROFILE_ROLES:
            raise ValueError(f"Unsupported role '{role}'")

        normalized_email = self._normalize_email(email)
        normalized_phone = self._normalize_phone(phone)
        if not normalized_email and not normalized_phone:
            raise ValueError("Either email or phone is required")

        safe_name = self._safe_display_name(display_name, normalized_role)

        with self._lock, self._connect() as conn:
            existing_row = None
            if normalized_email:
                existing_row = conn.execute(
                    "SELECT id FROM user_profiles WHERE role = ? AND email = ?",
                    (normalized_role, normalized_email),
                ).fetchone()
            if existing_row is None and normalized_phone:
                existing_row = conn.execute(
                    "SELECT id FROM user_profiles WHERE role = ? AND phone = ?",
                    (normalized_role, normalized_phone),
                ).fetchone()

            if existing_row is None:
                profile_id = f"profile_{uuid.uuid4().hex[:12]}"
                try:
                    conn.execute(
                        """
                        INSERT INTO user_profiles (
                            id, role, display_name, email, phone, onboarding_completed, quick_actions_json
                        ) VALUES (?, ?, ?, ?, ?, 0, ?)
                        """,
                        (
                            profile_id,
                            normalized_role,
                            safe_name,
                            normalized_email or None,
                            normalized_phone or None,
                            json.dumps(
                                self._profile_actions_for_role(normalized_role),
                                separators=(",", ":"),
                            ),
                        ),
                    )
                except sqlite3.IntegrityError as exc:
                    raise ValueError("Profile already exists for this role and contact") from exc
            else:
                profile_id = existing_row["id"]
                row = conn.execute(
                    "SELECT display_name, email, phone, quick_actions_json FROM user_profiles WHERE id = ?",
                    (profile_id,),
                ).fetchone()
                next_name = safe_name or row["display_name"]
                next_email = normalized_email or (row["email"] or None)
                next_phone = normalized_phone or (row["phone"] or None)
                next_quick_actions = row["quick_actions_json"] or json.dumps(
                    self._profile_actions_for_role(normalized_role),
                    separators=(",", ":"),
                )
                try:
                    conn.execute(
                        """
                        UPDATE user_profiles
                        SET display_name = ?, email = ?, phone = ?, quick_actions_json = ?, updated_at = datetime('now')
                        WHERE id = ?
                        """,
                        (next_name, next_email, next_phone, next_quick_actions, profile_id),
                    )
                except sqlite3.IntegrityError as exc:
                    raise ValueError("Another profile already uses this role/contact") from exc

            profile_row = self._get_profile_row(conn, profile_id)
            if profile_row is None:
                raise ValueError("Profile lookup failed after create/update")
            return self._row_to_profile(profile_row)

    def get_profile(self, profile_id: str) -> Dict[str, Any] | None:
        with self._lock, self._connect() as conn:
            row = self._get_profile_row(conn, profile_id)
            if row is None:
                return None
            return self._row_to_profile(row)

    def update_profile(
        self,
        profile_id: str,
        *,
        display_name: str | None = None,
        email: str | None = None,
        phone: str | None = None,
    ) -> Dict[str, Any] | None:
        with self._lock, self._connect() as conn:
            current = conn.execute(
                "SELECT id, role, display_name, email, phone FROM user_profiles WHERE id = ?",
                (profile_id,),
            ).fetchone()
            if current is None:
                return None

            next_name = current["display_name"] if display_name is None else self._safe_display_name(display_name, current["role"])
            next_email = current["email"] if email is None else (self._normalize_email(email) or None)
            next_phone = current["phone"] if phone is None else (self._normalize_phone(phone) or None)
            if not next_email and not next_phone:
                raise ValueError("Either email or phone must remain set")

            try:
                conn.execute(
                    """
                    UPDATE user_profiles
                    SET display_name = ?, email = ?, phone = ?, updated_at = datetime('now')
                    WHERE id = ?
                    """,
                    (next_name, next_email, next_phone, profile_id),
                )
            except sqlite3.IntegrityError as exc:
                raise ValueError("Another profile already uses this role/contact") from exc

            row = self._get_profile_row(conn, profile_id)
            if row is None:
                return None
            return self._row_to_profile(row)

    def mark_onboarding_complete(self, profile_id: str) -> Dict[str, Any] | None:
        with self._lock, self._connect() as conn:
            cursor = conn.execute(
                """
                UPDATE user_profiles
                SET onboarding_completed = 1, updated_at = datetime('now')
                WHERE id = ?
                """,
                (profile_id,),
            )
            if cursor.rowcount == 0:
                return None
            row = self._get_profile_row(conn, profile_id)
            if row is None:
                return None
            return self._row_to_profile(row)

    def create_session(
        self,
        *,
        profile_id: str,
        role: str,
        device_label: str = "mobile",
        session_id: str | None = None,
    ) -> Dict[str, Any]:
        normalized_role = self._normalize_role(role)
        if normalized_role not in PROFILE_ROLES:
            raise ValueError(f"Unsupported role '{role}'")

        safe_device_label = str(device_label or "mobile").strip()[:80] or "mobile"
        safe_session_id = str(session_id or "").strip()
        if not safe_session_id:
            safe_session_id = f"sess_{uuid.uuid4().hex[:14]}"

        with self._lock, self._connect() as conn:
            profile_row = conn.execute(
                "SELECT id FROM user_profiles WHERE id = ?",
                (profile_id,),
            ).fetchone()
            if profile_row is None:
                raise ValueError("Profile does not exist")

            conn.execute(
                """
                INSERT INTO user_sessions (session_id, profile_id, role, device_label)
                VALUES (?, ?, ?, ?)
                ON CONFLICT(session_id) DO UPDATE SET
                    profile_id = excluded.profile_id,
                    role = excluded.role,
                    device_label = excluded.device_label,
                    last_active_at = datetime('now')
                """,
                (safe_session_id, profile_id, normalized_role, safe_device_label),
            )
            conn.execute(
                "UPDATE user_profiles SET updated_at = datetime('now') WHERE id = ?",
                (profile_id,),
            )
            bundle = self._get_session_bundle(conn, safe_session_id)
            if bundle is None:
                raise ValueError("Session lookup failed after create")
            return bundle

    def touch_session(self, session_id: str) -> bool:
        with self._lock, self._connect() as conn:
            cursor = conn.execute(
                "UPDATE user_sessions SET last_active_at = datetime('now') WHERE session_id = ?",
                (session_id,),
            )
            return cursor.rowcount > 0

    def get_session(self, session_id: str) -> Dict[str, Any] | None:
        with self._lock, self._connect() as conn:
            return self._get_session_bundle(conn, session_id)

    def end_session(self, session_id: str) -> bool:
        with self._lock, self._connect() as conn:
            cursor = conn.execute(
                "DELETE FROM user_sessions WHERE session_id = ?",
                (session_id,),
            )
            return cursor.rowcount > 0

    def get_accept_route_result(self, request_id: str) -> Dict[str, object] | None:
        with self._lock, self._connect() as conn:
            row = conn.execute(
                "SELECT response_json FROM accept_route_results WHERE request_id = ?",
                (request_id,),
            ).fetchone()
            if row is None:
                return None
            return json.loads(row["response_json"])

    def save_accept_route_result(self, request_id: str, response: Dict[str, object]) -> None:
        with self._lock, self._connect() as conn:
            conn.execute(
                """
                INSERT INTO accept_route_results (request_id, response_json)
                VALUES (?, ?)
                ON CONFLICT(request_id) DO UPDATE SET response_json=excluded.response_json
                """,
                (request_id, json.dumps(response, separators=(",", ":"))),
            )
