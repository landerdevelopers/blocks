"use client";

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import Sidebar from "./components/Sidebar";
import Gallery from "./components/Gallery";
import LoginModal from "./components/LoginModal";
import AccountModal from "./components/AccountModal";
import LimitModal from "./components/LimitModal";
import { createClient } from "@/lib/supabase/client";
import {
  useAuthStore,
  type Profile,
  type GalleryComponent,
} from "@/store/authStore";
import { hexToHsl } from "@/lib/utils";
import { todayIST } from "@/lib/ist";

const DAILY_LIMIT = 10;

type Hsl = { h: number; s: number; l: number };
const HEX6 = /^#[0-9a-fA-F]{6}$/;

const VALID_CATEGORIES = [
  "website",
  "mobile",
  "dashboard",
  "logos",
  "illustrations",
];

// Resolve the initial category from the URL ?category (or default "website").
// Pure + based on the search params (available during SSR for this client
// component) so the server and client render the same category — no flash, no
// hydration mismatch. Category persistence is handled by writing ?category to
// the URL (see the effect below), so no localStorage fallback is needed here.
function resolveCategory(urlCat: string | null): string {
  return urlCat && VALID_CATEGORIES.includes(urlCat) ? urlCat : "website";
}

// Family-aware HSL match: does a component color `el` match the search color `s`?
// Mode is decided from the SEARCH color, mirroring the old search_by_color RPC:
//   dark/light (l<20 or l>80) or gray (s<10) → lightness only; else hue family.
function hslMatch(el: Hsl, s: Hsl): boolean {
  if (s.l < 20 || s.l > 80) return Math.abs(el.l - s.l) <= 15;
  if (s.s < 10) return Math.abs(el.l - s.l) <= 20;
  const hueDist = Math.min(Math.abs(el.h - s.h), 360 - Math.abs(el.h - s.h));
  return (
    hueDist <= 30 && Math.abs(el.s - s.s) <= 55 && Math.abs(el.l - s.l) <= 40
  );
}

// Best pct among a component's colors that match `search`; -1 = no match.
function bestMatchPct(
  colors: { hex: string; pct: number | null }[] | null,
  search: Hsl,
): number {
  let best = -1;
  for (const c of colors ?? []) {
    if (HEX6.test(c.hex) && hslMatch(hexToHsl(c.hex), search)) {
      best = Math.max(best, c.pct ?? 0);
    }
  }
  return best;
}

export default function Home() {
  return (
    <Suspense fallback={<BlankScreen />}>
      <HomeInner />
    </Suspense>
  );
}

// Minimal screen shown while auth resolves on a fresh onboarding redirect —
// prevents any flash of the homepage before the onboarding modal opens.
function BlankScreen() {
  return <div className="h-screen w-full bg-[#f5f5f5]" />;
}

function HomeInner() {
  const profile = useAuthStore((s) => s.profile);
  const setProfile = useAuthStore((s) => s.setProfile);
  const authLoading = useAuthStore((s) => s.authLoading);
  const setShowOnboarding = useAuthStore((s) => s.setShowOnboarding);
  const loggedIn = !!profile;

  // Fresh magic-link login → open onboarding immediately, before any auth event.
  const searchParams = useSearchParams();
  // Initial category from ?category — read from search params (SSR-available)
  // so the server renders the right category from the start (no website flash).
  const startCategory = resolveCategory(searchParams.get("category"));
  const [onboardingRedirect] = useState(
    () => searchParams.get("onboarding") === "true",
  );
  useEffect(() => {
    if (!onboardingRedirect) return;
    setShowOnboarding(true);
    // Strip the param so it doesn't persist on refresh.
    window.history.replaceState(null, "", window.location.pathname);
  }, [onboardingRedirect, setShowOnboarding]);

  const [cols, setCols] = useState(() => {
    if (typeof window === "undefined") return 3;
    // One shared column count everywhere. Logos allows up to 6, the rest cap
    // at 5 — clamp the stored value to the active context's max before paint.
    const cat = startCategory;
    const max = cat === "logos" ? 6 : 5;
    const min = cat === "logos" ? 2 : 1;
    const stored = parseInt(localStorage.getItem("layout_cols") || "3", 10);
    return Math.min(max, Math.max(min, stored));
  });
  const [showLogin, setShowLogin] = useState(false);
  const [loginNotice, setLoginNotice] = useState(false);
  const [showAccount, setShowAccount] = useState(false);
  const [used, setUsed] = useState(0);
  const [showLimit, setShowLimit] = useState(false);
  // Active sidebar selection — drives which components the gallery shows.
  // Persisted so the correct category (and its column count) is known on refresh.
  const [activeCategory, setActiveCategory] = useState<string | null>(
    () => startCategory,
  );
  const [activeFilters, setActiveFilters] = useState<string[]>([]);

  // Color search — overrides the normal gallery list when active. Results come
  // from the server-side search_by_color RPC (full DB), merged across the picked
  // colors, scored by matched pct, and paginated client-side for display.
  const [colorSearchActive, setColorSearchActive] = useState(false);
  const [colorSearchLoading, setColorSearchLoading] = useState(false);
  const [colorSearchPage, setColorSearchPage] = useState(0);
  // Full, scored, sorted RPC results across every category. Narrowed to the
  // active category/section at display time so changing filters is instant.
  const [colorSearchAll, setColorSearchAll] = useState<GalleryComponent[]>([]);

  const COLOR_PAGE_SIZE = 24;

  const CAT_MAP: Record<string, string> = {
    website: "Website",
    mobile: "Mobile Apps",
    dashboard: "Dashboard",
    logos: "Logos",
    illustrations: "Illustrations",
  };

  // Apply the active category + section/theme filters to a component, mirroring
  // the normal gallery's filtering so color results stay in the chosen context.
  const matchesActiveFilters = (c: GalleryComponent): boolean => {
    const dbCat = CAT_MAP[activeCategory ?? "website"];
    if (c.category !== dbCat) return false;
    if (!activeFilters.length) return true;
    if (dbCat === "Logos") {
      return activeFilters.some((f) => (c.filters ?? []).includes(f));
    }
    const tags = activeFilters.filter((f) => !f.startsWith("style:"));
    const themes = activeFilters
      .filter((f) => f.startsWith("style:"))
      .map((f) => f.slice("style:".length));
    if (tags.length && !tags.includes(c.section ?? "")) return false;
    if (themes.length && !themes.some((t) => (c.filters ?? []).includes(t)))
      return false;
    return true;
  };

  // Full results narrowed to the active category/section. The RPC order
  // (matched pct desc) is preserved by filtering in place.
  const colorSearchFiltered = useMemo(
    () =>
      colorSearchActive ? colorSearchAll.filter(matchesActiveFilters) : [],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [colorSearchActive, colorSearchAll, activeCategory, activeFilters],
  );

  // Displayed slice — grows by COLOR_PAGE_SIZE as the user scrolls.
  const colorSearchResults = useMemo(
    () =>
      colorSearchActive
        ? colorSearchFiltered.slice(0, (colorSearchPage + 1) * COLOR_PAGE_SIZE)
        : null,
    [colorSearchActive, colorSearchFiltered, colorSearchPage],
  );
  const colorSearchHasMore =
    colorSearchActive &&
    colorSearchFiltered.length > (colorSearchPage + 1) * COLOR_PAGE_SIZE;

  const loadMoreColorSearch = useCallback(() => {
    setColorSearchPage((p) => p + 1);
  }, []);

  // Run the color search: one search_by_color RPC per picked hex (max 2) in
  // parallel, merge + dedupe by id, then score each component by summed matched
  // pct so ones hitting both colors rank highest.
  const runColorSearch = async (hexes: string[]) => {
    const picked = hexes.slice(0, 2).filter((h) => HEX6.test(h));
    setColorSearchActive(true);
    setColorSearchPage(0);
    if (!picked.length) {
      setColorSearchAll([]);
      return;
    }
    setColorSearchLoading(true);
    const supabase = createClient();
    const responses = await Promise.all(
      picked.map((hex) =>
        supabase.rpc("search_by_color", { search_hex: hex, tolerance: 0 }),
      ),
    );
    const byId = new Map<string, GalleryComponent>();
    for (const { data, error } of responses) {
      if (error) {
        console.error("[color-search] search_by_color:", error.message);
        continue;
      }
      for (const row of (data as GalleryComponent[]) ?? []) {
        if (!byId.has(row.id)) byId.set(row.id, row);
      }
    }
    const searchHsls = picked.map(hexToHsl);
    const scored = [...byId.values()].map((c) => {
      let score = 0;
      for (const sh of searchHsls) {
        const p = bestMatchPct(c.colors, sh);
        if (p >= 0) score += p;
      }
      return { c, score };
    });
    scored.sort((a, b) => b.score - a.score);
    setColorSearchAll(scored.map((x) => x.c));
    setColorSearchLoading(false);
  };

  const clearColorSearch = () => {
    setColorSearchActive(false);
    setColorSearchAll([]);
    setColorSearchPage(0);
    setColorSearchLoading(false);
  };

  // Persist the active category to localStorage and reflect it in the URL
  // (?category=…) without navigation, so refresh/share opens the same category.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const cat = activeCategory ?? "website";
    localStorage.setItem("active_category", cat);
    const params = new URLSearchParams(window.location.search);
    params.set("category", cat);
    window.history.replaceState({}, "", `?${params.toString()}`);
  }, [activeCategory]);

  // Persist the single shared column count to localStorage.
  useEffect(() => {
    if (typeof window === "undefined") return;
    localStorage.setItem("layout_cols", String(cols));
  }, [cols]);

  // notice = true when login was triggered by a copy attempt while logged out.
  const openLogin = (notice: boolean) => {
    setLoginNotice(notice);
    setShowLogin(true);
  };

  // One copy: counted + limit-enforced server-side via the record_copy RPC
  // (security definer). Returns whether the copy is allowed.
  const tryCopy = async (componentId: string) => {
    const supabase = createClient();
    const { data, error } = await supabase.rpc("record_copy", {
      component_id: componentId,
    });
    if (error || !data) {
      console.error("[copy] record_copy:", error?.message);
      return false;
    }
    if (!data.success) {
      if (data.reason === "limit_reached") setShowLimit(true);
      return false;
    }
    setUsed(data.copies_today);
    if (profile) {
      setProfile({
        ...profile,
        copies_today: data.copies_today,
        last_copy_date: todayIST(),
      });
    }
    return true;
  };

  const logout = async () => {
    setShowAccount(false);
    await createClient().auth.signOut();
    setProfile(null);
    // Wipe persisted profile so the next user doesn't see stale data.
    useAuthStore.persist.clearStorage();
  };

  // Seed `used` from the DB so the count survives refreshes. If the profile's
  // last copy was on a previous IST day, it's a new day → start at 0.
  useEffect(() => {
    if (!profile) {
      setUsed(0);
      return;
    }
    setUsed(
      profile.last_copy_date === todayIST() ? profile.copies_today ?? 0 : 0,
    );
  }, [profile]);

  // Watch for the IST day rolling over (midnight): reset the count and refetch
  // the profile so copies_today / last_copy_date resync for the new day.
  useEffect(() => {
    let day = todayIST();
    const id = setInterval(async () => {
      const t = todayIST();
      if (t === day) return;
      day = t;
      setUsed(0);
      if (profile) {
        const { data } = await createClient()
          .from("profiles")
          .select("*")
          .eq("id", profile.id)
          .single();
        if (data) setProfile(data as Profile);
      }
    }, 60000);
    return () => clearInterval(id);
  }, [profile, setProfile]);

  // On a fresh onboarding redirect, keep the homepage hidden until auth resolves
  // (the onboarding modal renders on top via its own portal). Zero flash.
  if (onboardingRedirect && authLoading) {
    return <BlankScreen />;
  }

  return (
    <div className="flex h-screen w-full overflow-hidden bg-[#f5f5f5] pt-4 font-sans">
      <Sidebar
        cols={cols}
        onColsChange={setCols}
        loggedIn={loggedIn}
        onLoginClick={() => openLogin(false)}
        onMenuClick={() => setShowAccount(true)}
        onFilter={(id, filters) => {
          setActiveCategory(id);
          setActiveFilters(filters);
          // Color results are filtered client-side by category/section — reset
          // to the first page so the narrowed set shows from the top.
          setColorSearchPage(0);
          // Logos aren't color-searchable — drop any active color search so the
          // logos list shows instead of stale color results.
          if (id === "logos") clearColorSearch();
          // Column count stays the same across contexts. Non-logos caps at 5,
          // so only clamp down when leaving logos while at 6. Logos has a min
          // of 2, so clamp up when entering it at 1.
          if (id !== "logos") setCols((c) => Math.min(5, c));
          else setCols((c) => Math.max(2, c));
        }}
        maxCols={activeCategory === "logos" ? 6 : 5}
        minCols={activeCategory === "logos" ? 2 : 1}
        onColorSearch={runColorSearch}
        onColorClear={clearColorSearch}
        activeCategory={activeCategory}
      />
      <Gallery
        cols={cols}
        loggedIn={loggedIn}
        onRequireLogin={() => openLogin(true)}
        onCopy={tryCopy}
        category={activeCategory}
        filters={activeFilters}
        colorSearchActive={colorSearchActive}
        colorSearchLoading={colorSearchLoading}
        colorSearchResults={colorSearchResults}
        colorSearchHasMore={colorSearchHasMore}
        onColorSearchLoadMore={loadMoreColorSearch}
      />

      <LoginModal
        open={showLogin}
        onClose={() => setShowLogin(false)}
        notice={loginNotice}
      />

      <AccountModal
        open={showAccount}
        onClose={() => setShowAccount(false)}
        onLogout={logout}
        used={used}
      />

      <LimitModal
        open={showLimit}
        onClose={() => setShowLimit(false)}
        limit={DAILY_LIMIT}
      />
    </div>
  );
}
