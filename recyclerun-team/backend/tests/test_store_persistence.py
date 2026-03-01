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
