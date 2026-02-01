"""Simple in-memory TTL cache. No Redis needed for MVP.

Note: Each uvicorn worker has its own cache instance. With --workers 2,
data may be fetched twice (once per worker). This is acceptable for this
project's scale — the cache still eliminates repeated calls within the
same worker.
"""

import time
from typing import Any


class TTLCache:
    def __init__(self):
        self._store: dict[str, tuple[float, Any]] = {}

    def get(self, key: str) -> Any | None:
        if key in self._store:
            expires_at, value = self._store[key]
            if time.time() < expires_at:
                return value
            del self._store[key]
        return None

    def set(self, key: str, value: Any, ttl_seconds: int = 60) -> None:
        self._store[key] = (time.time() + ttl_seconds, value)


cache = TTLCache()
