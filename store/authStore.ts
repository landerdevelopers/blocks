import { create } from "zustand";

// Full row from public.profiles.
export type Profile = {
  id: string;
  full_name: string | null;
  avatar_url: string | null;
  role: string;
  copies_today: number;
  last_copy_date: string | null;
  created_at: string;
};

type AuthState = {
  profile: Profile | null;
  setProfile: (profile: Profile | null) => void;
  showOnboarding: boolean;
  setShowOnboarding: (show: boolean) => void;
};

export const useAuthStore = create<AuthState>((set) => ({
  profile: null,
  setProfile: (profile) => set({ profile }),
  showOnboarding: false,
  setShowOnboarding: (show) => set({ showOnboarding: show }),
}));
