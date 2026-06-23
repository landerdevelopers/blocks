"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useAuthStore, type Profile } from "@/store/authStore";
import { todayIST } from "@/lib/ist";
import OnboardingModal from "./OnboardingModal";
import CreatorUsernameModal from "./CreatorUsernameModal";

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
  const profile = useAuthStore((s) => s.profile);
  const setPendingCreatorApp = useAuthStore((s) => s.setPendingCreatorApp);
  const setWasCreator = useAuthStore((s) => s.setWasCreator);
  const setCreatorRejectedRecently = useAuthStore(
    (s) => s.setCreatorRejectedRecently,
  );

  // Approved creators who haven't picked a handle yet get the forced username
  // modal — but only after name onboarding (if any) is done. The signal is an
  // APPROVED application + no handle, not the role: a normal approval flips role
  // to 'creator' (covered synchronously below), but an approved ADMIN keeps
  // role 'admin' (we never demote admins), so we confirm their approved
  // application asynchronously. The `baseNeeds` guard means once they pick a
  // handle (creator_onboarded → true), the modal closes regardless of the
  // async flag, so no reset is needed.
  const baseNeeds =
    !showOnboarding &&
    !!profile &&
    !profile.creator_onboarded &&
    !profile.username;

  // Normal approved creators — known from the role alone, no query needed.
  const directNeeds = baseNeeds && profile?.role === "creator";

  // Admins who applied and got approved — verified via an approved application.
  const [adminApproved, setAdminApproved] = useState(false);
  useEffect(() => {
    if (!baseNeeds || profile?.role !== "admin" || !profile?.id) return;
    let active = true;
    createClient()
      .from("creator_applications")
      .select("id")
      .eq("user_id", profile.id)
      .eq("status", "approved")
      .limit(1)
      .then(({ data }) => {
        if (active) setAdminApproved(!!data?.length);
      });
    return () => {
      active = false;
    };
  }, [baseNeeds, profile?.role, profile?.id]);

  const needsCreatorUsername =
    directNeeds || (baseNeeds && profile?.role === "admin" && adminApproved);

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
      // ignoreDuplicates → ON CONFLICT DO NOTHING, so a row that appears mid-race
      // can't push this into a DO-UPDATE that would need UPDATE on `id` (which
      // the column-scoped grant withholds → "permission denied for table
      // profiles"). Pure insert path; no id is ever updated here.
      const { data: created } = await supabase
        .from("profiles")
        .upsert({ id: userId, full_name: null }, { ignoreDuplicates: true })
        .select("*")
        .maybeSingle();
      if (created) setProfile(created as Profile);
      setShowOnboarding(true);
    };

    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      // First resolution of auth state — unblocks the homepage gate.
      setAuthLoading(false);
      if (session?.user) {
        setEmail(session.user.email ?? null);
        loadProfile(session.user.id);
        // Prefetch the application flags so the "Become a Creator" CTA (account
        // modal + sidebar) renders instantly, not 1-2s after open. One read for
        // both: pending hides the CTA while in review; approved hides it for an
        // existing/revoked creator (so a revoked creator isn't re-prompted).
        supabase
          .from("creator_applications")
          .select("status, reviewed_at")
          .eq("user_id", session.user.id)
          .then(({ data }) => {
            const rows =
              (data as { status: string; reviewed_at: string | null }[] | null) ??
              [];
            setPendingCreatorApp(rows.some((r) => r.status === "pending"));
            setWasCreator(rows.some((r) => r.status === "approved"));
            // Rejected within the last 7 days → still in cooldown.
            const weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
            setCreatorRejectedRecently(
              rows.some(
                (r) =>
                  r.status === "rejected" &&
                  !!r.reviewed_at &&
                  new Date(r.reviewed_at).getTime() > weekAgo,
              ),
            );
          });
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
        setPendingCreatorApp(null);
        setWasCreator(null);
        setCreatorRejectedRecently(null);
      }
    });

    return () => sub.subscription.unsubscribe();
  }, [
    setProfile,
    setEmail,
    setAuthLoading,
    setShowOnboarding,
    setPendingCreatorApp,
    setWasCreator,
    setCreatorRejectedRecently,
  ]);

  return (
    <>
      {children}
      {showOnboarding && <OnboardingModal />}
      {needsCreatorUsername && <CreatorUsernameModal />}
    </>
  );
}
