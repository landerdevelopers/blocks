"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import Sidebar from "./components/Sidebar";
import Gallery from "./components/Gallery";
import LoginModal from "./components/LoginModal";
import AccountModal from "./components/AccountModal";
import LimitModal from "./components/LimitModal";
import { createClient } from "@/lib/supabase/client";
import { useAuthStore, type Profile } from "@/store/authStore";
import { todayIST } from "@/lib/ist";

const DAILY_LIMIT = 10;

// A component row as returned by the search_by_color RPC (full row incl colors).
type ColorRow = {
  id: string;
  category: string | null;
  section: string | null;
  filters: string[] | null;
  figma_url: string | null;
  preview_url: string | null;
  colors: { hex: string; pct: number | null }[] | null;
};

// Best pct among a component's colors that match `hex` within RGB tolerance 30.
function matchedPct(
  colors: { hex: string; pct: number | null }[] | null,
  hex: string,
): number {
  const parse = (h: string) => {
    const m = /^#?([0-9a-fA-F]{6})$/.exec(h);
    if (!m) return null;
    const int = parseInt(m[1], 16);
    return [(int >> 16) & 255, (int >> 8) & 255, int & 255] as const;
  };
  const target = parse(hex);
  if (!target) return 0;
  let best = 0;
  for (const c of colors ?? []) {
    const rgb = parse(c.hex);
    if (!rgb) continue;
    if (
      Math.abs(rgb[0] - target[0]) <= 30 &&
      Math.abs(rgb[1] - target[1]) <= 30 &&
      Math.abs(rgb[2] - target[2]) <= 30
    ) {
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

  const [cols, setCols] = useState(3);
  const [showLogin, setShowLogin] = useState(false);
  const [loginNotice, setLoginNotice] = useState(false);
  const [showAccount, setShowAccount] = useState(false);
  const [used, setUsed] = useState(0);
  const [showLimit, setShowLimit] = useState(false);
  // Active sidebar selection — drives which components the gallery shows.
  const [activeCategory, setActiveCategory] = useState<string | null>(null);
  const [activeFilters, setActiveFilters] = useState<string[]>([]);

  // Color search — overrides the normal gallery list when active.
  const [colorSearchActive, setColorSearchActive] = useState(false);
  const [colorSearchLoading, setColorSearchLoading] = useState(false);
  const [colorSearchResults, setColorSearchResults] = useState<
    ColorRow[] | null
  >(null);

  const runColorSearch = async (hexes: string[]) => {
    setColorSearchActive(true);
    setColorSearchLoading(true);
    const supabase = createClient();
    const picked = hexes.slice(0, 2);
    const lists = await Promise.all(
      picked.map((h) =>
        supabase.rpc("search_by_color", { search_hex: h, tolerance: 30 }),
      ),
    );
    const arrays = lists.map((r) => (r.data as ColorRow[] | null) ?? []);

    let result: ColorRow[];
    if (arrays.length <= 1) {
      result = arrays[0] ?? [];
    } else {
      // Keep components present in BOTH results; sort by average matched pct.
      const [a, b] = arrays;
      const bIds = new Set(b.map((c) => c.id));
      result = a
        .filter((c) => bIds.has(c.id))
        .map((c) => ({
          c,
          avg:
            (matchedPct(c.colors, picked[0]) +
              matchedPct(c.colors, picked[1])) /
            2,
        }))
        .sort((x, y) => y.avg - x.avg)
        .map((x) => x.c);
    }
    setColorSearchResults(result);
    setColorSearchLoading(false);
  };

  const clearColorSearch = () => {
    setColorSearchActive(false);
    setColorSearchResults(null);
    setColorSearchLoading(false);
  };

  // notice = true when login was triggered by a copy attempt while logged out.
  const openLogin = (notice: boolean) => {
    setLoginNotice(notice);
    setShowLogin(true);
  };

  // One copy: count it, or show the limit popup once exhausted. Returns whether the copy is allowed.
  const tryCopy = () => {
    if (used >= DAILY_LIMIT) {
      setShowLimit(true);
      return false;
    }
    setUsed(used + 1);
    return true;
  };

  const logout = async () => {
    setShowAccount(false);
    await createClient().auth.signOut();
    setProfile(null);
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
          // 6-col layout is logos-only — clamp back when leaving.
          if (id !== "logos" && cols > 5) setCols(5);
        }}
        maxCols={activeCategory === "logos" ? 6 : 5}
        onColorSearch={runColorSearch}
        onColorClear={clearColorSearch}
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
