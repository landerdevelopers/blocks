// Seeder for public.disposable_domains. Fetches the comprehensive, frequently
// updated `disposable/disposable-email-domains` blocklist (covers temp-mail
// domains the smaller npm list misses, e.g. minitts.net) and upserts every
// domain. The signup trigger (handle_new_user) and the /api/magic-link route
// read this table to block temp-mail signups. Re-run anytime to refresh.
//
// Run:  node --env-file=.env.local scripts/seed-disposable-domains.mjs
//
// Needs NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY in the env file.

import { createClient } from "@supabase/supabase-js";

// Plain-text lists, one domain per line. Both come from the `disposable`
// project; merged + deduped so coverage is the union.
const SOURCES = [
  "https://raw.githubusercontent.com/disposable/disposable-email-domains/master/domains.txt",
  "https://raw.githubusercontent.com/disposable/disposable-email-domains/master/wildcard.txt",
];

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error(
    "Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY. " +
      "Run with: node --env-file=.env.local scripts/seed-disposable-domains.mjs",
  );
  process.exit(1);
}

const set = new Set();
for (const src of SOURCES) {
  console.log(`Fetching ${src}…`);
  const res = await fetch(src);
  if (!res.ok) {
    console.error(`  failed (${res.status}) — skipping`);
    continue;
  }
  const text = await res.text();
  for (const line of text.split("\n")) {
    const d = line.trim().toLowerCase().replace(/^\*\./, "");
    if (d && !d.startsWith("#") && d.includes(".")) set.add(d);
  }
}

const rows = [...set].map((domain) => ({ domain }));
console.log(`Seeding ${rows.length} disposable domains…`);

const admin = createClient(url, key, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const CHUNK = 1000;
for (let i = 0; i < rows.length; i += CHUNK) {
  const batch = rows.slice(i, i + CHUNK);
  const { error } = await admin
    .from("disposable_domains")
    .upsert(batch, { onConflict: "domain", ignoreDuplicates: true });
  if (error) {
    console.error(`Batch ${i / CHUNK + 1} failed:`, error.message);
    process.exit(1);
  }
  console.log(`  ${Math.min(i + CHUNK, rows.length)}/${rows.length}`);
}

console.log(`Done. minitts.net included: ${set.has("minitts.net")}`);
