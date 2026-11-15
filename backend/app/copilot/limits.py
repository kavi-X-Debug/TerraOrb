"""A small in-memory rate limiter (sliding window) so one visitor cannot run up the cost of the language model."""
import threading
import time
from collections import defaultdict, deque


class RateLimiter:
    def __init__(self, per_client=10, per_all=120, window=60.0, clock=time.monotonic):
        self.per_client, self.per_all, self.window, self.clock = per_client, per_all, window, clock
        self._hits = defaultdict(deque)
        self._all = deque()
        self._lock = threading.Lock()

    def _trim(self, q, now):
        while q and q[0] <= now - self.window:
            q.popleft()

    def allow(self, client):
        with self._lock:
            now = self.clock()
            mine, everyone = self._hits[client], self._all
            self._trim(mine, now)
            self._trim(everyone, now)
            if len(mine) >= self.per_client or len(everyone) >= self.per_all:
                return False
            mine.append(now)
            everyone.append(now)
            if len(self._hits) > 5000:                     # forget idle clients
                for k in [k for k, v in self._hits.items() if not v]:
                    del self._hits[k]
            return True
