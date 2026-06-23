import { create } from "zustand";
import { persist } from "zustand/middleware";
import { writeComponentsCache } from "@/lib/componentsCache";

// Category slug → public.components.category (DB value). Mirrors the maps in
// Gallery/page; kept here so cache writes can look up the right count.
const CAT_SLUG_TO_DB: Record<string, string> = {
  website: "Website",
  mobile: "Mobile Apps",
  dashboard: "Dashboard",
  logos: "Logos",
  illustrations: "Illustrations",
};

// Full row from public.profiles.
export type Profile = {
  id: string;
  full_name: string | null;
  avatar_url: string | null;
  role: string;
  copies_today: number;
  last_copy_date: string | null;
  created_at: string;
  // Beta access — set true when the user claims the beta link while logged in.
  // Unlocks all categories (read access), following the account across devices.
  beta?: boolean;
  // Creator handle (public URL /creators/<username>) + editable bio. Null until
  // the user becomes a creator (handle generated on first "Become Creator").
  username?: string | null;
  bio?: string | null;
  // Set true once an approved creator picks their handle in the post-approval
  // "Choose your username" modal. While false (and role === 'creator') the modal
  // is forced on next visit.
  creator_onboarded?: boolean;
  // Creator socials (usernames only) + links (full https URLs). Edited in the
  // account modal via set_my_socials; shown on the creator portal.
  x_handle?: string | null;
  instagram_handle?: string | null;
  linkedin_handle?: string | null;
  website_url?: string | null;
  cta_url?: string | null;
};

// Minimal component shape the gallery renders.
export type GalleryComponent = {
  id: string;
  category: string | null;
  section: string | null;
  filters: string[] | null;
  figma_url: string | null;
  // figma_data (large Figma clipboard HTML) is NOT carried here — it's fetched
  // lazily on copy so it doesn't bloat the gallery fetch/cache.
  preview_url: string | null;
  aspect_ratio: number | null;
  // Per-color {hex, pct} array — powers client-side color search.
  colors: { hex: string; pct: number | null }[] | null;
  // Pins the component to the top of the gallery (sorted before created_at).
  featured: boolean;
  // When the component was last pinned to top (via the admin arrow). Most
  // recently pinned sorts first among featured. Null for never-pinned rows.
  featured_at?: string | null;
  // Creator (uploader) id + the cheap per-component lightbox bits. Carried on the
  // row so the lightbox paints its per-component panel with ZERO fetch and only
  // fetches the per-CREATOR card once per creator (cached by uploaded_by). Null
  // on admin uploads (no creator) / rows cached before these were added.
  uploaded_by?: string | null;
  created_at?: string | null;
  // Snapshot at gallery load — a vanity count, slight staleness is fine.
  copy_count?: number | null;
};

type AuthState = {
  profile: Profile | null;
  isAdmin: boolean;
  email: string | null; // from the auth user (profiles has no email column)
  setProfile: (profile: Profile | null) => void;
  setEmail: (email: string | null) => void;
  // True until the first onAuthStateChange resolves (used to gate the flash).
  authLoading: boolean;
  setAuthLoading: (loading: boolean) => void;
  showOnboarding: boolean;
  setShowOnboarding: (show: boolean) => void;
  // Whether the signed-in user has a pending creator application. Prefetched on
  // sign-in so the account/sidebar "Become a Creator" CTA renders instantly
  // (no per-open query flash). null = not checked yet.
  pendingCreatorApp: boolean | null;
  setPendingCreatorApp: (v: boolean | null) => void;
  // Whether the user has an APPROVED creator application — true even after their
  // access is revoked (role back to 'user'). Hides the "Become a Creator" CTA so
  // a revoked creator isn't prompted to re-apply. null = not checked yet.
  wasCreator: boolean | null;
  setWasCreator: (v: boolean | null) => void;
  // Whether the user's creator application was REJECTED within the last 7 days.
  // Hides the "Become a Creator" CTA during the cooldown; after 7 days it shows
  // again so they can re-apply. null = not checked yet.
  creatorRejectedRecently: boolean | null;
  setCreatorRejectedRecently: (v: boolean | null) => void;
  // Shared gallery list — kept in sync so uploads appear instantly.
  components: GalleryComponent[];
  componentsLoaded: boolean;
  // Bumped on add/remove so subscribers (e.g. the sidebar's creator-scoped
  // count badges) can recompute when a component is added or deleted. Pagination
  // appends do NOT bump it.
  componentsVersion: number;
  // Active category slug — used to key the per-category cache on writes.
  currentCategory: string;
  setCurrentCategory: (category: string) => void;
  setComponents: (components: GalleryComponent[]) => void;
  addComponent: (component: GalleryComponent) => void;
  removeComponent: (id: string) => void;
  // Clear the in-memory list WITHOUT touching the cache (used when switching to
  // an uncached category so skeletons show instead of stale data).
  clearComponents: () => void;
  // Total published count per category (keyed by DB value, e.g. "Website") —
  // drives skeleton slots for components beyond the loaded page.
  categoryCounts: Record<string, number>;
  setCategoryCounts: (counts: Record<string, number>) => void;
  // Pagination — transient (never persisted), drives infinite scroll.
  hasMore: boolean;
  currentPage: number;
  isFetching: boolean;
  // True only while a page > 0 (load-more) is in flight — distinguishes
  // load-more from a page-0 background refresh so skeletons render correctly.
  isFetchingMore: boolean;
  setHasMore: (val: boolean) => void;
  setCurrentPage: (val: number) => void;
  setIsFetching: (val: boolean) => void;
  setIsFetchingMore: (val: boolean) => void;
  appendComponents: (items: GalleryComponent[]) => void;
};

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      profile: null,
      isAdmin: false,
      email: null,
      // Keep isAdmin in sync whenever the profile changes.
      setProfile: (profile) =>
        set({ profile, isAdmin: profile?.role === "admin" }),
      setEmail: (email) => set({ email }),
      authLoading: true,
      setAuthLoading: (loading) => set({ authLoading: loading }),
      showOnboarding: false,
      setShowOnboarding: (show) => set({ showOnboarding: show }),
      pendingCreatorApp: null,
      setPendingCreatorApp: (v) => set({ pendingCreatorApp: v }),
      wasCreator: null,
      setWasCreator: (v) => set({ wasCreator: v }),
      creatorRejectedRecently: null,
      setCreatorRejectedRecently: (v) => set({ creatorRejectedRecently: v }),
      components: [],
      componentsLoaded: false,
      componentsVersion: 0,
      currentCategory: "website",
      setCurrentCategory: (currentCategory) => set({ currentCategory }),
      // No cache write here — the page-0 fetch writes the cache with its OWN
      // category (see Gallery.fetchPage), avoiding the async race where
      // get().currentCategory could have moved on to another category.
      setComponents: (components) => set({ components, componentsLoaded: true }),
      categoryCounts: {},
      // Merge (not replace) so seeding one category's count doesn't wipe others.
      setCategoryCounts: (counts) =>
        set((s) => ({ categoryCounts: { ...s.categoryCounts, ...counts } })),
      addComponent: (component) =>
        set((s) => {
          const next = [component, ...s.components];
          const dbCat = component.category;
          const counts = dbCat
            ? { ...s.categoryCounts, [dbCat]: (s.categoryCounts[dbCat] ?? 0) + 1 }
            : s.categoryCounts;
          // persist so the upload survives a refresh
          const total = counts[CAT_SLUG_TO_DB[s.currentCategory]];
          writeComponentsCache(s.currentCategory, next, total);
          return {
            components: next,
            categoryCounts: counts,
            componentsVersion: s.componentsVersion + 1,
          };
        }),
      removeComponent: (id) =>
        set((s) => {
          const removed = s.components.find((c) => c.id === id);
          const next = s.components.filter((c) => c.id !== id);
          const dbCat = removed?.category;
          const counts = dbCat
            ? {
                ...s.categoryCounts,
                [dbCat]: Math.max(0, (s.categoryCounts[dbCat] ?? 0) - 1),
              }
            : s.categoryCounts;
          const total = counts[CAT_SLUG_TO_DB[s.currentCategory]];
          writeComponentsCache(s.currentCategory, next, total);
          return {
            components: next,
            categoryCounts: counts,
            componentsVersion: s.componentsVersion + 1,
          };
        }),
      clearComponents: () => set({ components: [], componentsLoaded: false }),
      hasMore: true,
      currentPage: 0,
      isFetching: false,
      isFetchingMore: false,
      setHasMore: (val) => set({ hasMore: val }),
      setCurrentPage: (val) => set({ currentPage: val }),
      setIsFetching: (val) => set({ isFetching: val }),
      setIsFetchingMore: (val) => set({ isFetchingMore: val }),
      // Append the next page, skipping ids already present. Does NOT touch the
      // localStorage cache — only page 0 (via setComponents) is cached, so the
      // cache stays small and first paint stays fast.
      appendComponents: (items) =>
        set((s) => {
          const seen = new Set(s.components.map((c) => c.id));
          const merged = [
            ...s.components,
            ...items.filter((c) => !seen.has(c.id)),
          ];
          return { components: merged, componentsLoaded: true };
        }),
    }),
    {
      name: "auth-store",
      // Only profile + isAdmin persist; transient state always starts fresh.
      partialize: (state) => ({
        profile: state.profile,
        isAdmin: state.isAdmin,
      }),
    },
  ),
);
