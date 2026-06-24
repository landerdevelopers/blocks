import { createAdminClient } from "@/lib/supabase/admin";
import CreatorPortalClient, {
  type Creator,
  type Design,
} from "./CreatorPortalClient";

// Always render per-request — the portal's design set is live (new uploads,
// status changes, pins) so a static/cached HTML would go stale.
export const dynamic = "force-dynamic";

// Server shell: fetch the public (visitor) view of the creator + designs
// server-side via the admin client (service role; the RPCs are SECURITY DEFINER
// and key off auth.uid(), which is null here → the live/public set). This data
// ships WITH the HTML so the portal paints instantly — no client RPC round-trip
// for first paint. The client then refetches with the viewer's real identity so
// the owner/admin pick up their private/pending rows.
export default async function CreatorPage({
  params,
}: {
  params: Promise<{ username: string }>;
}) {
  const { username } = await params;
  const supabase = createAdminClient();

  const [{ data: creatorJson }, { data: designRows }] = await Promise.all([
    supabase.rpc("get_creator", { uname: username }),
    supabase.rpc("get_creator_designs", { uname: username }),
  ]);

  return (
    <CreatorPortalClient
      initialCreator={(creatorJson as Creator | null) ?? null}
      initialDesigns={(designRows as Design[] | null) ?? []}
    />
  );
}
