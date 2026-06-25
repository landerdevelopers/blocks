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
import { Textarea } from "@/components/ui/textarea";

const DAILY_LIMIT = 10;

// Suggest-improvements quota: 3 submissions per ISO week, tracked per browser in
// localStorage. The button hides once used up and reappears the next week.
const SUGGEST_WEEKLY_LIMIT = 3;
const SUGGEST_QUOTA_KEY = "suggest_quota";

function currentWeekKey(): string {
  const d = new Date();
  const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const day = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - day); // ISO: Thursday of this week
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const week = Math.ceil(
    ((date.getTime() - yearStart.getTime()) / 86400000 + 1) / 7,
  );
  return `${date.getUTCFullYear()}-W${week}`;
}

// Submissions used in the CURRENT week (0 if the stored week has rolled over).
function readSuggestUsed(): number {
  if (typeof window === "undefined") return 0;
  try {
    const raw = localStorage.getItem(SUGGEST_QUOTA_KEY);
    if (!raw) return 0;
    const { week, count } = JSON.parse(raw);
    return week === currentWeekKey() ? (count ?? 0) : 0;
  } catch {
    return 0;
  }
}

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
  const [showSuggest, setShowSuggest] = useState(false);
  const [suggestText, setSuggestText] = useState("");
  const [suggestSubmitting, setSuggestSubmitting] = useState(false);
  const [showSuggestSuccess, setShowSuggestSuccess] = useState(false);
  // Weekly quota for the suggest button (read from localStorage after mount to
  // avoid a hydration mismatch on the button's visibility).
  const [suggestUsed, setSuggestUsed] = useState(0);
  const [suggestMounted, setSuggestMounted] = useState(false);
  useEffect(() => {
    setSuggestMounted(true);
    setSuggestUsed(readSuggestUsed());
  }, []);
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

  // One copy: counted + limit-enforced server-side via the record_copy RPC
  // (security definer). It also RETURNS figma_data when the copy is allowed —
  // the only end-user path to it, since the column isn't directly selectable.
  // So the limit can't be bypassed by fetching figma_data from devtools.
  const tryCopy = async (
    componentId: string,
  ): Promise<{ allowed: boolean; figmaData: string | null }> => {
    const supabase = createClient();
    const { data, error } = await supabase.rpc("record_copy", {
      component_id: componentId,
    });
    if (error || !data) {
      console.error("[copy] record_copy:", error?.message);
      return { allowed: false, figmaData: null };
    }
    if (!data.success) {
      if (data.reason === "limit_reached") setShowLimit(true);
      return { allowed: false, figmaData: null };
    }
    setUsed(data.copies_today);
    if (profile) {
      setProfile({
        ...profile,
        copies_today: data.copies_today,
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

  // Save an improvement suggestion to the DB, then close the modal.
  const submitSuggestion = async () => {
    const message = suggestText.trim();
    if (!message || suggestSubmitting) return;
    if (suggestUsed >= SUGGEST_WEEKLY_LIMIT) return; // weekly quota exhausted
    setSuggestSubmitting(true);
    const { error } = await createClient()
      .from("improvements")
      .insert({ message, user_id: profile?.id ?? null });
    setSuggestSubmitting(false);
    if (error) {
      console.error("[suggest] insert:", error.message);
      return;
    }
    // Count this submission against the weekly quota (per browser).
    const week = currentWeekKey();
    let next = 1;
    try {
      const raw = localStorage.getItem(SUGGEST_QUOTA_KEY);
      const parsed = raw ? JSON.parse(raw) : null;
      next = parsed && parsed.week === week ? (parsed.count ?? 0) + 1 : 1;
      localStorage.setItem(
        SUGGEST_QUOTA_KEY,
        JSON.stringify({ week, count: next }),
      );
    } catch {
      // ignore storage errors
    }
    setSuggestUsed(next);
    setShowSuggest(false);
    setSuggestText("");
    setShowSuggestSuccess(true);
  };

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
      />

      {/* Floating bottom-right action — logged-in only. Hidden once the weekly
          quota (3/week) is used up, reappears next week. Gated on
          `suggestMounted` to avoid a hydration mismatch (localStorage is
          client-only). */}
      {loggedIn && suggestMounted && suggestUsed < SUGGEST_WEEKLY_LIMIT && (
        <button
          type="button"
          onClick={() => setShowSuggest(true)}
          className="fixed bottom-6 right-8 z-50 flex cursor-pointer items-center gap-2 rounded-[10px] border-[1.5px] border-white bg-[#e6e6e6] px-3.5 py-2.5 text-[16px] tracking-[-0.03em] text-[#474747] shadow-[0px_0px_0px_1px_rgba(0,0,0,0.06),0px_1px_2px_rgba(0,0,0,0.1),0px_8px_24px_rgba(0,0,0,0.12)] ring-1 ring-black/5 transition-[background-color,color,box-shadow] hover:bg-[#f0f0f0] hover:text-[#202020] hover:shadow-[0px_0px_0px_1px_rgba(0,0,0,0.08),0px_2px_4px_rgba(0,0,0,0.12),0px_12px_32px_rgba(0,0,0,0.16)]"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/bulb.svg" alt="" className="size-[18px] shrink-0" />
          Suggest Improvements
        </button>
      )}

      {/* Suggest Improvements modal */}
      {showSuggest && (
        <div
          onClick={() => setShowSuggest(false)}
          className="fixed inset-0 z-[1000] flex items-center justify-center bg-black/40 p-4"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="flex h-[260px] w-[440px] max-w-full flex-col gap-5 rounded-2xl bg-white p-6 shadow-[0px_12px_40px_rgba(0,0,0,0.2)]"
          >
            <div className="flex flex-col gap-1">
              <div className="flex items-start justify-between">
                <h2 className="text-[16px] font-medium tracking-[-0.03em] text-[#09090b]">
                  Suggest Improvements
                </h2>
                <button
                  type="button"
                  onClick={() => setShowSuggest(false)}
                  aria-label="Close"
                  className="cursor-pointer text-[#71717b] transition-colors hover:text-[#09090b]"
                >
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
                    <line x1="6" y1="6" x2="18" y2="18" />
                    <line x1="18" y1="6" x2="6" y2="18" />
                  </svg>
                </button>
              </div>
              <p className="text-[14px] tracking-[-0.03em] text-[#71717b]">
                Have an idea to make Blocks better? Share it with us.
              </p>
            </div>

            <Textarea
              value={suggestText}
              onChange={(e) => setSuggestText(e.target.value)}
              placeholder="Tell us what we can do better…"
              className="flex-1"
            />

            <div className="flex justify-end gap-3">
              <button
                type="button"
                onClick={() => setShowSuggest(false)}
                className="cursor-pointer rounded-[10px] border border-[#e7e9ee] px-4 py-2 text-[14px] tracking-[-0.03em] text-[#52525b] transition-colors hover:bg-[#fafafa]"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={submitSuggestion}
                disabled={suggestSubmitting || !suggestText.trim()}
                className="cursor-pointer rounded-[10px] bg-[#2974ff] px-4 py-2 text-[14px] tracking-[-0.03em] text-white transition-colors hover:bg-[#1f63e6] disabled:cursor-not-allowed disabled:opacity-50"
              >
                {suggestSubmitting ? "Submitting…" : "Submit"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Suggestion submitted — success modal */}
      {showSuggestSuccess && (
        <div
          onClick={() => setShowSuggestSuccess(false)}
          className="fixed inset-0 z-[1000] flex items-center justify-center bg-black/40 p-4"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="flex h-fit w-[440px] max-w-full flex-col items-center rounded-2xl bg-white p-10 shadow-[0px_12px_40px_rgba(0,0,0,0.2)]"
          >
            <div className="flex size-12 items-center justify-center rounded-[10px] bg-[#e3f7ec]">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/feedtick.svg" alt="" className="size-6" />
            </div>
            <div className="mt-4 flex flex-col items-center gap-1 text-center">
              <h2 className="text-[18px] font-medium tracking-[-0.03em] text-[#09090b]">
                Thanks for Helping Us Improve
              </h2>
              <p className="text-[16px] tracking-[-0.03em] text-[#71717b]">
                Your suggestion has been submitted successfully. Your feedback shapes great features.
              </p>
            </div>
            <button
              type="button"
              onClick={() => setShowSuggestSuccess(false)}
              className="mt-[24px] w-full cursor-pointer rounded-[10px] bg-[#2974ff] px-4 py-2 text-[16px] font-medium tracking-[-0.03em] text-white transition-colors hover:bg-[#1f63e6]"
            >
              Done
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
