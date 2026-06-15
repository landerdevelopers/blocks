"use client";

import {
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
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
import { Textarea } from "@/components/ui/textarea";

const DAILY_LIMIT = 10;

// Beta access — share the link `<site>/?beta=<BETA_TOKEN>`. Anyone who opens it
// is flagged as a beta user (persisted per browser) and unlocks all categories.
// Change the token to invalidate every previously-shared beta link.
const BETA_TOKEN = "blocks-beta-2026";
// localStorage flag: a beta claim is pending (survives the login redirect).
const BETA_PENDING_KEY = "beta_pending";

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
  const isAdmin = useAuthStore((s) => s.isAdmin);
  const loggedIn = !!profile;
  // Admins and beta users get every category; everyone else gets Website only.
  const fullAccess = isAdmin || !!profile?.beta;

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

  // Beta link — opening `?beta=<token>` records a durable "claim" intent and
  // strips the param. The claim is applied to the account below once a profile
  // is available (surviving the login redirect for logged-out visitors).
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (searchParams.get("beta") !== BETA_TOKEN) return;
    localStorage.setItem(BETA_PENDING_KEY, "1");
    const params = new URLSearchParams(window.location.search);
    params.delete("beta");
    const qs = params.toString();
    window.history.replaceState({}, "", qs ? `?${qs}` : window.location.pathname);
  }, [searchParams]);

  // A pending beta claim + a logged-out visitor → prompt login so they can claim.
  useEffect(() => {
    if (authLoading || loggedIn) return;
    if (localStorage.getItem(BETA_PENDING_KEY) === "1") setShowLogin(true);
  }, [authLoading, loggedIn]);

  // Apply a pending beta claim to the account once the profile is available.
  useEffect(() => {
    if (!profile) return;
    if (localStorage.getItem(BETA_PENDING_KEY) !== "1") return;
    if (profile.beta) {
      localStorage.removeItem(BETA_PENDING_KEY);
      return;
    }
    (async () => {
      const { error } = await createClient()
        .from("profiles")
        .update({ beta: true })
        .eq("id", profile.id);
      if (!error) {
        setProfile({ ...profile, beta: true });
        localStorage.removeItem(BETA_PENDING_KEY);
      }
    })();
  }, [profile, setProfile]);

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

  // Color search — overrides the normal gallery list when active. Runs fully
  // client-side over a prefetched pool (no per-search network round-trip).
  const [colorSearchActive, setColorSearchActive] = useState(false);
  const [colorSearchLoading, setColorSearchLoading] = useState(false);
  const [colorSearchPage, setColorSearchPage] = useState(0);
  // Full, scored, sorted results across every category. Narrowed to the active
  // category/section at display time so changing filters is instant.
  const [colorSearchAll, setColorSearchAll] = useState<GalleryComponent[]>([]);

  // Color-search pool: ALL published components (lightweight columns, no
  // figma_data) loaded once and held in a ref — never in the main store. Fetched
  // in the background when the picker opens, so Search is instant.
  const colorSearchPool = useRef<GalleryComponent[]>([]);
  const colorSearchPoolLoaded = useRef(false);
  const colorSearchPoolPromise = useRef<Promise<void> | null>(null);

  const loadColorSearchPool = useCallback(() => {
    if (colorSearchPoolLoaded.current) return Promise.resolve();
    if (colorSearchPoolPromise.current) return colorSearchPoolPromise.current;
    colorSearchPoolPromise.current = (async () => {
      const { data } = await createClient()
        .from("components")
        .select(
          "id, category, section, filters, preview_url, aspect_ratio, colors, colors_hsl",
        )
        .eq("is_published", true)
        .order("created_at", { ascending: false });
      colorSearchPool.current = (data as unknown as GalleryComponent[]) ?? [];
      colorSearchPoolLoaded.current = true;
    })();
    return colorSearchPoolPromise.current;
  }, []);

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

  // Run the color search fully client-side over the prefetched pool: score each
  // component by summed matched pct (union over the picked colors) so ones
  // hitting both rank highest. No network call — instant once the pool is loaded.
  const runColorSearch = async (hexes: string[]) => {
    const picked = hexes.slice(0, 2).filter((h) => HEX6.test(h));
    setColorSearchActive(true);
    setColorSearchPage(0);
    if (!picked.length) {
      setColorSearchAll([]);
      return;
    }
    setColorSearchLoading(true);
    await loadColorSearchPool(); // instant if already prefetched on picker open
    const searchHsls = picked.map(hexToHsl);
    const scored: { c: GalleryComponent; score: number }[] = [];
    for (const c of colorSearchPool.current) {
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

  // Persist the active category to localStorage. Admins also reflect it in the
  // URL (?category=…) for refresh/share; normal users get no category in the URL
  // (any legacy ?category is stripped).
  useEffect(() => {
    if (typeof window === "undefined") return;
    const cat = activeCategory ?? "website";
    localStorage.setItem("active_category", cat);
    const params = new URLSearchParams(window.location.search);
    if (fullAccess) {
      params.set("category", cat);
      window.history.replaceState({}, "", `?${params.toString()}`);
    } else if (params.has("category")) {
      params.delete("category");
      const qs = params.toString();
      window.history.replaceState(
        {},
        "",
        qs ? `?${qs}` : window.location.pathname,
      );
    }
  }, [activeCategory, fullAccess]);

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
        onColorPickerOpen={loadColorSearchPool}
        activeCategory={activeCategory}
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
          colorSearchActive={colorSearchActive}
          colorSearchLoading={colorSearchLoading}
          colorSearchResults={colorSearchResults}
          colorSearchHasMore={colorSearchHasMore}
          onColorSearchLoadMore={loadMoreColorSearch}
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
      />

      <LimitModal
        open={showLimit}
        onClose={() => setShowLimit(false)}
        limit={DAILY_LIMIT}
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
