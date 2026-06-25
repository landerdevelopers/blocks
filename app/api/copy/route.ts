import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

// One copy, enforced server-side. The client can't see the real request IP (and
// a client-passed IP could be spoofed), so the copy goes through here: we resolve
// the user from the verified cookie session, read the IP from the proxy headers,
// and call the service-role record_copy_ip RPC which atomically applies the
// per-user (10/50) AND per-IP (30) daily limits and returns figma_data on
// success — the only end-user path to figma_data, so the limits can't be skipped.
export async function POST(req: Request) {
  let componentId: string | null = null;
  try {
    componentId = (await req.json())?.componentId ?? null;
  } catch {
    // fall through to the bad_request below
  }
  if (!componentId) {
    return NextResponse.json(
      { success: false, reason: "bad_request" },
      { status: 400 },
    );
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json(
      { success: false, reason: "unauthenticated" },
      { status: 401 },
    );
  }

  // First hop in x-forwarded-for is the real client (Vercel/host appends its own).
  const ip =
    (req.headers.get("x-forwarded-for") ?? "").split(",")[0]?.trim() ||
    req.headers.get("x-real-ip") ||
    "";

  const admin = createAdminClient();
  const { data, error } = await admin.rpc("record_copy_ip", {
    p_user: user.id,
    p_component: componentId,
    p_ip: ip,
  });
  if (error || !data) {
    console.error("[api/copy] record_copy_ip:", error?.message);
    return NextResponse.json(
      { success: false, reason: "error" },
      { status: 500 },
    );
  }
  return NextResponse.json(data);
}
