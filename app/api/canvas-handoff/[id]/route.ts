import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

// Canvas (figma-to-code) redeems a "Copy code" handoff here, server-to-server.
// Auth is the shared CANVAS_BRIDGE_SECRET; the row is deleted as it is read, so
// an id works once, and only within 10 minutes of the copy that made it.
const TTL_MS = 10 * 60_000;

const authorized = (req: Request) => {
  const secret = process.env.CANVAS_BRIDGE_SECRET;
  const got = req.headers.get("authorization") ?? "";
  if (!secret) return false;
  const a = Buffer.from(got);
  const b = Buffer.from(`Bearer ${secret}`);
  return a.length === b.length && timingSafeEqual(a, b);
};

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!authorized(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) {
    return NextResponse.json({ error: "bad_request" }, { status: 400 });
  }

  const { data, error } = await createAdminClient()
    .from("canvas_handoffs")
    .delete()
    .eq("id", id)
    .gt("created_at", new Date(Date.now() - TTL_MS).toISOString())
    .select("figma_data")
    .maybeSingle();
  if (error) {
    console.error("[api/canvas-handoff]", error.message);
    return NextResponse.json({ error: "error" }, { status: 500 });
  }
  if (!data) {
    return NextResponse.json({ error: "expired" }, { status: 410 });
  }
  return NextResponse.json(
    { html: data.figma_data },
    { headers: { "cache-control": "no-store" } },
  );
}
