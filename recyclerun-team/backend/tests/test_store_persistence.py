import sqlite3

from backend.services.database import ListingStore


def test_listing_state_is_shared_across_store_instances(tmp_path):
    db_path = tmp_path / "store.sqlite3"
    store_a = ListingStore(str(db_path))
    store_b = ListingStore(str(db_path))

    store_a.reset_demo()
    listing_id = store_a.all("available")[0].id

    assert store_b.get(listing_id).status == "available"
    assert store_a.claim_listing(listing_id) == "claimed"
    assert store_b.get(listing_id).status == "claimed"


def test_accept_route_result_is_shared_across_store_instances(tmp_path):
    db_path = tmp_path / "store.sqlite3"
    store_a = ListingStore(str(db_path))
    store_b = ListingStore(str(db_path))

    request_id = "persisted-request-123"
    response = {
        "success": True,
        "request_id": request_id,
        "idempotent_replay": False,
        "claimed_count": 1,
    }
    store_a.save_accept_route_result(request_id, response)

    assert store_b.get_accept_route_result(request_id) == response

    updated = {**response, "idempotent_replay": True}
    store_b.save_accept_route_result(request_id, updated)
    assert store_a.get_accept_route_result(request_id) == updated


def test_reset_demo_clears_accept_route_result_cache(tmp_path):
    db_path = tmp_path / "store.sqlite3"
    store_a = ListingStore(str(db_path))
    store_b = ListingStore(str(db_path))

    request_id = "to-be-cleared"
    store_a.save_accept_route_result(request_id, {"success": True, "request_id": request_id})
    assert store_b.get_accept_route_result(request_id) is not None

    store_b.reset_demo()
    assert store_a.get_accept_route_result(request_id) is None


def test_profile_and_session_state_is_shared_across_store_instances(tmp_path):
    db_path = tmp_path / "store.sqlite3"
    store_a = ListingStore(str(db_path))
    store_b = ListingStore(str(db_path))

    profile = store_a.create_or_update_profile(
        role="giver",
        display_name="Persist User",
        email="persist-user@example.com",
        phone="+14085551212",
    )
    bundle = store_b.create_session(
        profile_id=profile["id"],
        role="giver",
        device_label="qa-device",
        session_id="sess_persist_001",
    )

    assert bundle["profile"]["id"] == profile["id"]
    assert store_a.get_session("sess_persist_001")["profile"]["display_name"] == "Persist User"

    updated = store_b.update_profile(profile["id"], display_name="Persist User Updated")
    assert updated["display_name"] == "Persist User Updated"
    assert store_a.get_profile(profile["id"])["display_name"] == "Persist User Updated"


def test_profile_schema_migration_normalizes_legacy_notnull_contacts(tmp_path):
    db_path = tmp_path / "legacy_store.sqlite3"
    conn = sqlite3.connect(db_path)
    conn.execute(
        """
        CREATE TABLE user_profiles (
            id TEXT PRIMARY KEY,
            role TEXT NOT NULL,
            display_name TEXT NOT NULL,
            email TEXT NOT NULL DEFAULT '',
            phone TEXT NOT NULL DEFAULT '',
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
    conn.execute(
        """
        INSERT INTO user_profiles (id, role, display_name, email, phone)
        VALUES ('legacy_giver', 'giver', 'Legacy Giver', '', '')
        """
    )
    conn.commit()
    conn.close()

    store = ListingStore(str(db_path))
    migrated = store.get_profile("legacy_giver")

    assert migrated is not None
    assert migrated["email"] == ""
    assert migrated["phone"] == ""

    # This would collide under legacy NOT NULL + empty-string uniqueness.
    created = store.create_or_update_profile(
        role="giver",
        display_name="New Giver",
        email="new-giver@example.com",
        phone="+14085553456",
    )
    assert created["id"] != "legacy_giver"
