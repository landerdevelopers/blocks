import type { GalleryComponent } from "@/store/authStore";

const KEY = "components_cache";
const TTL = 5 * 60 * 1000; // 5 minutes

// Returns cached components if present and fresh (< 5 min), else null.
export function readComponentsCache(): GalleryComponent[] | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const { ts, data } = JSON.parse(raw) as {
      ts: number;
      data: GalleryComponent[];
    };
    if (Date.now() - ts > TTL) return null; // expired → ignore
    return data;
  } catch {
    return null;
  }
}

export function writeComponentsCache(data: GalleryComponent[]) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(KEY, JSON.stringify({ ts: Date.now(), data }));
  } catch {
    // ignore quota / serialization errors
  }
}
