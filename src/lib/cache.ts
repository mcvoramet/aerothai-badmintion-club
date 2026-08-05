// Tiny localStorage cache backing the stale-while-revalidate pattern: render
// last-known data instantly, then refresh in the background. Every Apps Script
// call costs ~1s of platform overhead, so showing cached data first is what
// makes the app feel immediate.
//
// Bump VERSION whenever a cached payload's shape changes, so old entries are
// ignored rather than deserialised into something the UI can't render.
const VERSION = 'v1';
const PREFIX = `aerothai:${VERSION}:`;

export function readCache<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(PREFIX + key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null; // private mode, corrupt JSON — treat as a miss
  }
}

export function writeCache<T>(key: string, value: T): void {
  try {
    localStorage.setItem(PREFIX + key, JSON.stringify(value));
  } catch {
    // quota exceeded or storage unavailable — caching is an optimisation only
  }
}
