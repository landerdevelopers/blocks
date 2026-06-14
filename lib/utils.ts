// Swap a Cloudflare Images "/public" delivery variant for the smaller
// "/thumbnail" variant (600px) used by gallery grid cards — ~4x smaller files.
// No-op for non-Cloudflare URLs. Keep "/public" for the full-size lightbox.
export function cloudflareThumb(url: string): string {
  if (!url || !url.includes("imagedelivery.net")) return url;
  return url
    .replace(/\/public$/, "/thumbnail")
    .replace(/\/public\//, "/thumbnail/");
}

// Swap "/public" for a high-quality flexible variant used by the lightbox —
// full-size, near-lossless, auto format (AVIF/WebP). scale-down never upscales,
// so smaller originals stay native. Requires Flexible Variants enabled on the
// Cloudflare Images account. No-op for non-Cloudflare URLs.
export function cloudflareFull(url: string): string {
  if (!url || !url.includes("imagedelivery.net")) return url;
  const params = "w=2560,q=95,fit=scale-down,f=auto";
  return url
    .replace(/\/public$/, `/${params}`)
    .replace(/\/public\//, `/${params}/`);
}

// Convert a "#RRGGBB" hex string to HSL (h 0-360, s/l 0-100).
// Used at upload time (precompute) and by client-side color search.
export function hexToHsl(hex: string): { h: number; s: number; l: number } {
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  const max = Math.max(r, g, b),
    min = Math.min(r, g, b);
  let h = 0,
    s = 0;
  const l = (max + min) / 2;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r:
        h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
        break;
      case g:
        h = ((b - r) / d + 2) / 6;
        break;
      case b:
        h = ((r - g) / d + 4) / 6;
        break;
    }
  }
  return {
    h: Math.round(h * 360),
    s: Math.round(s * 100),
    l: Math.round(l * 100),
  };
}
