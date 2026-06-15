"use client";

import { useEffect } from "react";
import { createClient } from "@/lib/supabase/client";
import { useAuthStore, type Profile } from "@/store/authStore";
import { todayIST } from "@/lib/ist";
import OnboardingModal from "./OnboardingModal";

export default function AuthProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const setProfile = useAuthStore((s) => s.setProfile);
  const setEmail = useAuthStore((s) => s.setEmail);
  const setAuthLoading = useAuthStore((s) => s.setAuthLoading);
  const setShowOnboarding = useAuthStore((s) => s.setShowOnboarding);
  const showOnboarding = useAuthStore((s) => s.showOnboarding);

  useEffect(() => {
    const supabase = createClient();

    const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

    // Fetch the profile row for a signed-in user and update the store.
    // Magic-link users have a null full_name on first login → onboarding.
    // Google OAuth users already have full_name (set by the DB trigger) → skip.
    const loadProfile = async (userId: string) => {
      // The DB trigger may not have inserted the row yet — retry a few times.
      for (let attempt = 0; attempt < 3; attempt++) {
        const { data } = await supabase
          .from("profiles")
          .select("*")
          .eq("id", userId)
          .single();
        if (data) {
          const profile = data as Profile;
          setProfile(profile);
          if (!profile.full_name) setShowOnboarding(true);
          return;
        }
        await sleep(1000);
      }

      // Still missing after retries → create it ourselves, then onboard.
      const { data: created } = await supabase
        .from("profiles")
        .upsert({ id: userId, full_name: null })
        .select("*")
        .single();
      if (created) setProfile(created as Profile);
      setShowOnboarding(true);
    };

    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      // First resolution of auth state — unblocks the homepage gate.
      setAuthLoading(false);
      if (session?.user) {
        setEmail(session.user.email ?? null);
        loadProfile(session.user.id);
        // Log a login on an actual sign-in (not INITIAL_SESSION / refresh).
        // Fire-and-forget — analytics-only, must never block auth. Upsert with
        // ignoreDuplicates → at most one row per user per IST day (dedup via the
        // unique index on (user_id, date)). IST date matches copy_events.date.
        if (event === "SIGNED_IN") {
          supabase
            .from("login_events")
            .upsert(
              { user_id: session.user.id, date: todayIST() },
              { onConflict: "user_id,date", ignoreDuplicates: true },
            )
            .then(() => {});
        }
      } else {
        // Never close onboarding from here — only the modal closes itself
        // after a successful submit.
        setProfile(null);
        setEmail(null);
      }
    });

    return () => sub.subscription.unsubscribe();
  }, [setProfile, setEmail, setAuthLoading, setShowOnboarding]);

  return (
    <>
      {children}
      {showOnboarding && <OnboardingModal />}
    </>
  );
}
