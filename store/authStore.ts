import { create } from "zustand";
import { persist } from "zustand/middleware";
import { writeComponentsCache } from "@/lib/componentsCache";

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

// Minimal component shape the gallery renders.
export type GalleryComponent = {
  id: string;
  category: string | null;
  section: string | null;
  filters: string[] | null;
  figma_url: string | null;
  preview_url: string | null;
  aspect_ratio: number | null;
};

type AuthState = {
  profile: Profile | null;
  isAdmin: boolean;
  email: string | null; // from the auth user (profiles has no email column)
  setProfile: (profile: Profile | null) => void;
  setEmail: (email: string | null) => void;
  // True until the first onAuthStateChange resolves (used to gate the flash).
  authLoading: boolean;
  setAuthLoading: (loading: boolean) => void;
  showOnboarding: boolean;
  setShowOnboarding: (show: boolean) => void;
  // Shared gallery list — kept in sync so uploads appear instantly.
  components: GalleryComponent[];
  componentsLoaded: boolean;
  setComponents: (components: GalleryComponent[]) => void;
  addComponent: (component: GalleryComponent) => void;
};

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      profile: null,
      isAdmin: false,
      email: null,
      // Keep isAdmin in sync whenever the profile changes.
      setProfile: (profile) =>
        set({ profile, isAdmin: profile?.role === "admin" }),
      setEmail: (email) => set({ email }),
      authLoading: true,
      setAuthLoading: (loading) => set({ authLoading: loading }),
      showOnboarding: false,
      setShowOnboarding: (show) => set({ showOnboarding: show }),
      components: [],
      componentsLoaded: false,
      setComponents: (components) => {
        writeComponentsCache(components);
        set({ components, componentsLoaded: true });
      },
      addComponent: (component) =>
        set((s) => {
          const next = [component, ...s.components];
          writeComponentsCache(next); // persist so the upload survives a refresh
          return { components: next };
        }),
    }),
    {
      name: "auth-store",
      // Only profile + isAdmin persist; transient state always starts fresh.
      partialize: (state) => ({
        profile: state.profile,
        isAdmin: state.isAdmin,
      }),
    },
  ),
);
