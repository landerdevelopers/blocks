import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";

// Send a magic-link, but reject disposable / temp-mail domains first so we never
// email a throwaway address (the signup trigger is the hard block; this is the
// UX layer + saves the email). One indexed PK lookup, so it's effectively free.
export async function POST(req: Request) {
  let email = "";
  try {
    email = ((await req.json())?.email ?? "").trim().toLowerCase();
  } catch {
    // fall through to validation below
  }
  const at = email.indexOf("@");
  if (!email || at < 1 || at === email.length - 1) {
    return NextResponse.json({ error: "Enter a valid email." }, { status: 400 });
  }
  const domain = email.slice(at + 1);

  const admin = createAdminClient();
  const { data: bad } = await admin
    .from("disposable_domains")
    .select("domain")
    .eq("domain", domain)
    .maybeSingle();
  if (bad) {
    return NextResponse.json(
      {
        error:
          "Disposable email addresses aren't allowed.",
      },
      { status: 400 },
    );
  }

  const origin =
    req.headers.get("origin") ?? process.env.NEXT_PUBLIC_SITE_URL ?? "";
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: { emailRedirectTo: `${origin}/auth/callback` },
  });
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
  return NextResponse.json({ ok: true });
}
