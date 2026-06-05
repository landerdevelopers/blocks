"use client";

import { useEffect } from "react";
import { createClient } from "@/lib/supabase/client";
import { useAuthStore, type Profile } from "@/store/authStore";
import OnboardingModal from "./OnboardingModal";

export default function AuthProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const setProfile = useAuthStore((s) => s.setProfile);
  const setShowOnboarding = useAuthStore((s) => s.setShowOnboarding);
  const showOnboarding = useAuthStore((s) => s.showOnboarding);

  useEffect(() => {
    const supabase = createClient();

    // Fetch the profile row for a signed-in user and update the store.
    // Magic-link users have a null full_name on first login → onboarding.
    // Google OAuth users already have full_name (set by the DB trigger) → skip.
    const loadProfile = async (userId: string) => {
      const { data } = await supabase
        .from("profiles")
        .select("*")
        .eq("id", userId)
        .single();

      if (!data) return;
      const profile = data as Profile;
      setProfile(profile);
      if (!profile.full_name) setShowOnboarding(true);
    };

    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session?.user) {
        loadProfile(session.user.id);
      } else {
        setProfile(null);
        setShowOnboarding(false);
      }
    });

    return () => sub.subscription.unsubscribe();
  }, [setProfile, setShowOnboarding]);

  return (
    <>
      {children}
      {showOnboarding && <OnboardingModal />}
    </>
  );
}
