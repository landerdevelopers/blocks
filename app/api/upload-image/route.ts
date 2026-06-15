import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";

// Returns a one-time Cloudflare direct-creator-upload URL so the browser can
// POST the image straight to Cloudflare (no server hop). Admin-only; the token
// stays server-only here.
export async function GET() {
  const cookieStore = await cookies();
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: { getAll: () => cookieStore.getAll() } },
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();
  if (profile?.role !== "admin")
    return Response.json({ error: "Forbidden" }, { status: 403 });

  const res = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${process.env.CLOUDFLARE_ACCOUNT_ID}/images/v2/direct_upload`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${process.env.CLOUDFLARE_IMAGES_TOKEN}` },
    },
  );
  const { result } = await res.json();
  return Response.json({ uploadURL: result.uploadURL, id: result.id });
}
