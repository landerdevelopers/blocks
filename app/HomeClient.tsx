"use client";

import {
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Sidebar, { type SidebarCounts } from "./components/Sidebar";
import { LANDER_ID } from "@/lib/lander";
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
import { todayIST } from "@/lib/ist";
import OriginKitCard from "./components/OriginKitCard";
import OriginKitModal from "./components/OriginKitModal";

const DAILY_LIMIT = 10;

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

export default function HomeClient({
  initialSidebarCounts,
}: {
  initialSidebarCounts: SidebarCounts;
}) {
  return (
    <Suspense fallback={<BlankScreen />}>
      <HomeInner initialSidebarCounts={initialSidebarCounts} />
    </Suspense>
  );
}

// Minimal screen shown while auth resolves on a fresh onboarding redirect —
// prevents any flash of the homepage before the onboarding modal opens.
function BlankScreen() {
  return <div className="h-screen w-full bg-[#f5f5f5]" />;
}

function HomeInner({
  initialSidebarCounts,
}: {
  initialSidebarCounts: SidebarCounts;
}) {
  const profile = useAuthStore((s) => s.profile);
  const setProfile = useAuthStore((s) => s.setProfile);
  const authLoading = useAuthStore((s) => s.authLoading);
  const setShowOnboarding = useAuthStore((s) => s.setShowOnboarding);
  // Session email is set as soon as a session exists — i.e. before the profile
  // finishes loading. Used to detect "already signing in" so the beta-claim
  // flow doesn't flash the login modal during that gap.
  const sessionEmail = useAuthStore((s) => s.email);
  const loggedIn = !!profile;

  // Fresh magic-link login → open onboarding immediately, before any auth event.
  const searchParams = useSearchParams();
  const router = useRouter();
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
    const stored = parseInt(localStorage.getItem("layout_cols") || "4", 10);
    return Math.min(max, Math.max(min, stored));
  });
  const [showLogin, setShowLogin] = useState(false);
  const [loginNotice, setLoginNotice] = useState(false);
  const [showAccount, setShowAccount] = useState(false);
  // When set (from the sidebar "All Creators" popup), the gallery shows only
  // this creator's designs instead of the category list.
  const [creatorId, setCreatorId] = useState<string | null>(null);
  // On refresh with ?creator=<username>, resolving the username → id is async
  // (Sidebar's get_creator). Until it resolves, hold the gallery on skeletons
  // instead of loading the unscoped all-creators list and then snapping to the
  // creator (the flash). Seeded synchronously from the URL so the very first
  // render already knows a creator is pending. Sidebar clears it when the
  // restore resolves (whether the creator was found or not).
  const [creatorRestorePending, setCreatorRestorePending] = useState(
    () => !!searchParams.get("creator"),
  );
  // Admin profile ids backing the "Lander Studio" view (designs uploaded
  // directly by admins). Loaded once, lazily, the first time Lander is picked —
  // both the gallery query and the color-search filter scope to this set.
  const [landerAdminIds, setLanderAdminIds] = useState<string[] | null>(null);
  useEffect(() => {
    if (creatorId !== LANDER_ID || landerAdminIds) return;
    let alive = true;
    createClient()
      .rpc("list_admin_ids")
      .then(({ data }) => {
        if (alive) setLanderAdminIds((data as string[]) ?? []);
      });
    return () => {
      alive = false;
    };
  }, [creatorId, landerAdminIds]);
  const [used, setUsed] = useState(0);
  const [showLimit, setShowLimit] = useState(false);
  // Which cap was hit — drives the LimitModal copy (own daily cap vs per-network).
  const [limitReason, setLimitReason] = useState<"user" | "ip">("user");
  const [showOriginKit, setShowOriginKit] = useState(false);
  // Auto-open the OriginKit promo once on the user's first visit. Logged-in
  // users are tracked server-side (profiles.originkit_seen) so it follows the
  // account across devices; anonymous visitors fall back to a per-browser
  // localStorage flag. Waits for auth to resolve so we don't misfire the anon
  // path while the profile is still loading.
  useEffect(() => {
    if (authLoading) return;
    if (profile) {
      if (profile.originkit_seen) return;
      setShowOriginKit(true);
      // Persist immediately (both server + local store) so it never reopens.
      setProfile({ ...profile, originkit_seen: true });
      createClient()
        .from("profiles")
        .update({ originkit_seen: true })
        .eq("id", profile.id)
        .then(({ error }) => {
          if (error) console.error("[originkit] mark seen:", error.message);
        });
    } else {
      if (localStorage.getItem("originkit_seen")) return;
      localStorage.setItem("originkit_seen", "1");
      setShowOriginKit(true);
    }
  }, [authLoading, profile, setProfile]);
  // Active sidebar selection — drives which components the gallery shows.
  // Persisted so the correct category (and its column count) is known on refresh.
  const [activeCategory, setActiveCategory] = useState<string | null>(
    () => startCategory,
  );
  const [activeFilters, setActiveFilters] = useState<string[]>([]);

  // Color search — overrides the normal gallery list when active. Matching runs
  // SERVER-side (search_by_color RPC) so the whole catalog isn't shipped to the
  // client; the RPC returns only the matching rows, scored + sorted, capped.
  const [colorSearchActive, setColorSearchActive] = useState(false);
  const [colorSearchLoading, setColorSearchLoading] = useState(false);
  const [colorSearchPage, setColorSearchPage] = useState(0);
  // Matching results across every category (from the RPC). Narrowed to the
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
    // Scope to the selected creator (null = all creators → show everyone's),
    // mirroring the normal gallery's uploaded_by filter. Lander Studio matches
    // any admin uploader (the official library) rather than one creator id.
    if (creatorId === LANDER_ID) {
      if (!landerAdminIds?.includes(c.uploaded_by ?? "")) return false;
    } else if (creatorId && c.uploaded_by !== creatorId) {
      return false;
    }
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
    [colorSearchActive, colorSearchAll, activeCategory, activeFilters, creatorId, landerAdminIds],
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

  // Run the color search via the RPC — matching + scoring + sorting happen in
  // Postgres (using precomputed colors_hsl); only the matching rows come back.
  const runColorSearch = async (hexes: string[]) => {
    const picked = hexes.slice(0, 2).filter((h) => HEX6.test(h));
    setColorSearchActive(true);
    setColorSearchPage(0);
    if (!picked.length) {
      setColorSearchAll([]);
      return;
    }
    setColorSearchLoading(true);
    const { data } = await createClient().rpc("search_by_color", {
      search_hexes: picked,
    });
    setColorSearchAll((data as unknown as GalleryComponent[]) ?? []);
    setColorSearchLoading(false);
  };

  const clearColorSearch = () => {
    setColorSearchActive(false);
    setColorSearchAll([]);
    setColorSearchPage(0);
    setColorSearchLoading(false);
  };

  // Persist the active category to localStorage AND reflect it in the URL
  // (?category=…) for everyone, so refresh/share keeps the same category (all
  // categories are public now).
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

  // One copy: counted + limit-enforced server-side via the /api/copy route, which
  // applies BOTH the per-user daily limit AND a per-IP limit (the route sees the
  // real IP; an RPC can't). It RETURNS figma_data only when the copy is allowed —
  // the only end-user path to it — so neither limit can be bypassed from devtools.
  const tryCopy = async (
    componentId: string,
  ): Promise<{ allowed: boolean; figmaData: string | null }> => {
    let data: {
      success?: boolean;
      reason?: string;
      copies_today?: number;
      figma_data?: string | null;
    } | null = null;
    try {
      const res = await fetch("/api/copy", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ componentId }),
      });
      data = await res.json();
    } catch (e) {
      console.error("[copy] /api/copy:", e);
      return { allowed: false, figmaData: null };
    }
    if (!data || !data.success) {
      // Both the per-user and per-IP caps surface the limit modal, with copy
      // tailored to which one was hit.
      if (data?.reason === "limit_reached") {
        setLimitReason("user");
        setShowLimit(true);
      } else if (data?.reason === "ip_limit_reached") {
        setLimitReason("ip");
        setShowLimit(true);
      }
      return { allowed: false, figmaData: null };
    }
    setUsed(data.copies_today ?? 0);
    if (profile) {
      setProfile({
        ...profile,
        copies_today: data.copies_today ?? 0,
        last_copy_date: todayIST(),
      });
    }
    return { allowed: true, figmaData: data.figma_data ?? null };
  };

  const logout = async () => {
    setShowAccount(false);
    await createClient().auth.signOut();
    setProfile(null);
    // Wipe persisted profile so the next user doesn't see stale data.
    useAuthStore.persist.clearStorage();
  };

  // "Become a Creator" — logged-in users go to the Creator Program rules page
  // (which hosts the application modal); logged-out users hit login first.
  const becomeCreator = () => {
    setShowAccount(false);
    if (!profile) {
      openLogin(false);
      return;
    }
    window.open("/creator-rules", "_blank", "noopener,noreferrer");
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
        onBecomeCreator={becomeCreator}
        onCreatorSelect={setCreatorId}
        onCreatorRestoreDone={() => setCreatorRestorePending(false)}
        creatorRestorePending={creatorRestorePending}
        sidebarCounts={initialSidebarCounts}
      />
      {/* Gallery panel — rounded top-left corner; the banner scrolls with the
          gallery content (rendered inside Gallery). */}
      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-tl-[22px] bg-white">
        <Gallery
          cols={cols}
          loggedIn={loggedIn}
          onRequireLogin={() => openLogin(true)}
          onCopy={tryCopy}
          category={activeCategory}
          filters={activeFilters}
          creatorId={creatorId}
          landerAdminIds={landerAdminIds}
          colorSearchActive={colorSearchActive}
          colorSearchLoading={colorSearchLoading}
          colorSearchResults={colorSearchResults}
          colorSearchHasMore={colorSearchHasMore}
          onColorSearchLoadMore={loadMoreColorSearch}
          initialCategoryCounts={initialSidebarCounts.categories}
          creatorRestorePending={creatorRestorePending}
        />
      </div>

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
        onBecomeCreator={becomeCreator}
      />

      <LimitModal
        open={showLimit}
        onClose={() => setShowLimit(false)}
        limit={profile?.role === "creator" ? 50 : DAILY_LIMIT}
        reason={limitReason}
      />

      {/* Floating bottom-right promo — teases OriginKit, opens the full modal. */}
      <OriginKitCard onOpen={() => setShowOriginKit(true)} />

      <OriginKitModal
        open={showOriginKit}
        onClose={() => setShowOriginKit(false)}
      />
    </div>
  );
}
