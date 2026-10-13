import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

// One copy, enforced server-side. The client can't see the real request IP (and
// a client-passed IP could be spoofed), so the copy goes through here: we resolve
// the user from the verified cookie session, read the IP from the proxy headers,
// and call the service-role record_copy_ip RPC which atomically applies the
// per-user (10/50) AND per-IP (30) daily limits and returns figma_data on
// success — the only end-user path to figma_data, so the limits can't be skipped.
//
// canvas: true is "Copy code": same limits, same copy_events row, but figma_data
// is parked in canvas_handoffs and only the handoff id comes back. The browser
// opens Canvas with that id; Canvas pulls the data server-to-server.
export async function POST(req: Request) {
  let componentId: string | null = null;
  let canvas = false;
  try {
    const body = await req.json();
    componentId = body?.componentId ?? null;
    canvas = body?.canvas === true;
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
  if (!canvas || !data.success) return NextResponse.json(data);
  // Link-only components (figma_url, no clipboard data) have nothing to convert.
  if (!data.figma_data) {
    return NextResponse.json({ success: false, reason: "no_figma_data" });
  }

  // ponytail: expired rows are swept on the next handoff, not by a cron.
  await admin
    .from("canvas_handoffs")
    .delete()
    .lt("created_at", new Date(Date.now() - 60 * 60_000).toISOString());
  const { data: handoff, error: hErr } = await admin
    .from("canvas_handoffs")
    .insert({ figma_data: data.figma_data })
    .select("id")
    .single();
  if (hErr || !handoff) {
    console.error("[api/copy] canvas_handoffs:", hErr?.message);
    return NextResponse.json(
      { success: false, reason: "error" },
      { status: 500 },
    );
  }
  return NextResponse.json({
    success: true,
    copies_today: data.copies_today,
    canvas_url: `${process.env.NEXT_PUBLIC_CANVAS_URL}/blocks?h=${handoff.id}`,
  });
}
