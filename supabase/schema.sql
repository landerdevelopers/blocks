-- =============================================================================
-- Figma Component Marketplace — complete Supabase schema
-- Paste-ready for the Supabase SQL editor. Idempotent: safe to re-run.
-- =============================================================================

-- gen_random_uuid() ships with Supabase, but ensure pgcrypto just in case.
create extension if not exists pgcrypto;

-- -----------------------------------------------------------------------------
-- Tables
-- -----------------------------------------------------------------------------

create table if not exists public.profiles (
  id           uuid primary key references auth.users (id) on delete cascade,
  full_name    text,
  avatar_url   text,
  role         text        not null default 'user',
  copies_today int         not null default 0,
  last_copy_date date,
  created_at   timestamptz not null default now()
);
-- beta: REMOVED. Every category is now open to all users, so the flag was
-- dropped. (Self-claim relied on the open update grant, which is now locked
-- down — see the column-scoped grants below.)
alter table public.profiles drop column if exists beta;
-- email: mirrored from auth.users so the analytics page can show a user's email
-- without an admin.auth API call per row. Populated by handle_new_user on signup
-- and kept here for existing rows via the backfill below.
alter table public.profiles add column if not exists email text;

create table if not exists public.components (
  id           uuid primary key default gen_random_uuid(),
  category     text check (category in ('Website', 'Mobile Apps', 'Dashboard', 'Logos', 'Illustrations')),
  section      text,
  filters      text[],
  copy_count   int         not null default 0,
  -- figma_url:   the Figma share link for the component/section.
  figma_url    text,
  -- figma_data:  raw Figma clipboard HTML (text/html with <!--StartFragment-->)
  --              so "Copy to Figma" pastes the actual component, not a link.
  figma_data   text,
  -- preview_url: a Cloudflare Images delivery URL for the preview image (no
  --              Supabase Storage bucket is used for previews).
  preview_url  text,
  -- aspect_ratio: width / height of the preview image, used to reserve exact
  --               space (padding-bottom trick) before the image loads.
  aspect_ratio numeric,
  -- Array of objects, e.g. [{"hex": "#3B82F6", "pct": 60}]
  colors       jsonb,
  -- Same array with HSL precomputed at upload time, e.g.
  -- [{"hex": "#3B82F6", "pct": 60, "h": 217, "s": 91, "l": 60}]. Lets
  -- search_by_color skip per-row hex->HSL conversion. Null for rows uploaded
  -- before this column existed (search falls back to on-the-fly conversion).
  colors_hsl   jsonb,
  uploaded_by  uuid references public.profiles (id) on delete set null,
  is_published boolean     not null default true,
  -- featured: pins the component to the top of the gallery (sorted before
  -- created_at). Toggled via the upload/edit form's "Show on top" switch.
  featured     boolean     not null default false,
  -- featured_at: when the component was last pinned to top via the admin arrow.
  -- Most recently pinned sorts first among featured rows. Null = never pinned.
  featured_at  timestamptz,
  created_at   timestamptz not null default now(),
  -- Dashboard and Logos have no section; only Website / Mobile Apps may set one.
  constraint components_section_check
    check (category not in ('Dashboard', 'Logos') or section is null)
);

create table if not exists public.copy_events (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid references public.profiles (id) on delete cascade,
  component_id uuid references public.components (id) on delete cascade,
  copied_at    timestamptz not null default now(),
  date         date        not null default current_date
);

-- One row per successful login, written from the client on the SIGNED_IN auth
-- event. `date` is the login day (set client-side). Powers the analytics page.
create table if not exists public.login_events (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid references public.profiles (id) on delete cascade,
  date         date        not null default current_date,
  -- Instant of the login — drives the analytics "Recent login" sort.
  logged_in_at timestamptz not null default now()
);

-- One row per click on the "Lander Studio" link in the sidebar description.
-- Written server-side via the service-role client (works for anon visitors);
-- analytics counts the rows. No anon/auth grants — service role bypasses RLS.
create table if not exists public.lander_clicks (
  id         uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now()
);

-- Improvement suggestions submitted from the "Suggest Improvements" modal.
-- user_id is null for logged-out submitters.
create table if not exists public.improvements (
  id         uuid primary key default gen_random_uuid(),
  message    text not null,
  user_id    uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now()
);

-- Helpful indexes for the common access paths.
-- Backfill for databases created before featured_at existed.
alter table public.components add column if not exists featured_at timestamptz;

create index if not exists components_category_idx   on public.components (category);
create index if not exists components_featured_at_idx on public.components (featured_at desc nulls last);
create index if not exists components_published_idx  on public.components (is_published);
create index if not exists components_filters_idx    on public.components using gin (filters);
create index if not exists components_colors_gin_idx  on public.components using gin (colors jsonb_path_ops);
create index if not exists components_colors_hsl_gin_idx on public.components using gin (colors_hsl jsonb_path_ops);
create index if not exists copy_events_user_idx      on public.copy_events (user_id);
create index if not exists copy_events_component_idx on public.copy_events (component_id);
create index if not exists login_events_user_idx     on public.login_events (user_id);
create index if not exists login_events_date_idx     on public.login_events (date);
-- Dedup: at most one login row per user per day. Doubles as the ON CONFLICT
-- target for the client-side upsert in AuthProvider.
create unique index if not exists login_events_user_date_uniq
  on public.login_events (user_id, date);

-- -----------------------------------------------------------------------------
-- New-user trigger: auto-create a profile row for every auth.users insert.
-- SECURITY DEFINER so it can write to public.profiles regardless of RLS.
-- Pulls full_name / avatar_url from raw_user_meta_data (covers Google OAuth).
-- -----------------------------------------------------------------------------

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, full_name, avatar_url, email)
  values (
    new.id,
    coalesce(
      new.raw_user_meta_data ->> 'full_name',
      new.raw_user_meta_data ->> 'name'
    ),
    coalesce(
      new.raw_user_meta_data ->> 'avatar_url',
      new.raw_user_meta_data ->> 'picture'
    ),
    new.email
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row
  execute function public.handle_new_user();

-- One-time backfill of profiles.email from auth.users for rows created before the
-- email column existed. Idempotent; re-running only touches rows that drifted.
update public.profiles p
set email = u.email
from auth.users u
where u.id = p.id
  and p.email is distinct from u.email;

-- -----------------------------------------------------------------------------
-- Copy-count trigger: bump components.copy_count on every copy_events insert.
-- SECURITY DEFINER so it can update components regardless of RLS.
-- -----------------------------------------------------------------------------

create or replace function public.increment_copy_count()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.components
  set copy_count = copy_count + 1
  where id = new.component_id;
  return new;
end;
$$;

drop trigger if exists on_copy_event_inserted on public.copy_events;
create trigger on_copy_event_inserted
  after insert on public.copy_events
  for each row
  execute function public.increment_copy_count();

-- -----------------------------------------------------------------------------
-- Grants
-- Table privileges are checked BEFORE row-level security. Without these the
-- onboarding upsert fails with "permission denied for table profiles" even
-- though the RLS policies below would allow the row. Roles are Supabase's
-- built-in `anon` (logged-out) and `authenticated` (logged-in) API roles.
-- -----------------------------------------------------------------------------

grant usage on schema public to anon, authenticated;

-- profiles: a logged-in user manages only their own row (RLS scopes it to
-- auth.uid()). anon needs no access. Writes are COLUMN-SCOPED so a user can set
-- only their name/avatar — NOT role (blocks self-promotion to admin), email, or
-- the copy counters. copies_today / last_copy_date are maintained by record_copy
-- (SECURITY DEFINER, bypasses these grants); email is mirrored by the signup
-- trigger. Without the column scope the open "update own" policy below would let
-- any user run `update profiles set role='admin'` on their own row.
revoke insert, update on public.profiles from authenticated;
grant select on public.profiles to authenticated;
grant insert (id, full_name, avatar_url) on public.profiles to authenticated;
grant update (full_name, avatar_url) on public.profiles to authenticated;

-- components: everyone may read (published-only via RLS); writes are admin-only
-- (gated by the policies below). figma_data is DELIBERATELY excluded from the
-- column grant — it's the paid payload, so it must NOT be directly selectable.
-- It is served only through record_copy() (rate-limited) for end users and
-- get_component_figma_data() (admin-only) for the editor. Without this, anyone
-- could `select figma_data` from devtools and bypass the daily copy limit.
revoke select on public.components from anon, authenticated;
grant select (
  id, category, section, filters, copy_count, figma_url, preview_url,
  aspect_ratio, colors, colors_hsl, uploaded_by, is_published, featured,
  featured_at, created_at
) on public.components to anon, authenticated;
grant insert, update, delete on public.components to authenticated;

-- copy_events: a logged-in user inserts/reads their own copy log.
grant select, insert on public.copy_events to authenticated;

-- login_events: a logged-in user inserts/reads their own login log. Analytics
-- reads happen via the service-role client, which bypasses RLS entirely.
grant select, insert on public.login_events to authenticated;

-- -----------------------------------------------------------------------------
-- Row Level Security
-- -----------------------------------------------------------------------------

alter table public.profiles     enable row level security;
alter table public.components   enable row level security;
alter table public.copy_events  enable row level security;
alter table public.login_events enable row level security;
alter table public.lander_clicks enable row level security;
alter table public.improvements enable row level security;

-- profiles: users may read, insert, and update only their own row.
drop policy if exists "Profiles: select own" on public.profiles;
create policy "Profiles: select own"
  on public.profiles
  for select
  using (auth.uid() = id);

-- Insert own row — onboarding upserts the profile when the new-user trigger
-- hasn't created it yet. Without this, the INSERT path hits RLS.
drop policy if exists "Profiles: insert own" on public.profiles;
create policy "Profiles: insert own"
  on public.profiles
  for insert
  with check (auth.uid() = id);

drop policy if exists "Profiles: update own" on public.profiles;
create policy "Profiles: update own"
  on public.profiles
  for update
  using (auth.uid() = id)
  with check (auth.uid() = id);

-- Backstop against role self-promotion. The column-scoped update grant above is
-- the primary block (a user has no UPDATE privilege on `role`); this trigger
-- rejects any role change from an API user session even if that grant is ever
-- loosened. NOT security definer, so current_user is the real caller:
-- 'authenticated'/'anon' = blocked; 'postgres' (dashboard SQL) and
-- 'service_role' (admin scripts / SECURITY DEFINER fns) pass through, so admins
-- can still set roles manually.
create or replace function public.prevent_role_self_change()
returns trigger
language plpgsql
as $$
begin
  if new.role is distinct from old.role
     and current_user in ('authenticated', 'anon') then
    raise exception 'not allowed to change role';
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_block_role_change on public.profiles;
create trigger profiles_block_role_change
  before update on public.profiles
  for each row
  execute function public.prevent_role_self_change();

-- components: anyone (incl. anon) may read published rows.
drop policy if exists "Components: read published" on public.components;
create policy "Components: read published"
  on public.components
  for select
  using (is_published = true);

-- components: only admins may insert.
drop policy if exists "Components: admin insert" on public.components;
create policy "Components: admin insert"
  on public.components
  for insert
  to authenticated
  with check (
    exists (
      select 1
      from public.profiles p
      where p.id = auth.uid()
        and p.role = 'admin'
    )
  );

-- components: only admins may update.
drop policy if exists "Components: admin update" on public.components;
create policy "Components: admin update"
  on public.components
  for update
  to authenticated
  using (
    exists (
      select 1
      from public.profiles p
      where p.id = auth.uid()
        and p.role = 'admin'
    )
  )
  with check (
    exists (
      select 1
      from public.profiles p
      where p.id = auth.uid()
        and p.role = 'admin'
    )
  );

-- components: only admins may delete.
drop policy if exists "Components: admin delete" on public.components;
create policy "Components: admin delete"
  on public.components
  for delete
  to authenticated
  using (
    exists (
      select 1
      from public.profiles p
      where p.id = auth.uid()
        and p.role = 'admin'
    )
  );

-- copy_events: users may insert and read only their own rows.
drop policy if exists "Copy events: insert own" on public.copy_events;
create policy "Copy events: insert own"
  on public.copy_events
  for insert
  to authenticated
  with check (auth.uid() = user_id);

drop policy if exists "Copy events: select own" on public.copy_events;
create policy "Copy events: select own"
  on public.copy_events
  for select
  to authenticated
  using (auth.uid() = user_id);

-- login_events: users may insert and read only their own rows. (Analytics
-- reads go through the service-role client and bypass these policies.)
drop policy if exists "Login events: insert own" on public.login_events;
create policy "Login events: insert own"
  on public.login_events
  for insert
  to authenticated
  with check (auth.uid() = user_id);

drop policy if exists "Login events: select own" on public.login_events;
create policy "Login events: select own"
  on public.login_events
  for select
  to authenticated
  using (auth.uid() = user_id);

-- improvements: anyone (incl. anon) may submit a non-empty message; a logged-in
-- submitter may only attach their own user_id.
drop policy if exists "Improvements: insert any" on public.improvements;
create policy "Improvements: insert any"
  on public.improvements
  for insert
  to anon, authenticated
  with check (
    char_length(btrim(message)) > 0
    and (user_id is null or user_id = auth.uid())
  );

-- improvements: only admins may read submissions.
drop policy if exists "Improvements: admin select" on public.improvements;
create policy "Improvements: admin select"
  on public.improvements
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.profiles p
      where p.id = auth.uid()
        and p.role = 'admin'
    )
  );

-- -----------------------------------------------------------------------------
-- Storage: public "avatars" bucket. Authenticated users may only write into a
-- path whose first folder equals their own auth.uid().
-- -----------------------------------------------------------------------------

insert into storage.buckets (id, name, public)
values ('avatars', 'avatars', true)
on conflict (id) do nothing;

-- Public read for anything in the avatars bucket.
drop policy if exists "Avatars: public read" on storage.objects;
create policy "Avatars: public read"
  on storage.objects
  for select
  using (bucket_id = 'avatars');

-- Upload only into <auth.uid()>/... within the avatars bucket.
drop policy if exists "Avatars: upload own folder" on storage.objects;
create policy "Avatars: upload own folder"
  on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- Update only your own files (e.g. overwrite an avatar).
drop policy if exists "Avatars: update own folder" on storage.objects;
create policy "Avatars: update own folder"
  on storage.objects
  for update
  to authenticated
  using (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  )
  with check (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- Delete only your own files.
drop policy if exists "Avatars: delete own folder" on storage.objects;
create policy "Avatars: delete own folder"
  on storage.objects
  for delete
  to authenticated
  using (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- -----------------------------------------------------------------------------
-- Helper: hsl_from_hex('#RRGGBB') -> {h, s, l} with h in 0..360, s/l in 0..100.
-- Returns null for null / malformed input.
-- -----------------------------------------------------------------------------

create or replace function public.hsl_from_hex(hexin text)
returns numeric[]
language plpgsql
immutable
as $$
declare
  h2 text;
  r  numeric; g numeric; b numeric;
  mx numeric; mn numeric; d numeric;
  hh numeric := 0; ss numeric := 0; ll numeric;
begin
  if hexin is null then
    return null;
  end if;
  h2 := upper(trim(hexin));
  if h2 !~ '^#[0-9A-F]{6}$' then
    return null;
  end if;

  r := (('x' || substr(h2, 2, 2))::bit(8)::int) / 255.0;
  g := (('x' || substr(h2, 4, 2))::bit(8)::int) / 255.0;
  b := (('x' || substr(h2, 6, 2))::bit(8)::int) / 255.0;

  mx := greatest(r, g, b);
  mn := least(r, g, b);
  d  := mx - mn;
  ll := (mx + mn) / 2;

  if d <> 0 then
    ss := d / (1 - abs(2 * ll - 1));
    if mx = r then
      hh := 60 * (((((g - b) / d) % 6) + 6) % 6);
    elsif mx = g then
      hh := 60 * ((b - r) / d + 2);
    else
      hh := 60 * ((r - g) / d + 4);
    end if;
    hh := ((hh % 360) + 360) % 360;
  end if;

  return array[hh, ss * 100, ll * 100];
end;
$$;

-- -----------------------------------------------------------------------------
-- RPC: search_by_color(search_hex text, tolerance int)
-- HSL-based matching: a component color matches the search color when they are
-- in the same family — hue within 30deg (circular), saturation within 40, and
-- lightness within 40. The `tolerance` param is ignored (kept for signature
-- compatibility). Returns matching published components, highest pct first.
-- STABLE; handles null/malformed input and null colors gracefully.
-- Reads precomputed HSL from components.colors_hsl (set at upload time) to skip
-- per-row hex->HSL conversion; legacy rows with null colors_hsl fall back to
-- converting colors[].hex on the fly so they still appear in results.
-- -----------------------------------------------------------------------------

create or replace function public.search_by_color(search_hex text, tolerance int)
returns setof public.components
language plpgsql
stable
as $$
declare
  shsl numeric[];
  sh numeric;
  ss numeric;
  sl numeric;
  lonly boolean := false;  -- lightness-only match (dark / light / gray families)
  ltol  numeric := 40;     -- lightness tolerance for the lightness-only branch
begin
  shsl := public.hsl_from_hex(search_hex);
  if shsl is null then
    return;
  end if;
  sh := shsl[1];
  ss := shsl[2];
  sl := shsl[3];

  -- Decide the matching mode from the SEARCH color.
  if sl < 20 or sl > 80 then
    -- Very dark/black or very light/white family: lightness only, +-15.
    lonly := true;
    ltol  := 15;
  elsif ss < 10 then
    -- Gray family: lightness only, +-20.
    lonly := true;
    ltol  := 20;
  end if;

  return query
  select c.*
  from (
    -- One row per component: keep the highest pct among its matching colors.
    select distinct on (comp.id)
           comp.id,
           (elem ->> 'pct')::numeric as pct
    from public.components comp
    -- Prefer the precomputed colors_hsl array; legacy rows (null colors_hsl)
    -- fall back to the raw colors array + on-the-fly hex->HSL below.
    cross join lateral
      jsonb_array_elements(coalesce(comp.colors_hsl, comp.colors)) as elem
    -- Element HSL: read precomputed h/s/l when present (fast path), otherwise
    -- convert the hex (CASE short-circuits, so hsl_from_hex is only called for
    -- legacy elements). eh = [h, s, l].
    cross join lateral (
      select case
        when elem ? 'h' then array[
          (elem ->> 'h')::numeric,
          (elem ->> 's')::numeric,
          (elem ->> 'l')::numeric
        ]
        else public.hsl_from_hex(elem ->> 'hex')
      end as eh
    ) hv
    where comp.is_published = true
      and coalesce(comp.colors_hsl, comp.colors) is not null
      and jsonb_typeof(coalesce(comp.colors_hsl, comp.colors)) = 'array'
      and hv.eh is not null
      and (
        -- Dark / light / gray families: match by lightness only (any hue/sat).
        (lonly and abs(hv.eh[3] - sl) <= ltol)
        -- Normal colorful range: hue within 30deg (circular), sat +-40, light +-40.
        or (
          not lonly
          and least(abs(hv.eh[1] - sh), 360 - abs(hv.eh[1] - sh)) <= 30
          and abs(hv.eh[2] - ss) <= 40
          and abs(hv.eh[3] - sl) <= 40
        )
      )
    order by comp.id, (elem ->> 'pct')::numeric desc nulls last
  ) m
  join public.components c on c.id = m.id
  order by m.pct desc nulls last;
end;
$$;

-- -----------------------------------------------------------------------------
-- RPC: record_copy(component_id uuid)
-- Server-side daily copy limit (10/day, IST). SECURITY DEFINER so it can bump
-- copies_today / last_copy_date even though the profiles RLS policy forbids the
-- user from updating those columns directly. Logs a copy_events row and — only
-- when the copy is allowed — RETURNS the component's figma_data. This is the
-- ONLY end-user path to figma_data (the column grant excludes it), so the daily
-- limit can't be bypassed by selecting figma_data directly.
-- -----------------------------------------------------------------------------

create or replace function public.record_copy(component_id uuid)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  prof profiles%rowtype;
  today_ist date := (now() at time zone 'Asia/Kolkata')::date;
  fdata text;
  is_admin boolean;
begin
  if uid is null then
    return json_build_object('success', false, 'reason', 'unauthenticated');
  end if;

  select * into prof from profiles where id = uid;
  is_admin := (prof.role = 'admin');

  -- Admins have no daily limit (and their counter isn't touched).
  if not is_admin then
    if prof.last_copy_date = today_ist then
      if prof.copies_today >= 10 then
        return json_build_object('success', false, 'reason', 'limit_reached');
      end if;
    else
      update profiles set copies_today = 0, last_copy_date = today_ist where id = uid;
      prof.copies_today := 0;
    end if;
  end if;

  -- Only published components are copyable.
  select c.figma_data into fdata
  from components c
  where c.id = component_id and c.is_published = true;
  if not found then
    return json_build_object('success', false, 'reason', 'not_found');
  end if;

  if not is_admin then
    update profiles
    set copies_today = copies_today + 1, last_copy_date = today_ist
    where id = uid;
  end if;

  insert into copy_events (user_id, component_id, date)
  values (uid, component_id, today_ist);

  return json_build_object(
    'success', true,
    'copies_today', case when is_admin then prof.copies_today else prof.copies_today + 1 end,
    'figma_data', fdata
  );
end;
$$;

-- -----------------------------------------------------------------------------
-- RPC: get_component_figma_data(component_id uuid)
-- Admin-only read of figma_data for the edit screen (the column grant hides it
-- from normal selects). Returns null for non-admins.
-- -----------------------------------------------------------------------------

create or replace function public.get_component_figma_data(component_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  fdata text;
begin
  if not exists (
    select 1 from profiles where id = auth.uid() and role = 'admin'
  ) then
    return null;
  end if;
  select figma_data into fdata from components where id = component_id;
  return fdata;
end;
$$;

-- search_by_color used to return whole component rows (incl. figma_data) to
-- anon callers — a figma_data leak. Color search is now fully client-side, so
-- the RPC is dropped entirely.
drop function if exists public.search_by_color(text, int);

-- =============================================================================
-- Analytics RPCs (admin-only, called via the service-role client which bypasses
-- RLS). They aggregate inside Postgres so the analytics page never pulls raw
-- event rows to JS.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- get_per_user_activity(activity_date date)
-- Per-user copy activity for a single IST day: one row per user who copied that
-- day, with their copy count and the list of components they copied (most
-- recent first). Powers the "Per-user activity" table.
-- ---------------------------------------------------------------------------
create or replace function public.get_per_user_activity(activity_date date)
returns table (
  user_id       uuid,
  copies_count  bigint,
  component_ids uuid[]
)
language sql
stable
as $$
  select
    ce.user_id,
    count(*) as copies_count,
    array_agg(ce.component_id order by ce.copied_at desc) as component_ids
  from public.copy_events ce
  where ce.date = activity_date
    and ce.user_id is not null
  group by ce.user_id
  order by count(*) desc;
$$;

-- ---------------------------------------------------------------------------
-- get_analytics_windows(d_today, d_start7, d_date)
-- All KPI windows in a single round trip. Returns a JSON object keyed by window
-- ('today', '7d', 'all', and 'date' when d_date is non-null); each value holds
-- totalCopies, uniqueCopiers, totalLogins, uniqueLogins, newAccounts and a
-- byCategory map. Every metric is computed in-DB — no event rows leave Postgres.
--
-- Window date ranges (on the events' `date` column, already IST day-stamped):
--   today → [d_today, d_today]   7d → [d_start7, d_today]   all → (… , d_today]
--   date  → [d_date, d_date]     (only when d_date is not null)
-- newAccounts uses profiles.created_at converted to the IST calendar day.
-- ---------------------------------------------------------------------------
create or replace function public.get_analytics_windows(
  d_today  date,
  d_start7 date,
  d_date   date default null
)
returns jsonb
language plpgsql
stable
as $$
declare
  result jsonb;
begin
  with
  -- Copies, all windows in one pass (every window ⊆ date <= d_today).
  ca as (
    select
      count(*)                   filter (where ce.date = d_today)                   as t_total,
      count(distinct ce.user_id) filter (where ce.date = d_today)                   as t_uniq,
      count(*)                   filter (where ce.date between d_start7 and d_today) as w_total,
      count(distinct ce.user_id) filter (where ce.date between d_start7 and d_today) as w_uniq,
      count(*)                                                                       as a_total,
      count(distinct ce.user_id)                                                     as a_uniq,
      count(*)                   filter (where d_date is not null and ce.date = d_date) as d_total,
      count(distinct ce.user_id) filter (where d_date is not null and ce.date = d_date) as d_uniq
    from public.copy_events ce
    where ce.date <= d_today
  ),
  -- Logins, same window shape.
  la as (
    select
      count(*)                   filter (where le.date = d_today)                   as t_total,
      count(distinct le.user_id) filter (where le.date = d_today)                   as t_uniq,
      count(*)                   filter (where le.date between d_start7 and d_today) as w_total,
      count(distinct le.user_id) filter (where le.date between d_start7 and d_today) as w_uniq,
      count(*)                                                                       as a_total,
      count(distinct le.user_id)                                                     as a_uniq,
      count(*)                   filter (where d_date is not null and le.date = d_date) as d_total,
      count(distinct le.user_id) filter (where d_date is not null and le.date = d_date) as d_uniq
    from public.login_events le
    where le.date <= d_today
  ),
  -- New accounts by IST signup day.
  pa as (
    select
      count(*) filter (where d::date = d_today)                   as t_new,
      count(*) filter (where d::date between d_start7 and d_today) as w_new,
      count(*)                                                     as a_new,
      count(*) filter (where d_date is not null and d::date = d_date) as d_new
    from (
      select (p.created_at at time zone 'Asia/Kolkata') as d
      from public.profiles p
    ) s
  ),
  -- Copies grouped by category, per window (null categories dropped at build).
  cat as (
    select
      c.category,
      count(*) filter (where ce.date = d_today)                   as t_c,
      count(*) filter (where ce.date between d_start7 and d_today) as w_c,
      count(*)                                                     as a_c,
      count(*) filter (where d_date is not null and ce.date = d_date) as d_c
    from public.copy_events ce
    join public.components c on c.id = ce.component_id
    where ce.date <= d_today
    group by c.category
  )
  select jsonb_build_object(
    'today', jsonb_build_object(
      'totalCopies', ca.t_total, 'uniqueCopiers', ca.t_uniq,
      'totalLogins', la.t_total, 'uniqueLogins', la.t_uniq,
      'newAccounts', pa.t_new,
      'byCategory', (select coalesce(jsonb_object_agg(category, t_c)
                            filter (where category is not null), '{}'::jsonb) from cat)
    ),
    '7d', jsonb_build_object(
      'totalCopies', ca.w_total, 'uniqueCopiers', ca.w_uniq,
      'totalLogins', la.w_total, 'uniqueLogins', la.w_uniq,
      'newAccounts', pa.w_new,
      'byCategory', (select coalesce(jsonb_object_agg(category, w_c)
                            filter (where category is not null), '{}'::jsonb) from cat)
    ),
    'all', jsonb_build_object(
      'totalCopies', ca.a_total, 'uniqueCopiers', ca.a_uniq,
      'totalLogins', la.a_total, 'uniqueLogins', la.a_uniq,
      'newAccounts', pa.a_new,
      'byCategory', (select coalesce(jsonb_object_agg(category, a_c)
                            filter (where category is not null), '{}'::jsonb) from cat)
    ),
    'date', case when d_date is null then null else jsonb_build_object(
      'totalCopies', ca.d_total, 'uniqueCopiers', ca.d_uniq,
      'totalLogins', la.d_total, 'uniqueLogins', la.d_uniq,
      'newAccounts', pa.d_new,
      'byCategory', (select coalesce(jsonb_object_agg(category, d_c)
                            filter (where category is not null), '{}'::jsonb) from cat)
    ) end
  )
  into result
  from ca, la, pa;

  return result;
end;
$$;
