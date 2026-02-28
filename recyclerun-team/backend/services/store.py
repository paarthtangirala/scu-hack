"""
Shared in-memory store instance for all blueprints.

Without this module, each route file creates its own ListingStore and
API state diverges across endpoints in the same process.
"""
from backend.services.database import ListingStore

store = ListingStore()

