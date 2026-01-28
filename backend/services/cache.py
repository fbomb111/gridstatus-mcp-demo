"""Simple in-memory TTL cache. No Redis needed for MVP."""

import time


class TTLCache:
    def __init__(self):
        self._store: dict[str, tuple[float, object]] = {}

    def get(self, key: str):
        if key in self._store:
            expires_at, value = self._store[key]
            if time.time() < expires_at:
                return value
            del self._store[key]
        return None

    def set(self, key: str, value: object, ttl_seconds: int = 60):
        self._store[key] = (time.time() + ttl_seconds, value)


cache = TTLCache()
