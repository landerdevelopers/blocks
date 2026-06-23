import type { GalleryComponent } from "@/store/authStore";

// Bumped to v4 — the main gallery query no longer selects `colors` (the grid
// never rendered swatches; color search uses its own pool), so the cached row
// shape changed. v3 added uploaded_by / created_at / copy_count for the
// lightbox; dropping a stale cache just forces one clean refetch.
const KEY = "components_cache_v4";
const TTL = 5 * 60 * 1000; // 5 minutes

// Cache is keyed by category slug ("website", "logos", …) because pagination is
// category-scoped — each category's first page is cached independently so
// switching between categories paints instantly with no skeletons.
type Entry = { ts: number; data: GalleryComponent[]; total: number };
type CacheMap = Record<string, Entry>;

function readMap(): CacheMap {
  if (typeof window === "undefined") return {};
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && !("data" in parsed)) {
      return parsed as CacheMap;
    }
    return {};
  } catch {
    return {};
  }
}

// Returns this category's cached first page (data + total published count) if
// present, fresh (< 5 min) and non-empty. An empty array is treated as a miss
// so it can't suppress skeletons or flash "No blocks" before the fetch lands.
export function readComponentsCache(
  category: string,
): { data: GalleryComponent[]; total: number } | null {
  const entry = readMap()[category];
  if (!entry) return null;
  if (Date.now() - entry.ts > TTL) return null; // expired → ignore
  if (!entry.data.length) return null; // empty → treat as miss
  return { data: entry.data, total: entry.total ?? entry.data.length };
}

export function writeComponentsCache(
  category: string,
  data: GalleryComponent[],
  total?: number,
) {
  if (typeof window === "undefined") return;
  const entry: Entry = {
    ts: Date.now(),
    data,
    total: total ?? data.length,
  };
  try {
    const map = readMap();
    map[category] = entry;
    localStorage.setItem(KEY, JSON.stringify(map));
  } catch {
    // Quota exceeded — drop every other category and keep just this one.
    try {
      localStorage.setItem(KEY, JSON.stringify({ [category]: entry }));
    } catch {
      // still too big — give up silently
    }
  }
}
