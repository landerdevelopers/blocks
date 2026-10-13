"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type MouseEvent,
} from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import {
  ArrowUp,
  Calendar,
  ChevronDown,
  CodeXml,
  Copy,
  Globe,
  Megaphone,
  Pencil,
  ShieldCheck,
  Trash2,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { LANDER_ID, LANDER_BRAND } from "@/lib/lander";
import { revalidateSidebarCounts } from "@/app/actions";
import { useAuthStore, type GalleryComponent } from "@/store/authStore";
import {
  readComponentsCache,
  writeComponentsCache,
} from "@/lib/componentsCache";
import { cloudflareThumb, cloudflareFull, cloudflareLogo } from "@/lib/utils";
type Component = GalleryComponent;

// One row from get_creator_by_id — the per-CREATOR lightbox card. Fetched once
// per creator and cached by uploaded_by, so opening many of a creator's
// components never re-hits the DB for this. The per-COMPONENT bits (copy_count,
// created_at, figma_url) come straight off the gallery row — see LightboxDetail.
type CreatorDetail = {
  creator_username: string | null;
  creator_display_name: string | null;
  creator_avatar_url: string | null;
  creator_bio: string | null;
  creator_x_handle: string | null;
  creator_instagram_handle: string | null;
  creator_linkedin_handle: string | null;
  creator_website_url: string | null;
  creator_cta_url: string | null;
  creator_design_count: number;
  // True when the uploader is an admin (no real creator profile). The lightbox
  // then renders the fixed Lander Studio agency card (see LANDER).
  is_admin: boolean;
};

// What the lightbox panels read — per-component bits off the gallery row merged
// with the cached creator card.
type LightboxDetail = CreatorDetail & {
  copy_count: number;
  figma_url: string | null;
  created_at: string;
};

// Admin uploads have no real creator — show Lander Studio (the house agency)
// instead. Built from the shared LANDER_BRAND so the lightbox card and the
// sidebar entry never drift. design_count is filled from the RPC per row.
const LANDER: Omit<CreatorDetail, "creator_design_count"> = {
  creator_username: LANDER_ID,
  creator_display_name: LANDER_BRAND.display_name,
  creator_avatar_url: LANDER_BRAND.avatar_url,
  creator_bio: LANDER_BRAND.bio,
  creator_x_handle: LANDER_BRAND.x_handle,
  creator_instagram_handle: LANDER_BRAND.instagram_handle,
  creator_linkedin_handle: LANDER_BRAND.linkedin_handle,
  creator_website_url: LANDER_BRAND.website_url,
  creator_cta_url: LANDER_BRAND.cta_url,
  is_admin: true,
};

// "1.2K", "12", "1.3M" — compact copy counts.
const fmtCount = (n: number) =>
  Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 }).format(
    n ?? 0,
  );
// "Jun 20, 2026".
const fmtPosted = (iso: string) =>
  new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });

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
  creatorId = null,
  landerAdminIds = null,
  colorSearchActive = false,
  colorSearchLoading = false,
  colorSearchResults = null,
  colorSearchHasMore = false,
  onColorSearchLoadMore,
  initialCategoryCounts,
  creatorRestorePending = false,
}: {
  cols?: number;
  loggedIn: boolean;
  onRequireLogin: () => void;
  onCopy: (
    componentId: string,
    canvas?: boolean,
  ) => Promise<{
    allowed: boolean;
    figmaData: string | null;
    canvasUrl?: string;
  }>;
  category?: string | null;
  filters?: string[];
  // When set, the gallery shows ONLY this creator's published designs, still
  // scoped to the active category (their logos show under Logos, etc.). Selected
  // from the sidebar "All Creators" popup.
  creatorId?: string | null;
  // Admin profile ids backing the "Lander Studio" view. Used only when creatorId
  // is the LANDER_ID sentinel: the gallery scopes to uploaded_by IN these ids
  // (all admin uploads) instead of a single creator. null while still loading.
  landerAdminIds?: string[] | null;
  colorSearchActive?: boolean;
  colorSearchLoading?: boolean;
  colorSearchResults?: Component[] | null;
  colorSearchHasMore?: boolean;
  onColorSearchLoadMore?: () => void;
  // Per-category published totals from the server (get_sidebar_counts, cached
  // 30min, passed down from the page). Seeds the store so the gallery has true
  // category totals without firing its own count queries on load.
  initialCategoryCounts?: Record<string, number>;
  // True while a ?creator= URL param is still being resolved to an id on load.
  // Holds the gallery on skeletons instead of fetching the unscoped list and
  // then snapping to the creator (flash).
  creatorRestorePending?: boolean;
}) {
  const router = useRouter();
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
  // Synchronous lock so a second click can't start a copy mid-flight.
  const copyLockRef = useRef(false);
  // Synchronous in-flight lock for pagination — blocks a second page fetch
  // before React re-renders (state-based guards lag a render).
  const fetchingPageRef = useRef(false);
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
      // Creator view is ALSO category-scoped: a creator's designs only appear in
      // the category they belong to (e.g. their logos show only under Logos). The
      // cache is keyed per-creator-AND-category so it never collides.
      const dbCat = category ? CAT_MAP[category] : null;
      const cacheKey = creatorId
        ? `creator:${creatorId}:${category ?? "website"}`
        : category ?? "website";
      let query = createClient()
        .from("components")
        .select(
          "id, category, section, filters, figma_url, preview_url, aspect_ratio, featured, featured_at, uploaded_by, created_at, copy_count",
        )
        // Never show private designs — not even to their owner — in the gallery.
        // (RLS lets an owner read their own private rows, so filter explicitly.)
        .eq("is_published", true)
        .eq("is_private", false);
      // Lander Studio = the admin-upload aggregate (uploaded_by IN admin ids);
      // a real creator = one uploaded_by. singleCreator drives the per-creator
      // ordering, which doesn't apply to the multi-uploader Lander view.
      const isLander = creatorId === LANDER_ID;
      const singleCreator = !!creatorId && !isLander;
      if (isLander) query = query.in("uploaded_by", landerAdminIds ?? []);
      else if (creatorId) query = query.eq("uploaded_by", creatorId);
      if (dbCat) query = query.eq("category", dbCat);
      // Creator view follows the creator's manual arrangement (creator_pinned_at),
      // then newest. Category + Lander views: logos paginate ALPHABETICALLY by
      // letter (stored in `filters`) so each batch fills A→Z; others pinned-first,
      // newest.
      if (singleCreator) {
        query = query
          .order("creator_pinned_at", { ascending: false, nullsFirst: false })
          .order("created_at", { ascending: false });
      } else {
        if (dbCat === "Logos") {
          query = query.order("filters", { ascending: true });
        }
        query = query
          .order("featured", { ascending: false })
          .order("featured_at", { ascending: false, nullsFirst: false })
          .order("created_at", { ascending: false });
      }
      const { data, error } = await query.range(from, to);
      if (error) {
        console.error("[gallery] fetchPage:", error.message);
        setIsFetching(false);
        setIsFetchingMore(false);
        fetchingPageRef.current = false;
        return;
      }
      const fresh = (data as Component[]) ?? [];
      if (fresh.length < PAGE_SIZE) setHasMore(false);
      if (page === 0) {
        setComponents(fresh);
        // Cache page 0 under THIS view's own key (category slug, or creator:<id>)
        // — not a global — so overlapping fetches across switches never mis-key.
        // Pass the known total so the cache can drive skeleton slots on refresh.
        const total =
          !creatorId && dbCat
            ? useAuthStore.getState().categoryCounts[dbCat]
            : undefined;
        writeComponentsCache(cacheKey, fresh, total);
      } else {
        appendComponents(fresh);
      }
      setCurrentPage(page);
      setIsFetching(false);
      setIsFetchingMore(false);
      fetchingPageRef.current = false;
      // A full page came back → more likely exists. Chain the next page after a
      // short delay so cards stream in progressively (24 at a time).
      if (fresh.length === PAGE_SIZE) {
        setTimeout(() => fetchPage(page + 1), 100);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      category,
      creatorId,
      landerAdminIds,
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
    // A ?creator= param is still resolving to an id (Sidebar's get_creator).
    // Hold on skeletons rather than fetch the unscoped all-creators list — once
    // the id lands, creatorId changes and this effect re-runs scoped to it.
    if (creatorRestorePending && !creatorId) {
      setCurrentCategory(cat);
      setDisplayCategory(category);
      clearComponents();
      return;
    }
    // Lander Studio picked but its admin ids haven't loaded yet — hold on
    // skeletons rather than fetch with an empty IN (which returns nothing).
    // This effect re-runs once landerAdminIds lands.
    if (creatorId === LANDER_ID && !landerAdminIds) {
      setCurrentCategory(cat);
      setDisplayCategory(category);
      clearComponents();
      return;
    }
    const cacheKey = creatorId ? `creator:${creatorId}:${cat}` : cat;
    setCurrentCategory(cat);
    setHasMore(true);
    setCurrentPage(0);
    const cached = readComponentsCache(cacheKey);
    if (cached) {
      setComponents(cached.data); // instant display from this view's cache
      // Only category caches carry a category count to seed; creator caches don't.
      if (!creatorId && cached.total)
        setCategoryCounts({ [CAT_MAP[cat]]: cached.total });
    } else {
      clearComponents(); // empty + loaded=false → skeletons, never stale data
    }
    // Update the filter category only AFTER the store has been reset, so the
    // list and the filter always agree (no old-components/new-category render).
    setDisplayCategory(category);
    fetchingPageRef.current = false;
    fetchPage(0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [category, creatorId, creatorRestorePending, landerAdminIds]);

  // Reset scroll to the top on every category switch. Runs in a LAYOUT effect
  // keyed on the rendered category so it fires AFTER the new content commits —
  // setting scrollTop in the fetch effect above hits the OLD (still-tall)
  // content, which Mac browsers then re-anchor back to mid-scroll. Doing it
  // here, post-commit, lands at the top on every platform.
  useLayoutEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = 0;
  }, [displayCategory]);

  // Total published counts per category — drives the skeleton slots beyond the
  // loaded page. Seeded from the server's get_sidebar_counts (passed as a prop),
  // so the gallery no longer fires its own per-category count() queries on load.
  useEffect(() => {
    if (initialCategoryCounts) setCategoryCounts(initialCategoryCounts);
  }, [setCategoryCounts, initialCategoryCounts]);

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
  // Logos always use the per-letter layout — including in creator view, so a
  // creator's logos render exactly like the main Logos category.
  const isLogos = dbCategory === "Logos";

  // Apply category + filter selection. In creator view the fetch is already
  // scoped to (creator, category), so the category check is a no-op there; the
  // letter/section/theme chip filters still apply the same as a category view.
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
  }, [components, dbCategory, filters, creatorId]);

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
    // Re-attach when the observed skeleton element can move (more cards loaded)
    // or the fetch closure changes (category/creator switch). categoryCounts is
    // NOT a dep — it isn't read here and only changes the skeleton COUNT, not
    // which element we observe.
  }, [
    hasMore,
    isFetching,
    currentPage,
    colorSearchActive,
    components.length,
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
    // fetchPage is included so a category/creator switch re-runs the fill check
    // with the fresh closure (it's a useCallback keyed on category/creatorId, so
    // this can't loop) — no stale-closure risk, no eslint-disable needed.
  }, [
    components.length,
    hasMore,
    isFetching,
    currentPage,
    colorSearchActive,
    fetchPage,
  ]);

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
    // Refresh the (server-cached) sidebar count badges: mark them stale, then
    // re-render the server component so the new global counts reach the sidebar.
    // The creator-scoped counts refresh via the store's componentsVersion bump.
    revalidateSidebarCounts().catch(() => {});
    router.refresh();
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
  // Show the "Copied!" pill for a fixed window after a copy, independent of
  // hover, so the user always sees confirmation even if they move off the card.
  const markCopied = (key: string) => {
    if (timer.current) clearTimeout(timer.current);
    setCopied(key);
    timer.current = setTimeout(() => setCopied(null), 2500);
  };
  // Hover-leave no longer dismisses the copied state — the timer above owns it.
  const resetAfterLeave = () => {};

  // Lightbox.
  const [lightbox, setLightbox] = useState<
    { id: string; src: string; logo: boolean; aspectRatio: number | null } | null
  >(null);
  // Full-res image load state — skeleton (sized to aspect ratio) shows until
  // it's true. Reset whenever a new image opens.
  const [fullLoaded, setFullLoaded] = useState(false);
  useEffect(() => {
    if (lightbox) setFullLoaded(false);
  }, [lightbox?.src]);
  useEffect(() => {
    if (!lightbox) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setLightbox(null);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [lightbox]);

  // Lightbox side panels. The per-COMPONENT bits (copy_count, created_at,
  // figma_url) ride on the already-loaded gallery row → ZERO fetch on open. The
  // per-CREATOR card is fetched once per creator and cached by uploaded_by, so
  // opening any number of a creator's components costs at most one creator
  // fetch. At scale (1000s of components, far fewer creators) per-open DB cost
  // collapses from O(components opened) to O(distinct creators seen).
  const lbRow = useMemo(
    () =>
      lightbox ? components.find((c) => c.id === lightbox.id) ?? null : null,
    [lightbox, components],
  );
  const [creator, setCreator] = useState<CreatorDetail | null>(null);
  const creatorCache = useRef<Map<string, CreatorDetail>>(new Map());
  useEffect(() => {
    const uid = lbRow?.uploaded_by;
    if (!uid) {
      setCreator(null); // admin upload (no creator) → empty creator column
      return;
    }
    const cached = creatorCache.current.get(uid);
    if (cached) {
      setCreator(cached); // instant, no fetch
      return;
    }
    setCreator(null); // skeleton while this creator's first fetch resolves
    let alive = true;
    createClient()
      .rpc("get_creator_by_id", { p_id: uid })
      .then(({ data }) => {
        if (!alive) return;
        const row = (Array.isArray(data) ? data[0] : data) as
          | CreatorDetail
          | null
          | undefined;
        if (row) {
          creatorCache.current.set(uid, row);
          setCreator(row);
        }
      });
    return () => {
      alive = false;
    };
  }, [lbRow?.uploaded_by]);

  // Combined view the panels render from: per-component bits off the row +
  // cached creator. Present (non-skeleton) the instant a row is open.
  const detail = useMemo<LightboxDetail | null>(() => {
    if (!lbRow) return null;
    // Admin uploads → show the fixed Lander Studio card (its design count is the
    // combined total of all admin uploads, from get_creator_by_id).
    const c = creator?.is_admin
      ? { ...LANDER, creator_design_count: creator.creator_design_count }
      : creator;
    return {
      copy_count: lbRow.copy_count ?? 0,
      figma_url: lbRow.figma_url,
      created_at: lbRow.created_at ?? "",
      creator_username: c?.creator_username ?? null,
      creator_display_name: c?.creator_display_name ?? null,
      creator_avatar_url: c?.creator_avatar_url ?? null,
      creator_bio: c?.creator_bio ?? null,
      creator_x_handle: c?.creator_x_handle ?? null,
      creator_instagram_handle: c?.creator_instagram_handle ?? null,
      creator_linkedin_handle: c?.creator_linkedin_handle ?? null,
      creator_website_url: c?.creator_website_url ?? null,
      creator_cta_url: c?.creator_cta_url ?? null,
      creator_design_count: c?.creator_design_count ?? 0,
      is_admin: c?.is_admin ?? false,
    };
  }, [lbRow, creator]);
  // Lander card (admin upload) — its name link + Hire go to lander.studio, and
  // its LinkedIn is a full company URL rather than an /in/ handle.
  const isLanderCard = detail?.is_admin ?? false;
  // Creator-card skeleton shows only when the row HAS a creator we haven't
  // loaded yet (reserves the column so the image never shifts).
  const creatorPending = !!lbRow?.uploaded_by && !creator;

  // Lightbox "Copy to Figma" — same gated record_copy + clipboard pattern as the
  // card button, keyed to the open component.
  const [lbCopied, setLbCopied] = useState(false);
  const [lbCopying, setLbCopying] = useState(false);
  useEffect(() => {
    setLbCopied(false);
    setLbCopying(false);
  }, [lightbox?.id]);
  const copyFromLightbox = (e: MouseEvent) => {
    e.stopPropagation();
    if (!lightbox || copyLockRef.current || authLoading) return;
    if (!loggedIn) {
      onRequireLogin();
      return;
    }
    copyLockRef.current = true;
    setLbCopying(true);
    const figmaUrl = detail?.figma_url ?? null;
    const resolved = onCopy(lightbox.id).then((res) => {
      if (!res.allowed) throw new Error("copy-not-allowed");
      return res.figmaData;
    });
    navigator.clipboard
      .write([
        new ClipboardItem({
          "text/html": resolved.then(
            (fd) => new Blob([fd || figmaUrl || ""], { type: "text/html" }),
          ),
          "text/plain": resolved.then(
            () => new Blob([figmaUrl || ""], { type: "text/plain" }),
          ),
        }),
      ])
      .then(() => {
        setLbCopied(true);
        setTimeout(() => setLbCopied(false), 2000);
      })
      .catch(() => {})
      .finally(() => {
        copyLockRef.current = false;
        setLbCopying(false);
      });
  };

  // Lightbox "Copy code" — same gated copy, but the design opens in Canvas (the
  // figma-to-code app) instead of the clipboard. The tab is opened synchronously
  // inside the click (popup blockers allow only that) and pointed at Canvas once
  // /api/copy hands back the one-time handoff URL; closed again if it doesn't.
  const [opening, setOpening] = useState<string | null>(null);
  const openInCanvas = (e: MouseEvent, id: string) => {
    e.stopPropagation();
    if (copyLockRef.current || authLoading) return;
    if (!loggedIn) {
      onRequireLogin();
      return;
    }
    copyLockRef.current = true;
    setOpening(id);
    const tab = window.open("", "_blank");
    onCopy(id, true)
      .then((res) => {
        if (!res.allowed || !res.canvasUrl) throw new Error("copy-not-allowed");
        if (tab) {
          tab.opener = null;
          tab.location.href = res.canvasUrl;
        } else window.location.href = res.canvasUrl;
      })
      .catch(() => tab?.close())
      .finally(() => {
        copyLockRef.current = false;
        setOpening(null);
      });
  };

  // Admin: pin a component to the very top. Sets featured + a fresh featured_at
  // (the sort key) in the DB; optimistically marks it featured and moves it to
  // the front of the list so it jumps up instantly. In the logos view the list
  // order drives each letter group, so the pinned logo leads its own letter.
  const pinToTop = async (id: string) => {
    const current = useAuthStore.getState().components;
    const target = current.find((c) => c.id === id);
    if (!target) return;
    const next = [
      { ...target, featured: true, featured_at: new Date().toISOString() },
      ...current.filter((c) => c.id !== id),
    ];
    setComponents(next);
    // Keep this category's cache in sync so a switch-and-back keeps the order.
    const total = dbCategory
      ? (categoryCounts[dbCategory] ?? next.length)
      : next.length;
    writeComponentsCache(category ?? "website", next, total);
    const { error } = await createClient()
      .from("components")
      .update({ featured: true, featured_at: new Date().toISOString() })
      .eq("id", id);
    if (error) console.error("[gallery] pinToTop:", error.message);
  };

  // Admin controls — Pin + Edit + Delete, shown on hover. Slide in from the top.
  // Positions computed in px from the box size so the buttons never overlap.
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

        {/* Send to top — pins this component above the rest. */}
        <button
          type="button"
          aria-label="Send to top"
          onClick={(e) => {
            e.stopPropagation();
            pinToTop(id);
          }}
          style={{
            width: k.box,
            height: k.box,
            top: pad,
            [sideKey]: pad + 2 * (k.box + gap),
          }}
          className={`${base} ${tone}`}
        >
          <ArrowUp size={k.icon} strokeWidth={2} />
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

    // Click handler — SYNCHRONOUS. The clipboard write MUST be issued inside
    // the gesture or Safari (WebKit) drops the transient user activation and
    // silently writes nothing. We can't await the limit-check / figma_data
    // fetch before writing, so we hand `navigator.clipboard.write` a
    // ClipboardItem whose Blob is a Promise: Safari keeps the activation alive
    // while that promise resolves the network round-trip internally. This is
    // the WebKit-sanctioned async-clipboard pattern and works on Chrome/FF too.
    const onClick = (e: MouseEvent) => {
      e.stopPropagation(); // don't trigger the image lightbox
      if (copyLockRef.current) return;
      if (authLoading) return; // wait for the session to resolve
      if (!loggedIn) {
        onRequireLogin();
        return;
      }
      copyLockRef.current = true;
      setCopying(id);

      // record_copy enforces the daily limit AND returns figma_data only when
      // allowed — the single gated path to it. Rejecting this promise (limit
      // hit / blocked) aborts the clipboard write so nothing is copied.
      const resolved = onCopy(id).then((res) => {
        if (!res.allowed) throw new Error("copy-not-allowed");
        return res.figmaData;
      });

      // Issued synchronously — the Blob promises resolve after the fetch.
      navigator.clipboard
        .write([
          new ClipboardItem({
            "text/html": resolved.then(
              (fd) =>
                new Blob([fd || figmaUrl || ""], { type: "text/html" }),
            ),
            "text/plain": resolved.then(
              () => new Blob([figmaUrl || ""], { type: "text/plain" }),
            ),
          }),
        ])
        .then(() => markCopied(id))
        .catch(() => {
          // limit reached or clipboard blocked — leave button in idle state
        })
        .finally(() => {
          copyLockRef.current = false;
          setCopying(null);
        });
    };

    const btn = `flex shrink-0 cursor-pointer items-center justify-center ${cfg.gap} border shadow-[0px_4px_12px_rgba(0,0,0,0.14)] transition-[background-color,transform] duration-150 active:scale-[0.97]`;
    const pill =
      "flex items-center justify-center whitespace-nowrap border font-medium tracking-[-0.03em] shadow-[0px_4px_12px_rgba(0,0,0,0.12)] transition-[opacity,transform] duration-300 ease-out";

    // While copying or showing the copied state, the pill stays visible even
    // when the card isn't hovered (so the loader/confirmation never vanishes).
    const shown = isCopying || isCopied;
    return (
      // Wrapper: positioned per layout + slides in on card hover (or when shown).
      <div
        className={`pointer-events-none absolute z-10 w-max transition-[opacity,translate] duration-300 ease-out ${
          shown ? "opacity-100" : "opacity-0 group-hover:opacity-100"
        } ${
          cfg.pos === "tr"
            ? `right-6 top-6 ${
                shown
                  ? "translate-y-0"
                  : "-translate-y-[calc(100%+1.5rem)] group-hover:translate-y-0"
              }`
            : `${
                // Logos (dark) at layout 4/5/6 sit a little lower in the card.
                dark && cols >= 4 ? "bottom-3" : "bottom-6"
              } left-1/2 -translate-x-1/2 ${
                shown
                  ? "translate-y-0"
                  : "translate-y-[calc(100%+1.5rem)] group-hover:translate-y-0"
              }`
        }`}
      >
        <div className="relative">
          {/* One split pill: Copy to Figma | Copy code. In flow, sizes the
              wrapper; slides down + out on copy. Logos get only the Figma half —
              there is no layout in a logo to turn into code. */}
          <div
            style={{
              gap: cfg.h * 0.18,
              fontSize: cfg.fs * 0.94,
              transform: isCopied ? "translateY(14px)" : "translateY(0)",
              opacity: isCopied ? 0 : undefined,
            }}
            className={`flex items-center whitespace-nowrap font-medium tracking-[-0.03em] transition-[opacity,transform] duration-300 ease-out ${
              isCopied ? "pointer-events-none" : "group-hover:pointer-events-auto"
            }`}
          >
            <button
              type="button"
              onClick={onClick}
              style={{ height: cfg.h, borderRadius: cfg.r, paddingInline: cfg.h * 0.38 }}
              className={`${btn} ${
                dark
                  ? "border-white/15 bg-black text-white hover:bg-[#1f1f22]"
                  : "border-black bg-[#09090b] text-white hover:bg-[#27272a]"
              }`}
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
                  <img alt="" src="/figma.png" className="shrink-0" style={{ width: cfg.img * 0.9, height: cfg.img * 0.9 }} />
                  Copy to Figma
                </>
              )}
            </button>
            {/* Copy code — opens the design in Canvas (Figma to Code). Not on
                logos: there is no layout in a logo to turn into code. */}
            {!dark && (
              <button
                type="button"
                aria-label="Copy code"
                title="Opens this design in our Figma to Code converter"
                onClick={(e) => openInCanvas(e, id)}
                style={{
                  height: cfg.h,
                  borderRadius: cfg.r,
                  paddingInline: cols >= 5 ? cfg.h * 0.28 : cfg.h * 0.38,
                }}
                className={`${btn} border-[#e7e9ee] bg-white text-[#09090b] hover:bg-[#f4f4f5]`}
              >
                {opening === id ? (
                  <span
                    className="animate-spin rounded-full border-2 border-current border-t-transparent opacity-70"
                    style={{ width: cfg.img, height: cfg.img }}
                  />
                ) : (
                  <>
                    <CodeXml className="shrink-0" size={cfg.img * 0.82} strokeWidth={2.25} />
                    {cols <= 4 && "Copy code"}
                  </>
                )}
              </button>
            )}
          </div>

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
    <div className="mb-3.5 flex shrink-0 items-center gap-2">
      <div className="flex h-[34px] w-fit min-w-0 max-w-full items-center gap-2 rounded-[10px] border border-[#e7e9ee] bg-[#F0F1F2] px-2.5 py-2">
        <Megaphone
          size={16}
          strokeWidth={1.5}
          className="shrink-0 text-[#4D4D4D]"
        />
        <span className="truncate text-[14px] tracking-[-0.03em] text-[#4D4D4D]">
          New: our free Figma to Code converter. Paste any Figma design and get React, HTML, Vue and more.{" "}
          <a
            href={process.env.NEXT_PUBLIC_CANVAS_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="underline underline-offset-2 ml-1 text-black transition-colors hover:text-black/70"
          >
            Try it free
          </a>
        </span>
      </div>
      {/* Admins only: shortcuts to the admin pages (middleware gates them too). */}
      {isAdmin && (
        <details className="group/admin relative shrink-0">
          <summary className="flex h-[34px] cursor-pointer list-none items-center gap-1.5 rounded-[10px] border border-[#e7e9ee] bg-white px-2.5 text-[14px] font-medium tracking-[-0.03em] text-[#09090b] transition-colors hover:bg-[#fafafa] [&::-webkit-details-marker]:hidden">
            <ShieldCheck size={16} strokeWidth={1.75} />
            Admin
            <ChevronDown size={14} strokeWidth={2} className="transition-transform group-open/admin:rotate-180" />
          </summary>
          <div className="absolute left-0 top-[calc(100%+6px)] z-40 flex w-48 flex-col rounded-xl border border-[#e7e9ee] bg-white p-1 shadow-[0px_8px_24px_rgba(0,0,0,0.12)]">
            {[
              ["/analytics", "Analytics"],
              ["/admin/approvals", "Design Approvals"],
              ["/admin/applications", "Creator Applications"],
              ["/admin/creators", "Creators"],
            ].map(([href, label]) => (
              <a
                key={href}
                href={href}
                className="rounded-lg px-2.5 py-2 text-[14px] tracking-[-0.03em] text-[#3f3f46] transition-colors hover:bg-[#f4f4f5] hover:text-[#09090b]"
              >
                {label}
              </a>
            ))}
          </div>
        </details>
      )}
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
        More Designs coming soon
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
              className="flex max-w-[96vw] items-start gap-3"
            >
              {/* Left — creator card (desktop only; only for creator uploads).
                  Clicks on the actual cards/image are stopped so they don't close
                  the lightbox; clicking the surrounding empty area / gaps does. */}
              <div className="hidden w-[280px] shrink-0 self-start lg:flex">
                {detail?.creator_username ? (
                  <div
                    onClick={(e) => e.stopPropagation()}
                    className="flex w-full flex-col gap-3 rounded-xl bg-white p-3 shadow-[0px_12px_40px_rgba(0,0,0,0.4)]"
                  >
                    <div className="flex flex-col gap-3">
                      <div className="flex items-start gap-2.5">
                        <span
                          className={`flex size-[42px] shrink-0 items-center justify-center overflow-hidden rounded-lg text-sm font-medium text-[#09090b] ${
                            isLanderCard
                              ? "border border-[#e7e9ee]"
                              : "bg-[#ebebef]"
                          }`}
                        >
                          {detail.creator_avatar_url ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img
                              alt=""
                              src={detail.creator_avatar_url}
                              referrerPolicy="no-referrer"
                              className={
                                isLanderCard
                                  ? "size-full object-contain p-1"
                                  : "size-full object-cover"
                              }
                            />
                          ) : (
                            (detail.creator_display_name ??
                              detail.creator_username)
                              .charAt(0)
                              .toUpperCase()
                          )}
                        </span>
                        <div className="flex flex-col justify-center">
                          {isLanderCard ? (
                            <a
                              href={detail.creator_website_url ?? "#"}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-[16px] font-medium tracking-[-0.03em] text-black hover:underline"
                            >
                              {detail.creator_display_name ??
                                detail.creator_username}
                            </a>
                          ) : (
                            <span className="text-[16px] font-medium tracking-[-0.03em] text-black">
                              {detail.creator_display_name ??
                                detail.creator_username}
                            </span>
                          )}
                          <span className="text-[14px] tracking-[-0.01em] text-[#6f6f6f]">
                            {detail.creator_design_count} Design
                            {detail.creator_design_count === 1 ? "" : "s"}{" "}
                            Uploaded
                          </span>
                        </div>
                      </div>
                      {detail.creator_bio && (
                        <p className="whitespace-pre-wrap break-words [overflow-wrap:anywhere] text-[15px] tracking-[-0.02em] text-[#71717b]">
                          {detail.creator_bio}
                        </p>
                      )}
                    </div>

                    {(detail.creator_website_url ||
                      detail.creator_x_handle ||
                      detail.creator_instagram_handle ||
                      detail.creator_linkedin_handle ||
                      detail.creator_cta_url) && (
                      <div className="flex flex-col gap-2.5">
                        {(() => {
                          // One social → icon + label; two or more → icons only,
                          // each stretched to fill the row evenly. Brand glyphs
                          // come from /public; white bg, hover dims to 90%.
                          const li = detail.creator_linkedin_handle;
                          const socials = [
                            ...(detail.creator_website_url
                              ? [
                                  {
                                    key: "web",
                                    href: detail.creator_website_url,
                                    label: "Website",
                                    icon: <Globe size={17} strokeWidth={1.5} />,
                                  },
                                ]
                              : []),
                            ...(detail.creator_x_handle
                              ? [
                                  {
                                    key: "x",
                                    href: `https://x.com/${detail.creator_x_handle}`,
                                    label: "X",
                                    // eslint-disable-next-line @next/next/no-img-element
                                    icon: <img src="/x.svg" alt="" className="size-[18px]" />,
                                  },
                                ]
                              : []),
                            ...(detail.creator_instagram_handle
                              ? [
                                  {
                                    key: "ig",
                                    href: `https://instagram.com/${detail.creator_instagram_handle}`,
                                    label: "Instagram",
                                    // eslint-disable-next-line @next/next/no-img-element
                                    icon: <img src="/insta.svg" alt="" className="size-[18px]" />,
                                  },
                                ]
                              : []),
                            ...(li
                              ? [
                                  {
                                    key: "li",
                                    href: li.startsWith("http")
                                      ? li
                                      : `https://linkedin.com/in/${li}`,
                                    label: "LinkedIn",
                                    // eslint-disable-next-line @next/next/no-img-element
                                    icon: <img src="/linkedin.svg" alt="" className="size-[18px]" />,
                                  },
                                ]
                              : []),
                          ];
                          if (socials.length === 0) return null;
                          const single = socials.length === 1;
                          return (
                            <div className="flex gap-1.5">
                              {socials.map((s) => (
                                <a
                                  key={s.key}
                                  href={s.href}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  aria-label={s.label}
                                  className="flex min-h-9 flex-1 items-center justify-center gap-1.5 rounded-full bg-[#f4f4f6] text-[#52525b] transition-colors hover:bg-[#e6e6ea]"
                                >
                                  {s.icon}
                                  {single && (
                                    <span className="text-[13px] font-medium tracking-[-0.03em]">
                                      {s.label}
                                    </span>
                                  )}
                                </a>
                              ))}
                            </div>
                          );
                        })()}
                        {detail.creator_cta_url && (
                          <a
                            href={detail.creator_cta_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="flex min-h-9 items-center justify-center gap-1.5 rounded-lg bg-[#2974ff] px-4 py-2 text-[14px] font-medium tracking-[-0.03em] text-white transition-colors hover:bg-[#1f63e6] mt-4"
                          >
                            Hire Creator
                          </a>
                        )}
                      </div>
                    )}
                  </div>
                ) : creatorPending ? (
                  // Skeleton while this creator's card loads (reserves the column
                  // so the image doesn't shift when the card lands). Admin uploads
                  // have no creator → column stays empty; its fixed width still
                  // reserves the space, so nothing shifts.
                  <div
                    onClick={(e) => e.stopPropagation()}
                    className="flex w-full flex-col gap-3 rounded-xl bg-white p-3 shadow-[0px_12px_40px_rgba(0,0,0,0.4)]"
                  >
                    <div className="flex items-center gap-2.5">
                      <div className="size-[42px] shrink-0 animate-pulse rounded-lg bg-[#ebebef]" />
                      <div className="flex flex-col gap-1.5">
                        <div className="h-3.5 w-24 animate-pulse rounded bg-[#ebebef]" />
                        <div className="h-3 w-28 animate-pulse rounded bg-[#ebebef]" />
                      </div>
                    </div>
                    <div className="h-3 w-full animate-pulse rounded bg-[#ebebef]" />
                    <div className="h-3 w-3/4 animate-pulse rounded bg-[#ebebef]" />
                    <div className="flex gap-1.5">
                      {Array.from({ length: 4 }).map((_, i) => (
                        <div
                          key={i}
                          className="h-9 flex-1 animate-pulse rounded-full bg-[#ebebef]"
                        />
                      ))}
                    </div>
                    <div className="h-9 w-full animate-pulse rounded-lg bg-[#ebebef]" />
                  </div>
                ) : null}
              </div>

              {/* Center — image + close. */}
              <div
                onClick={(e) => e.stopPropagation()}
                className="relative shrink-0"
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
                  <div className="flex size-[min(82vw,460px)] items-center justify-center rounded-xl bg-white p-16 shadow-[0px_12px_40px_rgba(0,0,0,0.4)]">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img alt="" src={cloudflareFull(lightbox.src)} className="size-full object-contain" />
                  </div>
                ) : (
                  <div
                    className="w-[88vw] max-w-[calc(82vh*var(--ar))] rounded-xl shadow-[0px_12px_40px_rgba(0,0,0,0.4)] lg:w-[58vw]"
                    style={
                      {
                        "--ar": lightbox.aspectRatio ?? 1.7778,
                        position: "relative",
                        paddingBottom: lightbox.aspectRatio
                          ? `${(1 / lightbox.aspectRatio) * 100}%`
                          : "56.25%",
                      } as CSSProperties
                    }
                  >
                    {!fullLoaded && (
                      <div className="skeleton-shimmer absolute inset-0 rounded-xl" />
                    )}
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      alt=""
                      src={cloudflareFull(lightbox.src)}
                      onLoad={() => setFullLoaded(true)}
                      style={{
                        position: "absolute",
                        inset: 0,
                        width: "100%",
                        height: "100%",
                        objectFit: "contain",
                        opacity: fullLoaded ? 1 : 0,
                        transition: "opacity 0.3s ease",
                      }}
                      className="rounded-xl"
                    />
                  </div>
                )}
              </div>

              {/* Right — copy + posted date + total copies (desktop only). */}
              <div className="hidden w-[151px] shrink-0 flex-col gap-3 self-start lg:flex">
                <button
                  type="button"
                  onClick={copyFromLightbox}
                  className="flex cursor-pointer items-center justify-center gap-[4px] rounded-[12px] bg-white px-[12px] py-[6.5px] text-[16px] font-medium tracking-[-0.03em] text-[#09090b] shadow-[0px_12px_40px_rgba(0,0,0,0.4)] transition-colors hover:bg-[#ededed]"
                >
                  {lbCopying ? (
                    <span className="size-5 animate-spin rounded-full border-2 border-current border-t-transparent opacity-70" />
                  ) : lbCopied ? (
                    <>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img alt="" src="/Tick.png" className="size-4.5" />
                      Copied!
                    </>
                  ) : (
                    <>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img alt="" src="/figma.png" className="size-5" />
                      Copy to Figma
                    </>
                  )}
                </button>
                <button
                  type="button"
                  onClick={(e) => lightbox && openInCanvas(e, lightbox.id)}
                  className="flex cursor-pointer items-center justify-center gap-[6px] rounded-[12px] bg-[#09090b] px-[12px] py-[6.5px] text-[16px] font-medium tracking-[-0.03em] text-white shadow-[0px_12px_40px_rgba(0,0,0,0.4)] transition-colors hover:bg-[#27272a]"
                >
                  {opening && opening === lightbox?.id ? (
                    <span className="size-5 animate-spin rounded-full border-2 border-current border-t-transparent opacity-70" />
                  ) : (
                    <>
                      <CodeXml size={18} strokeWidth={2} />
                      Copy code
                    </>
                  )}
                </button>
                {detail ? (
                  <div
                    onClick={(e) => e.stopPropagation()}
                    className="flex h-[76px] flex-col justify-center gap-2 rounded-[12px] bg-white px-4 text-[14px] tracking-[-0.03em] text-[#71717B] shadow-[0px_12px_40px_rgba(0,0,0,0.4)]"
                  >
                    <span className="flex items-center gap-2">
                      <Calendar size={16} strokeWidth={1.5} className="text-[#71717B]" />
                      {fmtPosted(detail.created_at)}
                    </span>
                    <span className="flex items-center gap-2">
                      <Copy size={16} strokeWidth={1.5} className="text-[#71717B]" />
                      {fmtCount(detail.copy_count)} Copies
                    </span>
                  </div>
                ) : (
                  <div
                    onClick={(e) => e.stopPropagation()}
                    className="flex h-[76px] flex-col justify-center gap-2.5 rounded-2xl bg-white px-4 shadow-[0px_12px_40px_rgba(0,0,0,0.4)]"
                  >
                    <div className="h-4 w-28 animate-pulse rounded bg-[#ebebef]" />
                    <div className="h-4 w-20 animate-pulse rounded bg-[#ebebef]" />
                  </div>
                )}
              </div>
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
      <main ref={scrollRef} suppressHydrationWarning className="flex min-h-0 flex-1 flex-col overflow-y-auto bg-white p-4 [overflow-anchor:none]">
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
                      setLightbox({
                        id: c.id,
                        src: c.preview_url,
                        logo: false,
                        aspectRatio: c.aspect_ratio,
                      })
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
      <main className="flex min-h-0 flex-1 flex-col overflow-y-auto bg-white p-4 [overflow-anchor:none]">
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
        <main className="flex min-h-0 flex-1 flex-col overflow-y-auto bg-white p-4 [overflow-anchor:none]">
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
      <main ref={scrollRef} suppressHydrationWarning className="flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto bg-white p-4 [overflow-anchor:none]">
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
                        // Logos have no lightbox/modal — serve a crisp, right-
                        // sized variant. First row eager, rest lazy so they
                        // batch with pagination like every other category.
                        src={cloudflareLogo(c.preview_url ?? "")}
                        loading={idx < n ? "eager" : "lazy"}
                        decoding="async"
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
    // Creator view has no per-category total to project skeletons from — rely on
    // the load-more fallback + sentinel instead.
    const totalCount =
      !creatorId && dbCategory ? categoryCounts[dbCategory] || 0 : 0;
    let remaining = hasMore
      ? Math.min(PAGE_SIZE, Math.max(0, totalCount - cachedLen))
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
    <main ref={scrollRef} suppressHydrationWarning className="flex min-h-0 flex-1 flex-col overflow-y-auto bg-white p-4 [overflow-anchor:none]">
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
                    setLightbox({
                      id: c.id,
                      src: c.preview_url,
                      logo: false,
                      aspectRatio: c.aspect_ratio,
                    })
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
