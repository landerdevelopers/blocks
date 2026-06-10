"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
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
    const cat = localStorage.getItem("active_category") || "website";
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
  const [activeCategory, setActiveCategory] = useState<string | null>(() => {
    if (typeof window === "undefined") return "website";
    return localStorage.getItem("active_category") || "website";
  });
  const [activeFilters, setActiveFilters] = useState<string[]>([]);

  // Shared in-memory gallery list — color search filters this directly, so it's
  // instant with no network round-trip.
  const components = useAuthStore((s) => s.components);

  // Color search — overrides the normal gallery list when active.
  const [colorSearchActive, setColorSearchActive] = useState(false);
  // Picked colors. Results are derived from these during render (see useMemo).
  const [colorHexes, setColorHexes] = useState<string[]>([]);

  const CAT_MAP: Record<string, string> = {
    website: "Website",
    mobile: "Mobile Apps",
    dashboard: "Dashboard",
    logos: "Logos",
  };

  // Filter the in-memory components by the active category + section filters and
  // the picked color(s). Union over colors (match EITHER), ranked by total
  // matched pct so components hitting both colors rank highest. Pure, no I/O.
  const deriveColorResults = (hexes: string[]): GalleryComponent[] => {
    const picked = hexes.slice(0, 2).filter((h) => HEX6.test(h));
    if (!picked.length) return [];
    const searchHsls = picked.map(hexToHsl);
    const dbCat = CAT_MAP[activeCategory ?? "website"];
    const matchesFilters = (c: GalleryComponent) => {
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

    const scored: { c: GalleryComponent; score: number }[] = [];
    for (const c of components) {
      if (c.category !== dbCat || !matchesFilters(c)) continue;
      let score = 0;
      let hit = false;
      for (const sh of searchHsls) {
        const p = bestMatchPct(c.colors, sh);
        if (p >= 0) {
          hit = true;
          score += p;
        }
      }
      if (hit) scored.push({ c, score });
    }
    return scored.sort((a, b) => b.score - a.score).map((x) => x.c);
  };

  // Results derived during render — instant, and auto-recomputes whenever the
  // picked colors, the active section/filters, or the in-memory components
  // change (e.g. the background fetch populates colors). No effect, no network.
  const colorSearchResults = useMemo(
    () =>
      colorSearchActive && colorHexes.length
        ? deriveColorResults(colorHexes)
        : null,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [colorSearchActive, colorHexes, components, activeCategory, activeFilters],
  );

  const runColorSearch = (hexes: string[]) => {
    setColorHexes(hexes);
    setColorSearchActive(true);
  };

  const clearColorSearch = () => {
    setColorSearchActive(false);
    setColorHexes([]);
  };

  // Persist the active category so it's known synchronously on next load.
  useEffect(() => {
    if (typeof window === "undefined") return;
    localStorage.setItem("active_category", activeCategory ?? "website");
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
        colorSearchResults={colorSearchResults}
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
