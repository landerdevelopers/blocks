"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent,
} from "react";
import { createPortal } from "react-dom";
import { Megaphone, Pencil, Trash2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { useAuthStore, type GalleryComponent } from "@/store/authStore";
import {
  readComponentsCache,
  writeComponentsCache,
} from "@/lib/componentsCache";
import { cloudflareThumb } from "@/lib/utils";
type Component = GalleryComponent;

const PAGE_SIZE = 24;

// Deterministic varying heights for initial-load skeletons (Pinterest/Cosmos
// look). Deterministic — not Math.random() — so SSR and client agree (no
// hydration mismatch). Returned value is a height ratio used directly as
// paddingBottom (e.g. 1.2 → 120%).
const SKELETON_HEIGHTS = [0.6, 0.75, 0.85, 1.0, 1.2, 1.4, 1.6, 1.8];

function getSkeletonRatio(colIndex: number, cardIndex: number): number {
  return SKELETON_HEIGHTS[
    (colIndex * 3 + cardIndex * 7) % SKELETON_HEIGHTS.length
  ];
}

// Sidebar section id -> public.components.category value.
const CAT_MAP: Record<string, string> = {
  website: "Website",
  mobile: "Mobile Apps",
  dashboard: "Dashboard",
  logos: "Logos",
  illustrations: "Illustrations",
};

const LETTERS = Array.from({ length: 26 }, (_, i) =>
  String.fromCharCode(65 + i),
);

// "Copy to Figma" button spec per layout (column count).
const BTN: Record<
  number,
  {
    w: number;
    h: number;
    cw: number;
    ch: number;
    r: number;
    img: number;
    fs: number;
    gap: string;
    pos: "tr" | "b";
  }
> = {
  1: { w: 230, h: 52, cw: 291, ch: 52, r: 16, img: 32, fs: 24.14, gap: "gap-2.5", pos: "tr" },
  2: { w: 190, h: 45, cw: 240, ch: 44, r: 14, img: 26, fs: 20, gap: "gap-2", pos: "b" },
  3: { w: 155, h: 37, cw: 196, ch: 36, r: 12, img: 22, fs: 16, gap: "gap-2", pos: "b" },
  4: { w: 140, h: 33, cw: 177, ch: 33, r: 10, img: 20, fs: 15, gap: "gap-1.5", pos: "b" },
  5: { w: 126, h: 30, cw: 159, ch: 30, r: 8, img: 18, fs: 14, gap: "gap-1.5", pos: "b" },
  6: { w: 112, h: 28, cw: 142, ch: 28, r: 8, img: 16, fs: 13, gap: "gap-1", pos: "b" },
};

const KBOX: Record<number, { box: number; icon: number }> = {
  1: { box: 40, icon: 20 },
  2: { box: 36, icon: 18 },
  3: { box: 30, icon: 16 },
  4: { box: 28, icon: 15 },
  5: { box: 26, icon: 14 },
  6: { box: 24, icon: 13 },
};

export default function Gallery({
  cols = 3,
  loggedIn,
  onRequireLogin,
  onCopy,
  category = null,
  filters = [],
  colorSearchActive = false,
  colorSearchLoading = false,
  colorSearchResults = null,
  colorSearchHasMore = false,
  onColorSearchLoadMore,
}: {
  cols?: number;
  loggedIn: boolean;
  onRequireLogin: () => void;
  onCopy: (componentId: string) => boolean | Promise<boolean>;
  category?: string | null;
  filters?: string[];
  colorSearchActive?: boolean;
  colorSearchLoading?: boolean;
  colorSearchResults?: Component[] | null;
  colorSearchHasMore?: boolean;
  onColorSearchLoadMore?: () => void;
}) {
  const isAdmin = useAuthStore((s) => s.isAdmin);
  const authLoading = useAuthStore((s) => s.authLoading);
  // Shared list in the store so new uploads appear instantly (no refetch).
  const components = useAuthStore((s) => s.components);
  const removeComponent = useAuthStore((s) => s.removeComponent);
  const componentsLoaded = useAuthStore((s) => s.componentsLoaded);
  const setComponents = useAuthStore((s) => s.setComponents);
  const clearComponents = useAuthStore((s) => s.clearComponents);
  const setCurrentCategory = useAuthStore((s) => s.setCurrentCategory);
  const categoryCounts = useAuthStore((s) => s.categoryCounts);
  const setCategoryCounts = useAuthStore((s) => s.setCategoryCounts);
  // Pagination state + setters (transient store fields).
  const hasMore = useAuthStore((s) => s.hasMore);
  const currentPage = useAuthStore((s) => s.currentPage);
  const isFetching = useAuthStore((s) => s.isFetching);
  const isFetchingMore = useAuthStore((s) => s.isFetchingMore);
  const setHasMore = useAuthStore((s) => s.setHasMore);
  const setCurrentPage = useAuthStore((s) => s.setCurrentPage);
  const setIsFetching = useAuthStore((s) => s.setIsFetching);
  const setIsFetchingMore = useAuthStore((s) => s.setIsFetchingMore);
  const appendComponents = useAuthStore((s) => s.appendComponents);

  // `firstSkeletonRef` is the FIRST skeleton card (or its fallback) — the normal
  // observer watches it directly. `colorSentinelRef` drives color-search paging.
  // `scrollRef` is the scroll container (used to check if content fills it).
  const firstSkeletonRef = useRef<HTMLDivElement>(null);
  const colorSentinelRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLElement>(null);
  // Synchronous lock so a second click can't start a copy mid-flight, plus an
  // AbortController to cancel any in-flight figma_data fetch.
  const copyLockRef = useRef(false);
  const abortRef = useRef<AbortController | null>(null);

  // The store is seeded from this category's cache in the mount/category effect
  // below (not during render — that would setState mid-render and update other
  // subscribers like AuthProvider). The `mounted` gate shows a skeleton on the
  // first paint, so there's no blank frame while that effect runs.

  // Category used for FILTERING the on-screen list. It lags `category` by one
  // render on a switch: the effect below updates it only AFTER the store has
  // been reset (cleared or cache-seeded), so the filter never runs the old
  // components against the new category (which would flash "No blocks").
  const [displayCategory, setDisplayCategory] = useState(category);

  // Fetch one page of the ACTIVE category. The query is category-scoped so each
  // page is PAGE_SIZE cards of the category being viewed (not 24 spread across
  // every category). Page 0 replaces the list (and writes the cache); later
  // pages append and do not touch the cache.
  const fetchPage = useCallback(
    async (page: number) => {
      setIsFetching(true);
      setIsFetchingMore(page > 0);
      const from = page * PAGE_SIZE;
      const to = from + PAGE_SIZE - 1;
      const dbCat = category ? CAT_MAP[category] : null;
      let query = createClient()
        .from("components")
        .select(
          "id, category, section, filters, figma_url, preview_url, aspect_ratio, colors",
        )
        .eq("is_published", true);
      if (dbCat) query = query.eq("category", dbCat);
      const { data, error } = await query
        .order("created_at", { ascending: false })
        .range(from, to);
      if (error) {
        console.error("[gallery] fetchPage:", error.message);
        setIsFetching(false);
        setIsFetchingMore(false);
        return;
      }
      const fresh = (data as Component[]) ?? [];
      if (fresh.length < PAGE_SIZE) setHasMore(false);
      if (page === 0) {
        setComponents(fresh);
        // Cache page 0 under THIS page's own category (stable closure value) —
        // not a global — so overlapping fetches across switches never mis-key.
        // Pass the known total so the cache can drive skeleton slots on refresh.
        const dbCat = category ? CAT_MAP[category] : null;
        const total = dbCat
          ? useAuthStore.getState().categoryCounts[dbCat]
          : undefined;
        writeComponentsCache(category ?? "website", fresh, total);
      } else {
        appendComponents(fresh);
      }
      setCurrentPage(page);
      setIsFetching(false);
      setIsFetchingMore(false);
    },
    [
      category,
      setComponents,
      appendComponents,
      setHasMore,
      setCurrentPage,
      setIsFetching,
      setIsFetchingMore,
    ],
  );

  // On mount and whenever the category changes: reset pagination, then either
  // seed from this category's fresh (< 5 min) cache (instant, no skeletons) or
  // clear to skeletons, flip the filter category, and fetch page 0.
  useEffect(() => {
    const cat = category ?? "website";
    setCurrentCategory(cat);
    setHasMore(true);
    setCurrentPage(0);
    const cached = readComponentsCache(cat);
    if (cached) {
      setComponents(cached.data); // instant display from this category's cache
      if (cached.total) setCategoryCounts({ [CAT_MAP[cat]]: cached.total });
    } else {
      clearComponents(); // empty + loaded=false → skeletons, never stale data
    }
    // Update the filter category only AFTER the store has been reset, so the
    // list and the filter always agree (no old-components/new-category render).
    setDisplayCategory(category);
    fetchPage(0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [category]);

  // Total published counts per category — drives the skeleton slots beyond the
  // loaded page. Deferred ~2s after mount so these 4 count(*) queries don't
  // compete with the critical page-0 fetch (which puts the images in the DOM).
  useEffect(() => {
    let alive = true;
    const fetchAllCounts = async () => {
      const cats = [
        "Website",
        "Mobile Apps",
        "Dashboard",
        "Logos",
        "Illustrations",
      ];
      const results = await Promise.all(
        cats.map((cat) =>
          createClient()
            .from("components")
            .select("*", { count: "exact", head: true })
            .eq("category", cat)
            .eq("is_published", true),
        ),
      );
      if (!alive) return;
      const counts: Record<string, number> = {};
      cats.forEach((cat, i) => {
        counts[cat] = results[i].count ?? 0;
      });
      setCategoryCounts(counts);
    };
    const timer = setTimeout(fetchAllCounts, 2000);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [setCategoryCounts]);

  // Preload the copied-state icon so the figma→tick swap doesn't flash/break.
  useEffect(() => {
    const img = new Image();
    img.src = "/Tick.png";
  }, []);

  // The real grid depends on client-only inputs (`cols` from localStorage, the
  // cache, the counts), so its first render can't match the server. Gate it
  // behind `mounted` and render a deterministic skeleton until then — see the
  // early return below.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const dbCategory = displayCategory ? CAT_MAP[displayCategory] : null;
  const isLogos = dbCategory === "Logos";

  // Apply category + filter selection.
  const filtered = useMemo(() => {
    return components.filter((c) => {
      if (dbCategory && c.category !== dbCategory) return false;
      if (filters.length) {
        if (dbCategory === "Logos") {
          // Letters are a union — show a component matching any selected letter.
          if (!filters.some((f) => (c.filters ?? []).includes(f))) return false;
        } else {
          // Two groups, AND'd together. Tags (no prefix) match the section and
          // are a union among themselves. Themes ("style:" prefix) narrow the
          // result, also a union. Pick "Hero", "Bento" + "Dark" → section is
          // Hero OR Bento, AND a Dark theme.
          const tags = filters.filter((f) => !f.startsWith("style:"));
          const themes = filters
            .filter((f) => f.startsWith("style:"))
            .map((f) => f.slice("style:".length));
          if (tags.length && !tags.includes(c.section ?? "")) return false;
          if (
            themes.length &&
            !themes.some((t) => (c.filters ?? []).includes(t))
          )
            return false;
        }
      }
      return true;
    });
  }, [components, dbCategory, filters]);

  // Skeleton modes. initial = first load / switch to an uncached category (no
  // data yet) → varying-height skeletons. load-more = a page > 0 fetch in
  // flight → skeletons sized from the last page. A page-0 background refresh
  // over cached data shows neither (the cache is already on screen).
  // Initial = nothing loaded yet for this category (cold load, or a switch to an
  // uncached category). Covers the first render too — before the fetch effect
  // flips isFetching — via !componentsLoaded, so skeletons show with no blank.
  const isInitialLoad =
    (isFetching || !componentsLoaded) && components.length === 0;
  const showSkeletons = isInitialLoad || isFetchingMore;

  const cfg = BTN[Math.min(6, Math.max(1, cols))] ?? BTN[3];

  // Hover overlay behind the copy button. The 1-col layout shows the button at
  // the top, every other layout at the bottom — so flip the gradient to match.
  const overlayCls = `pointer-events-none absolute inset-x-0 z-5 h-24 opacity-0 transition-opacity duration-300 group-hover:opacity-100 ${
    cfg.pos === "tr"
      ? "top-0 bg-linear-to-b from-black/70 to-transparent"
      : "bottom-0 bg-linear-to-t from-black/70 to-transparent"
  }`;

  // Infinite scroll for the normal gallery — load the next page when the
  // sentinel nears the bottom. Disabled while color search is active (color
  // search paginates separately). Observes the FIRST skeleton card directly —
  // the moment it scrolls into view (10% visible) the next page is fetched.
  // No explicit root: the default (viewport) still accounts for clipping by the
  // scrollable <main>, so it works regardless of layout / column count.
  useEffect(() => {
    const el = firstSkeletonRef.current;
    if (!el || !hasMore || isFetching || colorSearchActive) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) {
          fetchPage(currentPage + 1);
        }
      },
      { threshold: 0.1 },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [
    hasMore,
    isFetching,
    currentPage,
    colorSearchActive,
    components.length,
    categoryCounts,
    fetchPage,
  ]);

  // After a page loads, if the content doesn't fill the scroll container (so the
  // user can't scroll to reveal the next sentinel), fetch the next page eagerly
  // until it's scrollable or there's nothing more.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || !hasMore || isFetching || colorSearchActive) return;
    if (el.scrollHeight <= el.clientHeight) {
      fetchPage(currentPage + 1);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [components.length, hasMore, isFetching, currentPage, colorSearchActive]);

  // Infinite scroll for color search — reveal the next slice of RPC results.
  useEffect(() => {
    const el = colorSentinelRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (
          entries[0].isIntersecting &&
          colorSearchHasMore &&
          !colorSearchLoading
        ) {
          onColorSearchLoadMore?.();
        }
      },
      { root: scrollRef.current, rootMargin: "200px" },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [
    colorSearchActive,
    colorSearchHasMore,
    colorSearchLoading,
    colorSearchResults,
    onColorSearchLoadMore,
  ]);

  const [copied, setCopied] = useState<string | null>(null);
  // Id whose figma_data is being fetched on copy → shows a spinner on its button.
  const [copying, setCopying] = useState<string | null>(null);
  // Admin delete: id awaiting confirmation in the modal (null = closed).
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const doDelete = async () => {
    if (!confirmDelete) return;
    setDeleting(true);
    const { error } = await createClient()
      .from("components")
      .delete()
      .eq("id", confirmDelete);
    setDeleting(false);
    if (error) {
      console.error("[delete] component:", error.message);
      return;
    }
    removeComponent(confirmDelete);
    setConfirmDelete(null);
  };

  // Delete confirmation modal — portal'd so it overlays everything.
  const renderDeleteModal = () =>
    confirmDelete && typeof document !== "undefined"
      ? createPortal(
          <div
            onClick={() => !deleting && setConfirmDelete(null)}
            className="fixed inset-0 z-[1000] flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm"
          >
            <div
              onClick={(e) => e.stopPropagation()}
              className="flex w-[360px] flex-col gap-2 rounded-2xl bg-white p-6 shadow-[0px_12px_40px_rgba(0,0,0,0.2)]"
            >
              <h2 className="text-[18px] font-semibold tracking-[-0.03em] text-[#09090b]">
                Are you sure?
              </h2>
              <p className="text-[14px] leading-5 tracking-[-0.03em] text-[#71717b]">
                This will permanently delete this component. This action cannot
                be undone.
              </p>
              <div className="mt-3 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setConfirmDelete(null)}
                  disabled={deleting}
                  className="cursor-pointer rounded-lg border border-[#e4e4e7] px-3.5 py-2 text-[14px] font-medium tracking-[-0.03em] text-[#52525b] transition-colors hover:bg-[#fafafa] disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={doDelete}
                  disabled={deleting}
                  className="cursor-pointer rounded-lg bg-[#ef4444] px-3.5 py-2 text-[14px] font-medium tracking-[-0.03em] text-white transition-colors hover:bg-[#dc2626] disabled:opacity-50"
                >
                  {deleting ? "Deleting…" : "Delete"}
                </button>
              </div>
            </div>
          </div>,
          document.body,
        )
      : null;
  // Ids whose preview image has finished loading — drives the placeholder fade.
  const [loadedIds, setLoadedIds] = useState<Set<string>>(new Set());
  const markLoaded = (id: string) =>
    setLoadedIds((prev) => new Set(prev).add(id));
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const markCopied = (key: string) => {
    if (timer.current) clearTimeout(timer.current);
    setCopied(key);
  };
  const resetAfterLeave = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopied(null), 320);
  };

  // Lightbox.
  const [lightbox, setLightbox] = useState<
    { src: string; logo: boolean } | null
  >(null);
  useEffect(() => {
    if (!lightbox) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setLightbox(null);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [lightbox]);

  // Admin controls — Edit + Delete, shown on hover. Slide in from the top.
  // Positions computed in px from the box size so the two buttons never overlap.
  const adminButtons = (id: string, dark = false) => {
    if (!isAdmin) return null;
    const k = KBOX[Math.min(6, Math.max(1, cols))] ?? KBOX[3];
    const pad = cols === 1 ? 20 : 12; // inset from the edge
    const gap = 10; // space between the two buttons
    const sideKey = cols === 1 ? "left" : "right";
    const base = `absolute z-30 flex cursor-pointer items-center justify-center rounded-full border opacity-0 shadow-[0px_2px_6px_rgba(0,0,0,0.15)] transition-[opacity,translate] duration-300 ease-out -translate-y-[calc(100%+0.75rem)] pointer-events-none group-hover:pointer-events-auto group-hover:translate-y-0 group-hover:opacity-100`;
    const tone = dark
      ? "border-black bg-black text-white"
      : "border-[#e7e9ee] bg-white text-[#52525b]";
    return (
      <>
        {/* Edit */}
        <button
          type="button"
          aria-label="Edit component"
          onClick={(e) => {
            e.stopPropagation();
            window.open(`/upload/${id}/edit`, "_blank");
          }}
          style={{ width: k.box, height: k.box, top: pad, [sideKey]: pad }}
          className={`${base} ${tone}`}
        >
          <Pencil size={k.icon} strokeWidth={2} />
        </button>

        {/* Delete — opens the confirmation modal. */}
        <button
          type="button"
          aria-label="Delete component"
          onClick={(e) => {
            e.stopPropagation();
            setConfirmDelete(id);
          }}
          style={{
            width: k.box,
            height: k.box,
            top: pad,
            [sideKey]: pad + k.box + gap,
          }}
          className={`${base} ${tone} hover:text-[#ef4444]`}
        >
          <Trash2 size={k.icon} strokeWidth={2} />
        </button>
      </>
    );
  };

  // Copy button — shared by both views; `dark` for the logo cards. Two stacked
  // pills anchored at the same spot: on copy the "Copy to Figma" pill slides
  // down + fades out while the "Copied!" pill rises up into its place.
  const copyButton = (id: string, dark: boolean, figmaUrl: string | null) => {
    const isCopied = copied === id;
    const isCopying = copying === id;
    const onClick = async (e: MouseEvent) => {
      e.stopPropagation(); // don't trigger the image lightbox
      console.log("copy clicked", id);
      if (authLoading) return; // wait for the session to resolve
      if (!loggedIn) return onRequireLogin();
      // Synchronous, immediate lock — set before any await so no second click
      // can pass regardless of React's flush timing.
      if (copyLockRef.current) return;
      copyLockRef.current = true;
      console.log("lock passed, fetching figma_data");
      setCopying(id);
      // Cancel any in-flight figma_data fetch before starting a new one.
      if (abortRef.current) abortRef.current.abort();
      abortRef.current = new AbortController();
      try {
        // Limit check + the (large) figma_data fetch run in parallel to keep the
        // gap before the clipboard write short. figma_data is fetched lazily here
        // so it never bloats the gallery list/cache.
        const [allowed, res] = await Promise.all([
          onCopy(id),
          createClient()
            .from("components")
            .select("figma_data")
            .eq("id", id)
            .abortSignal(abortRef.current.signal)
            .single(),
        ]);
        console.log("figma_data fetched", !!res.data?.figma_data);
        if (!allowed) return; // limit reached / not allowed → no copy, no "Copied"
        const figmaData =
          (res.data as { figma_data: string | null } | null)?.figma_data ?? null;
        try {
          if (figmaData) {
            // Real Figma clipboard payload — write via execCommand so no browser
            // permission popup is triggered. Paste recreates the component.
            const htmlData = figmaData;
            const listener = (ev: ClipboardEvent) => {
              ev.clipboardData?.setData("text/html", htmlData);
              ev.preventDefault();
            };
            document.addEventListener("copy", listener);
            console.log("writing to clipboard");
            document.execCommand("copy");
            document.removeEventListener("copy", listener);
            console.log("clipboard write done");
          } else if (figmaUrl) {
            console.log("writing to clipboard");
            await navigator.clipboard.writeText(figmaUrl);
            console.log("clipboard write done");
          }
        } catch (err) {
          // clipboard may be blocked; still show the copied state
          console.log("copy error", err);
        }
        markCopied(id);
      } finally {
        copyLockRef.current = false;
        setCopying(null);
      }
    };

    const pill =
      "flex items-center justify-center whitespace-nowrap border font-medium tracking-[-0.03em] shadow-[0px_4px_12px_rgba(0,0,0,0.12)] transition-[opacity,transform] duration-300 ease-out";

    return (
      // Wrapper: positioned per layout + slides in on card hover.
      <div
        className={`pointer-events-none absolute z-10 opacity-0 transition-[opacity,translate] duration-300 ease-out group-hover:opacity-100 ${
          cfg.pos === "tr"
            ? "right-6 top-6 -translate-y-[calc(100%+1.5rem)] group-hover:translate-y-0"
            : `${
                // Logos (dark) at layout 4/5/6 sit a little lower in the card.
                dark && cols >= 4 ? "bottom-3" : "bottom-6"
              } left-1/2 -translate-x-1/2 translate-y-[calc(100%+1.5rem)] group-hover:translate-y-0`
        }`}
      >
        <div className="relative">
          {/* Copy pill — in flow, sizes the wrapper. Slides down + out on copy. */}
          <button
            type="button"
            onClick={onClick}
            style={{
              width: cfg.w,
              height: cfg.h,
              borderRadius: cfg.r,
              fontSize: cfg.fs,
              transform: isCopied ? "translateY(14px)" : "translateY(0)",
              opacity: isCopied ? 0 : undefined,
            }}
            className={`${pill} ${cfg.gap} cursor-pointer hover:opacity-90 ${
              isCopied ? "pointer-events-none" : "group-hover:pointer-events-auto"
            } ${dark ? "border-black bg-black text-white" : "border-[#e7e9ee] bg-white text-[#09090b]"}`}
          >
            {authLoading ? (
              <>
                <span
                  className="animate-spin rounded-full border-2 border-current border-t-transparent opacity-70"
                  style={{ width: cfg.img, height: cfg.img }}
                />
                Loading…
              </>
            ) : isCopying ? (
              // Fetching figma_data for this card → spinner only.
              <span
                className="animate-spin rounded-full border-2 border-current border-t-transparent opacity-70"
                style={{ width: cfg.img, height: cfg.img }}
              />
            ) : (
              <>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img alt="" src="/figma.png" style={{ width: cfg.img, height: cfg.img }} />
                Copy to Figma
              </>
            )}
          </button>

          {/* Copied pill — absolutely centered over the copy pill. Rises up + in. */}
          <div
            aria-hidden={!isCopied}
            style={{
              width: cfg.cw,
              height: cfg.ch,
              borderRadius: cfg.r,
              fontSize: cfg.fs,
              backgroundColor: "#deffd7",
              color: "#1C9A00",
              borderColor: "#BAFFAA",
              top: "50%",
              left: "50%",
              transform: `translate(-50%, ${isCopied ? "-50%" : "calc(-50% + 14px)"})`,
              opacity: isCopied ? 1 : 0,
            }}
            className={`${pill} ${cfg.gap} pointer-events-none absolute`}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img alt="" src="/Tick.png" style={{ width: cfg.img, height: cfg.img }} />
            {cols >= 5 ? "Copied!" : "Copied Successfully!"}
          </div>
        </div>
      </div>
    );
  };

  // Announcement banner — sits at the top of the gallery content and scrolls
  // away with it (not pinned).
  const banner = (
    <div className="mb-3.5 shrink-0">
      <div className="flex h-[34px] w-fit max-w-full items-center gap-2 rounded-[10px] border border-[#e7e9ee] bg-[#F0F1F2] px-2.5 py-2">
        <Megaphone
          size={16}
          strokeWidth={1.5}
          className="shrink-0 text-[#4D4D4D]"
        />
        <span className="truncate text-[14px] tracking-[-0.03em] text-[#4D4D4D]">
          We&apos;re constantly adding new designs, so come back often to explore
          fresh resources 😉
        </span>
      </div>
    </div>
  );

  // End-of-list marker — shown once every page is loaded (hasMore === false).
  // Two small squares flank the label, with gradient lines fading outward.
  const endReached = !hasMore && !isFetching && filtered.length > 0;
  const endMarker = (
    <div className="flex shrink-0 items-center justify-center px-4 pt-10 pb-24">
      <div className="h-0 w-[88px] border-t border-solid [border-image:linear-gradient(to_left,#E7E9EE,transparent)_1]" />
      <div className="size-2.5 shrink-0 rounded-[2px] border border-[#E7E9EE] bg-white" />
      <span className="whitespace-nowrap capitalize px-2.5 text-[18px] tracking-[-0.03em] text-[#71717b]">
        More coming soon
      </span>
      <div className="size-2.5 shrink-0 rounded-[2px] border border-[#E7E9EE] bg-white" />
      <div className="h-0 w-[88px] border-t border-solid [border-image:linear-gradient(to_right,#E7E9EE,transparent)_1]" />
    </div>
  );

  const renderLightbox = () =>
    lightbox && typeof document !== "undefined"
      ? createPortal(
          <div
            onClick={() => setLightbox(null)}
            className="fixed inset-0 z-[1000] flex items-center justify-center bg-black/80 p-8 backdrop-blur-sm"
          >
            <div
              onClick={(e) => e.stopPropagation()}
              className="relative inline-block"
            >
              <button
                type="button"
                onClick={() => setLightbox(null)}
                aria-label="Close"
                className="absolute right-3 top-3 z-10 flex size-9 cursor-pointer items-center justify-center rounded-full border border-white/15 bg-black/40 text-white backdrop-blur-md transition-colors hover:bg-black/60"
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
                  <line x1="6" y1="6" x2="18" y2="18" />
                  <line x1="18" y1="6" x2="6" y2="18" />
                </svg>
              </button>
              {lightbox.logo ? (
                // Fixed square box so every logo opens at the same size (no
                // per-logo sizing or blank-then-resize jump).
                <div className="flex size-[min(90vw,520px)] items-center justify-center rounded-xl bg-white p-16 shadow-[0px_12px_40px_rgba(0,0,0,0.4)]">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img alt="" src={lightbox.src} className="size-full object-contain" />
                </div>
              ) : (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  alt=""
                  src={lightbox.src}
                  className="block max-h-[85vh] max-w-[90vw] rounded-xl object-contain shadow-[0px_12px_40px_rgba(0,0,0,0.4)]"
                />
              )}
            </div>
          </div>,
          document.body,
        )
      : null;

  // Reusable masonry grid for a given component list.
  const renderGrid = (list: Component[]) => {
    const buckets: Component[][] = Array.from(
      { length: Math.max(1, cols) },
      () => [],
    );
    list.forEach((c, i) => buckets[i % buckets.length].push(c));
    return (
      <main ref={scrollRef} suppressHydrationWarning className="flex min-h-0 flex-1 flex-col overflow-y-auto bg-white p-4">
        {banner}
        <div className="flex flex-1 items-start gap-3.5">
        {buckets.map((col, i) => (
          <div key={i} className="flex flex-1 flex-col gap-3.5">
            {col.map((c, j) => (
              <div
                key={c.id}
                onMouseLeave={resetAfterLeave}
                className="group relative flex w-full items-end justify-center overflow-hidden rounded-xl border border-[#e7e9ee] bg-[#f5f5f5] p-1.5 drop-shadow-[0px_1px_1px_rgba(0,0,0,0.06)]"
              >
                <div className="relative w-full overflow-hidden rounded-md">
                  {adminButtons(c.id)}
                  <div
                    onClick={() =>
                      c.preview_url &&
                      setLightbox({ src: c.preview_url, logo: false })
                    }
                    className="relative w-full cursor-zoom-in overflow-hidden rounded-md border border-[#e7e9ee]"
                  >
                    <div
                      className={`relative w-full overflow-hidden rounded-md bg-[#e4e4e7] ${
                        loadedIds.has(c.id) ? "" : "skeleton-shimmer"
                      }`}
                      style={{
                        paddingBottom: c.aspect_ratio
                          ? `${(1 / c.aspect_ratio) * 100}%`
                          : "75%",
                      }}
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        alt=""
                        src={cloudflareThumb(c.preview_url ?? "")}
                        loading={j === 0 ? "eager" : "lazy"}
                        ref={(el) => {
                          if (el && el.complete && el.naturalWidth > 0)
                            el.style.opacity = "1";
                        }}
                        onLoad={(e) => {
                          e.currentTarget.style.opacity = "1";
                          markLoaded(c.id);
                        }}
                        className="absolute inset-0 h-full w-full rounded-md object-cover opacity-0 transition-opacity duration-500"
                      />
                    </div>
                    <span className={overlayCls} />
                  </div>
                  {copyButton(c.id, false, c.figma_url)}
                </div>
              </div>
            ))}
          </div>
        ))}
        </div>
        <div ref={colorSentinelRef} style={{ height: 1 }} />
        {/* End of color-search results. */}
        {!colorSearchHasMore && list.length > 0 && endMarker}
        {renderLightbox()}
        {renderDeleteModal()}
      </main>
    );
  };

  // Until mounted, render a deterministic skeleton — fixed columns, no
  // client-only data (cols/cache/counts) — so the server HTML and the first
  // client render match exactly (no hydration mismatch). The real grid renders
  // after mount with the client `cols` and any seeded cache.
  if (!mounted) {
    const SK_COLS = 4;
    const ph: string[][] = Array.from({ length: SK_COLS }, () => []);
    for (let k = 0; k < PAGE_SIZE; k++) {
      const ci = k % SK_COLS;
      ph[ci].push(`${getSkeletonRatio(ci, ph[ci].length) * 100}%`);
    }
    return (
      <main className="flex min-h-0 flex-1 flex-col overflow-y-auto bg-white p-4">
        {banner}
        <div className="flex flex-1 items-start gap-3.5">
          {ph.map((col, i) => (
            <div key={i} className="flex flex-1 flex-col gap-3.5">
              {col.map((pb, k) => (
                <div
                  key={k}
                  className="relative flex w-full items-end justify-center overflow-hidden rounded-xl border border-[#e7e9ee] bg-[#f5f5f5] p-1.5 drop-shadow-[0px_1px_1px_rgba(0,0,0,0.06)]"
                >
                  <div className="relative w-full overflow-hidden rounded-md border border-[#e7e9ee]">
                    <div
                      className="skeleton-shimmer relative w-full rounded-md"
                      style={{ paddingBottom: pb }}
                    />
                  </div>
                </div>
              ))}
            </div>
          ))}
        </div>
      </main>
    );
  }

  // Color search overrides the normal list while active.
  if (colorSearchActive) {
    if (colorSearchLoading) {
      // Skeletons while the color RPC runs — same look as the rest of the grid.
      const n = Math.max(1, cols);
      const ph: string[][] = Array.from({ length: n }, () => []);
      for (let k = 0; k < PAGE_SIZE; k++) {
        const ci = k % n;
        ph[ci].push(`${getSkeletonRatio(ci, ph[ci].length) * 100}%`);
      }
      return (
        <main className="flex min-h-0 flex-1 flex-col overflow-y-auto bg-white p-4">
          {banner}
          <div className="flex flex-1 items-start gap-3.5">
            {ph.map((col, i) => (
              <div key={i} className="flex flex-1 flex-col gap-3.5">
                {col.map((pb, k) => (
                  <div
                    key={k}
                    className="relative flex w-full items-end justify-center overflow-hidden rounded-xl border border-[#e7e9ee] bg-[#f5f5f5] p-1.5 drop-shadow-[0px_1px_1px_rgba(0,0,0,0.06)]"
                  >
                    <div className="relative w-full overflow-hidden rounded-md border border-[#e7e9ee]">
                      <div
                        className="skeleton-shimmer relative w-full rounded-md"
                        style={{ paddingBottom: pb }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            ))}
          </div>
        </main>
      );
    }
    const results = colorSearchResults ?? [];
    if (results.length === 0) {
      return (
        <main className="flex min-h-0 flex-1 items-center justify-center bg-white p-4">
          <div className="flex max-w-md flex-col items-center gap-0 text-center">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img alt="" src="/NoColor.png" className="size-65 object-contain" />
            <p className="-mt-3 text-[18px] font-medium tracking-[-0.03em] text-[#09090b]">
              No blocks found for this color
            </p>
          </div>
        </main>
      );
    }
    return renderGrid(results);
  }

  // Don't show the empty state mid-fetch (e.g. while a category switch loads) —
  // that would flash "No blocks" before the new page's cards arrive.
  const empty = componentsLoaded && filtered.length === 0 && !isFetching;

  if (empty) {
    return (
      <main className="flex min-h-0 flex-1 items-center justify-center bg-white p-4">
        <div className="flex max-w-md flex-col items-center gap-0 text-center">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img alt="" src="/NoColor.png" className="size-65 object-contain" />
          <p className="-mt-3 text-[18px] font-medium tracking-[-0.03em] text-[#09090b]">
            No blocks match the selected filter
          </p>
        </div>
        {renderLightbox()}
        {renderDeleteModal()}
      </main>
    );
  }

  // ---------------------------------------------------------------------------
  // Logos view — group components by letter (from their filters).
  // ---------------------------------------------------------------------------
  if (isLogos) {
    const n = Math.min(6, Math.max(1, cols));
    const groups: { letter: string; items: Component[] }[] = [];
    [...LETTERS, "Others"].forEach((letter) => {
      const items = filtered.filter((c) => (c.filters ?? []).includes(letter));
      if (items.length) groups.push({ letter, items });
    });

    return (
      <main ref={scrollRef} suppressHydrationWarning className="flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto bg-white p-4">
        {banner}
        {groups.map(({ letter, items }) => (
          <section key={letter} className="flex flex-col gap-3.5">
            <div className="flex items-center gap-3">
              <h2 className="whitespace-nowrap text-sm tracking-[-0.03em] text-black">
                {letter === "Others" ? "Others" : `Letter ${letter}`}
              </h2>
              <div className="h-0.5 flex-1 rounded-full bg-[#E4E4E7]" />
            </div>
            <div
              className="grid gap-3.5"
              style={{ gridTemplateColumns: `repeat(${n}, minmax(0, 1fr))` }}
            >
              {items.map((c, idx) => (
                <div
                  key={c.id}
                  onMouseLeave={resetAfterLeave}
                  className="group relative flex w-full items-end justify-center overflow-hidden rounded-xl border border-[#e7e9ee] bg-[#f5f5f5] p-1.5 drop-shadow-[0px_1px_1px_rgba(0,0,0,0.06)]"
                >
                  <div className="relative w-full overflow-hidden rounded-md">
                    {adminButtons(c.id, true)}
                    <div
                      className="relative flex w-full items-center justify-center overflow-hidden rounded-md border border-[#e7e9ee] bg-white"
                      style={{
                        // Square for layouts 3-6; layout 2 stays slightly wide.
                        aspectRatio: n >= 3 ? "1 / 1" : "5 / 4",
                        padding:
                          n >= 6 ? 38 : n >= 5 ? 36 : n >= 4 ? 40 : n >= 3 ? 48 : 72,
                      }}
                    >
                      {/* Placeholder fills the whole card (ignores padding). */}
                      {!loadedIds.has(c.id) && (
                        <span className="skeleton-shimmer absolute inset-0" />
                      )}
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        alt=""
                        src={cloudflareThumb(c.preview_url ?? "")}
                        loading={idx < n ? "eager" : "lazy"}
                        ref={(el) => {
                          if (el && el.complete && el.naturalWidth > 0)
                            el.style.opacity = "1";
                        }}
                        onLoad={(e) => {
                          e.currentTarget.style.opacity = "1";
                          markLoaded(c.id);
                        }}
                        className="size-full object-contain opacity-0 transition-opacity duration-500"
                      />
                    </div>
                    {copyButton(c.id, true, c.figma_url)}
                  </div>
                </div>
              ))}
            </div>
          </section>
        ))}
        {showSkeletons && (
          <div
            className="grid gap-3.5"
            style={{ gridTemplateColumns: `repeat(${n}, minmax(0, 1fr))` }}
          >
            {Array.from({ length: PAGE_SIZE }).map((_, k) => (
              <div
                key={`sk-${k}`}
                className="relative flex w-full items-end justify-center overflow-hidden rounded-xl border border-[#e7e9ee] bg-[#f5f5f5] p-1.5 drop-shadow-[0px_1px_1px_rgba(0,0,0,0.06)]"
              >
                <div
                  className="relative w-full overflow-hidden rounded-md border border-[#e7e9ee] bg-white"
                  style={{ aspectRatio: n >= 3 ? "1 / 1" : "5 / 4" }}
                >
                  <span className="skeleton-shimmer absolute inset-0" />
                </div>
              </div>
            ))}
          </div>
        )}
        {/* Logos has no remaining-slot skeletons — observe a bottom target so
            infinite scroll works whether idle or loading. */}
        <div ref={firstSkeletonRef} style={{ height: 1 }} />
        {endReached && endMarker}
        {renderLightbox()}
        {renderDeleteModal()}
      </main>
    );
  }

  // ---------------------------------------------------------------------------
  // Masonry grid — distribute components across `cols` columns.
  // ---------------------------------------------------------------------------
  const buckets: Component[][] = Array.from({ length: Math.max(1, cols) }, () => []);
  filtered.forEach((c, i) => buckets[i % buckets.length].push(c));

  // Skeleton padding-bottom values per column, deterministic varying heights
  // (Pinterest look), bucketed continuing the real card index so each incoming
  // card drops into its skeleton's exact slot — no layout jump.
  const nCols = Math.max(1, cols);
  const skBuckets: string[][] = Array.from({ length: nCols }, () => []);
  if (isInitialLoad) {
    // Nothing loaded yet — one page of skeletons.
    for (let k = 0; k < PAGE_SIZE; k++) {
      const ci = k % nCols;
      const cardIdx = skBuckets[ci].length;
      skBuckets[ci].push(`${getSkeletonRatio(ci, cardIdx) * 100}%`);
    }
  } else {
    // Permanent placeholders for every component beyond the loaded page (capped
    // at 2 pages). Shown even when idle so the grid always reflects the real
    // total; each placeholder is replaced by a card as pages stream in.
    const cachedLen = filtered.length;
    const totalCount = dbCategory ? categoryCounts[dbCategory] || 0 : 0;
    let remaining = hasMore
      ? Math.min(Math.max(0, totalCount - cachedLen), PAGE_SIZE * 2)
      : 0;
    // Count not known yet but a page is loading → fall back to one page.
    if (remaining === 0 && isFetchingMore) remaining = PAGE_SIZE;
    for (let k = 0; k < remaining; k++) {
      const ci = (cachedLen + k) % nCols;
      const cardIdx = skBuckets[ci].length;
      skBuckets[ci].push(`${getSkeletonRatio(ci, cardIdx) * 100}%`);
    }
  }

  return (
    <main ref={scrollRef} suppressHydrationWarning className="flex min-h-0 flex-1 flex-col overflow-y-auto bg-white p-4">
      {banner}
      <div className="flex flex-1 items-start gap-3.5">
      {buckets.map((col, i) => (
        <div key={i} className="flex flex-1 flex-col gap-3.5">
          {col.map((c, j) => (
            <div
              key={c.id}
              onMouseLeave={resetAfterLeave}
              className="group relative flex w-full items-end justify-center overflow-hidden rounded-xl border border-[#e7e9ee] bg-[#f5f5f5] p-1.5 drop-shadow-[0px_1px_1px_rgba(0,0,0,0.06)]"
            >
              <div className="relative w-full overflow-hidden rounded-md">
                {adminButtons(c.id)}
                <div
                  onClick={() =>
                    c.preview_url &&
                    setLightbox({ src: c.preview_url, logo: false })
                  }
                  className="relative w-full cursor-zoom-in overflow-hidden rounded-md border border-[#e7e9ee]"
                >
                  <div
                    className={`relative w-full overflow-hidden rounded-md bg-[#e4e4e7] ${
                      loadedIds.has(c.id) ? "" : "skeleton-shimmer"
                    }`}
                    style={{
                      paddingBottom: c.aspect_ratio
                        ? `${(1 / c.aspect_ratio) * 100}%`
                        : "75%",
                    }}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      alt=""
                      src={cloudflareThumb(c.preview_url ?? "")}
                      loading={j === 0 ? "eager" : "lazy"}
                      ref={(el) => {
                        if (el && el.complete && el.naturalWidth > 0)
                          el.style.opacity = "1";
                      }}
                      onLoad={(e) => {
                        e.currentTarget.style.opacity = "1";
                        markLoaded(c.id);
                      }}
                      className="absolute inset-0 h-full w-full rounded-md object-cover opacity-0 transition-opacity duration-500"
                    />
                  </div>
                  <span className={overlayCls} />
                </div>
                {copyButton(c.id, false, c.figma_url)}
              </div>
            </div>
          ))}
          {/* No skeletons (e.g. counts not loaded yet) → keep the observer
              target reachable so infinite scroll still triggers. */}
          {i === 0 && skBuckets[i].length === 0 && (
            <div ref={firstSkeletonRef} style={{ height: 1 }} />
          )}
          {skBuckets[i].map((pb, k) => (
            <div
              key={`sk-${k}`}
              // The observer watches the very first skeleton card directly.
              ref={i === 0 && k === 0 ? firstSkeletonRef : undefined}
              className="relative flex w-full items-end justify-center overflow-hidden rounded-xl border border-[#e7e9ee] bg-[#f5f5f5] p-1.5 drop-shadow-[0px_1px_1px_rgba(0,0,0,0.06)]"
            >
              <div className="relative w-full overflow-hidden rounded-md border border-[#e7e9ee]">
                <div
                  className="skeleton-shimmer relative w-full rounded-md"
                  style={{ paddingBottom: pb }}
                />
              </div>
            </div>
          ))}
        </div>
      ))}
      </div>
      {endReached && endMarker}
      {renderLightbox()}
      {renderDeleteModal()}
    </main>
  );
}
