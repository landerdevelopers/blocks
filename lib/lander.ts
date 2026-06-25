// Single source of truth for the "Lander Studio" brand identity. Admin uploads
// have no real creator profile, so everywhere they surface — the lightbox creator
// card (Gallery) and the sidebar creator entry (Sidebar) — they render as this
// one fixed agency card. Keep socials/bio here so the two never drift.

// Sentinel creator id for the Lander Studio entry. Not a real profile id; the
// gallery + color search recognize it and scope to admin uploads.
export const LANDER_ID = "lander-studio";

export const LANDER_BRAND = {
  display_name: "Lander Studio",
  avatar_url: "/Lander_black.png",
  bio: "Design agency crafting standout websites, brands, and product experiences.",
  x_handle: "praha37v",
  instagram_handle: null as string | null,
  // Full company URL (not an /in/ handle) — consumers must handle both.
  linkedin_handle: "https://www.linkedin.com/company/lander-studio/",
  website_url: "https://lander.studio",
  cta_url: "https://lander.studio/booking",
};
