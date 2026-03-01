"""
Shared in-memory store instance for all blueprints.

All API routes should import this singleton so listing state remains
consistent across endpoints in the same process.
"""
from backend.services.database import ListingStore

store = ListingStore()
