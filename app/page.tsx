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
  aspect_ratio: number | null;
  colors: { hex: string; pct: number | null }[] | null;
};

// Best pct among a component's colors that match `hex` within RGB tolerance 100.
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
      Math.abs(rgb[0] - target[0]) <= 100 &&
      Math.abs(rgb[1] - target[1]) <= 100 &&
      Math.abs(rgb[2] - target[2]) <= 100
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

  // Color search — overrides the normal gallery list when active.
  const [colorSearchActive, setColorSearchActive] = useState(false);
  const [colorSearchLoading, setColorSearchLoading] = useState(false);
  const [colorSearchResults, setColorSearchResults] = useState<
    ColorRow[] | null
  >(null);
  // Remember the picked colors so the search can re-run when the section changes.
  const [colorHexes, setColorHexes] = useState<string[]>([]);

  const runColorSearch = async (hexes: string[]) => {
    setColorHexes(hexes);
    setColorSearchActive(true);
    setColorSearchLoading(true);
    const supabase = createClient();
    const picked = hexes.slice(0, 2);
    // Restrict results to the active section's category.
    const CAT_MAP: Record<string, string> = {
      website: "Website",
      mobile: "Mobile Apps",
      dashboard: "Dashboard",
      logos: "Logos",
    };
    const dbCat = CAT_MAP[activeCategory ?? "website"];
    // Also honor the active section filters, mirroring the gallery's filter rules.
    const matchesFilters = (c: ColorRow) => {
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
    const lists = await Promise.all(
      picked.map((h) =>
        supabase.rpc("search_by_color", { search_hex: h, tolerance: 60 }),
      ),
    );
    const arrays = lists.map((r) =>
      ((r.data as ColorRow[] | null) ?? []).filter(
        (c) => c.category === dbCat && matchesFilters(c),
      ),
    );

    let result: ColorRow[];
    if (arrays.length <= 1) {
      result = arrays[0] ?? [];
    } else {
      // Union: show components matching EITHER color. Dedupe by id, then sort by
      // total matched pct so components hitting both colors rank highest.
      const byId = new Map<string, ColorRow>();
      for (const c of [...arrays[0], ...arrays[1]]) {
        if (!byId.has(c.id)) byId.set(c.id, c);
      }
      result = [...byId.values()]
        .map((c) => ({
          c,
          score:
            matchedPct(c.colors, picked[0]) + matchedPct(c.colors, picked[1]),
        }))
        .sort((x, y) => y.score - x.score)
        .map((x) => x.c);
    }
    setColorSearchResults(result);
    setColorSearchLoading(false);
  };

  const clearColorSearch = () => {
    setColorSearchActive(false);
    setColorSearchResults(null);
    setColorSearchLoading(false);
    setColorHexes([]);
  };

  // Re-run the active color search whenever the section or its filters change,
  // so results reflect the current selection instead of staying stale.
  useEffect(() => {
    if (colorSearchActive && colorHexes.length) runColorSearch(colorHexes);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeCategory, activeFilters.join(",")]);

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
