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
-- Analytics window scans: the (date, user_id) composites let get_analytics_windows
-- run its per-window count(distinct user_id) as index-only scans instead of full
-- heap scans, and copy_events_date_idx speeds the plain date-range counts.
create index if not exists copy_events_date_idx       on public.copy_events (date);
create index if not exists copy_events_date_user_idx  on public.copy_events (date, user_id);
create index if not exists login_events_date_user_idx on public.login_events (date, user_id);
-- Gallery list: a partial covering index for the exact predicate the gallery
-- query uses (published + public), ordered newest-first within a category.
create index if not exists components_gallery_idx
  on public.components (category, is_published, is_private, created_at desc)
  where is_published = true and is_private = false;
-- "Top copied" / per-component copy timelines on the analytics page.
create index if not exists copy_events_component_date_idx
  on public.copy_events (component_id, copied_at desc);
-- Plain uploaded_by lookups (admin Creators counts, creator filters). The
-- composite components_creator_order_idx also leads with uploaded_by, so this is
-- a smaller fallback for equality scans.
create index if not exists components_uploaded_by_idx
  on public.components (uploaded_by);
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

-- Creator-feature profile columns must exist BEFORE the column-scoped grants
-- below reference them (username/bio/creator_onboarded). Defined here so a fresh
-- top-to-bottom run of this file doesn't fail with "column does not exist".
-- (beta is already added in an alter above the Grants section.) Idempotent.
alter table public.profiles add column if not exists username text unique;
alter table public.profiles add column if not exists bio text;
alter table public.profiles
  add column if not exists creator_onboarded boolean not null default false;
-- Creator socials + custom CTA (edited in the account modal, shown on the
-- portal). Handles are USERNAMES only (no URL); website/cta are full https URLs.
-- Written only via set_my_socials() (validated), so they're not in the
-- column-scoped client update grant below.
alter table public.profiles add column if not exists x_handle         text;
alter table public.profiles add column if not exists instagram_handle text;
alter table public.profiles add column if not exists linkedin_handle  text;
alter table public.profiles add column if not exists website_url      text;
alter table public.profiles add column if not exists cta_url          text;

-- profiles: a logged-in user manages only their own row (RLS scopes it to
-- auth.uid()). anon needs no access.
-- IMPORTANT: insert/update are COLUMN-SCOPED. A table-level grant would let a
-- user self-set `role` (privilege escalation to admin/creator) or reset
-- `copies_today`/`last_copy_date` (bypassing the daily copy limit), since the
-- "update own" RLS policy can't restrict columns. Those columns change ONLY via
-- SECURITY DEFINER functions (record_copy, set_my_username, etc.) or the
-- service-role client. Keep this column list in sync with the user-editable
-- fields (full_name, avatar_url, bio, username, creator_onboarded, beta).
-- The revoke first clears any prior table-wide insert/update grant (a subset
-- re-grant does NOT remove it), so the column-scoped grants are the only ones.
grant select on public.profiles to authenticated;
revoke insert, update on public.profiles from authenticated;
grant insert (id, full_name, avatar_url, bio, username, creator_onboarded)
  on public.profiles to authenticated;
-- `id` is included so PostgREST upserts work (ON CONFLICT DO UPDATE sets every
-- payload column, including the PK). It's safe: the "update own" RLS with-check
-- (auth.uid() = id) forbids changing id to anyone else's — it can only ever be
-- set back to the user's own id. `role`, `copies_today`, `last_copy_date` stay
-- OUT (the whole point) so privilege escalation / limit-reset remain blocked.
grant update (id, full_name, avatar_url, bio, username, creator_onboarded)
  on public.profiles to authenticated;

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
  lim int;
begin
  if uid is null then
    return json_build_object('success', false, 'reason', 'unauthenticated');
  end if;

  select * into prof from profiles where id = uid;
  is_admin := (prof.role = 'admin');
  -- Creators get a higher daily copy allowance than regular users.
  lim := case when prof.role = 'creator' then 50 else 10 end;

  -- Admins have no daily limit (and their counter isn't touched).
  if not is_admin then
    if prof.last_copy_date = today_ist then
      if prof.copies_today >= lim then
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

-- ---------------------------------------------------------------------------
-- RPC: get_editable_figma_data(component_id) — figma_data for the EDIT screen.
-- Admins may read any; a creator may read their OWN component while it's still
-- unpublished (so they can edit a pending/rejected submission). Everyone else
-- gets null. SECURITY DEFINER because the figma_data column grant is hidden.
-- ---------------------------------------------------------------------------
create or replace function public.get_editable_figma_data(component_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  uid      uuid := auth.uid();
  is_admin boolean;
  owner    uuid;
  pub      boolean;
  fdata    text;
begin
  if uid is null then
    return null;
  end if;
  select (role = 'admin') into is_admin from profiles where id = uid;
  select figma_data, uploaded_by, is_published
    into fdata, owner, pub
  from components where id = component_id;
  if is_admin then
    return fdata;
  end if;
  -- A creator may read their OWN design's figma_data for editing — including an
  -- already-approved one (editing it sends it back to pending for re-review).
  if owner = uid then
    return fdata;
  end if;
  return null;
end;
$$;
grant execute on function public.get_editable_figma_data(uuid) to authenticated;

-- search_by_color used to return whole component rows (incl. figma_data) to
-- anon callers — a figma_data leak. Color search is now fully client-side, so
-- the RPC is dropped entirely.
drop function if exists public.search_by_color(text, int);

-- =============================================================================
-- Creators feature — public creator pages at /creators/<username>, where a
-- creator publishes designs (moderated: pending → approved/rejected) and edits
-- their bio. Idempotent; safe to re-run.
-- =============================================================================

-- profiles: handle for the public URL + an editable bio.
-- (username/bio columns are added earlier, before the Grants section, so the
-- column-scoped profiles grant can reference them on a fresh run.)

-- components: moderation status + per-design privacy.
alter table public.components add column if not exists status text not null default 'pending'
  check (status in ('pending', 'approved', 'rejected'));
alter table public.components add column if not exists is_private boolean not null default false;
-- reuploaded: set true when a creator edits an already-APPROVED design (it drops
-- back to pending for re-review). Drives the "Reuploaded" tag on the approvals
-- queue. Cleared on approval.
alter table public.components add column if not exists reuploaded boolean not null default false;
-- rejection_reason: the admin's note shown to the creator when a design is
-- rejected (surfaced as a tooltip on the "Rejected" tag on their portal).
-- Cleared on approval. Written only by the admin review route (service role).
alter table public.components add column if not exists rejection_reason text;

-- Existing rows were all admin uploads — treat them as approved so the gallery
-- (which reads is_published) keeps showing them with a consistent status.
update public.components set status = 'approved' where is_published = true and status = 'pending';

-- anon/authenticated must be able to read the new status/is_private columns
-- (still NO figma_data — it stays excluded from the column grant).
grant select (
  id, category, section, filters, copy_count, figma_url, preview_url,
  aspect_ratio, colors, colors_hsl, uploaded_by, is_published, featured,
  featured_at, created_at, status, is_private
) on public.components to anon, authenticated;

-- Public read now also excludes private designs (all existing rows are
-- is_private=false, so the gallery is unaffected).
drop policy if exists "Components: read published" on public.components;
create policy "Components: read published"
  on public.components
  for select
  using (is_published = true and is_private = false);

-- A creator may read every one of their OWN designs, whatever the status /
-- privacy / publish state — so their creator page shows pending & rejected too.
drop policy if exists "Components: read own" on public.components;
create policy "Components: read own"
  on public.components
  for select
  to authenticated
  using (uploaded_by = auth.uid());

-- A creator may publish their own design, but only as an unpublished, pending
-- submission for review — they can't self-approve or self-publish.
drop policy if exists "Components: owner insert" on public.components;
create policy "Components: owner insert"
  on public.components
  for insert
  to authenticated
  with check (
    uploaded_by = auth.uid()
    and status = 'pending'
    and is_published = false
  );

-- A creator may edit ANY of their own designs — including an already-approved
-- one. The WITH CHECK forces the edited row back to an unpublished, pending
-- state, so an edit always re-enters the review queue (they can't self-publish
-- or keep an approved design live after changing it).
drop policy if exists "Components: owner update own" on public.components;
create policy "Components: owner update own"
  on public.components
  for update
  to authenticated
  using (uploaded_by = auth.uid())
  with check (
    uploaded_by = auth.uid()
    and is_published = false
    and status in ('pending', 'rejected')
  );

-- A creator may delete their own designs.
drop policy if exists "Components: owner delete own" on public.components;
create policy "Components: owner delete own"
  on public.components
  for delete
  to authenticated
  using (uploaded_by = auth.uid());

-- ---------------------------------------------------------------------------
-- Upload rate limit: a creator may insert at most 30 components per IST day.
-- Enforced in a BEFORE INSERT trigger (not the client) so it can't be bypassed.
-- Admins are exempt. The raised message surfaces to the UploadForm.
-- ---------------------------------------------------------------------------
create or replace function public.enforce_creator_upload_rate()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  uploader_role text;
  today_count   int;
begin
  select role into uploader_role from profiles where id = new.uploaded_by;
  -- Admins have no upload cap.
  if uploader_role = 'admin' then
    return new;
  end if;
  -- Count this creator's uploads on the current IST calendar day.
  select count(*) into today_count
  from components
  where uploaded_by = new.uploaded_by
    and (created_at at time zone 'Asia/Kolkata')::date
        = (now() at time zone 'Asia/Kolkata')::date;
  if today_count >= 30 then
    raise exception 'Only 30 components allowed per day';
  end if;
  return new;
end;
$$;

drop trigger if exists components_upload_rate on public.components;
create trigger components_upload_rate
  before insert on public.components
  for each row
  execute function public.enforce_creator_upload_rate();

-- ---------------------------------------------------------------------------
-- RPC: get_creator(uname) — public-safe profile lookup by username. profiles
-- RLS is "own row only", so this SECURITY DEFINER fn is the public read path.
-- Returns null when no such username. Never exposes copies_today/beta/etc.
-- ---------------------------------------------------------------------------
create or replace function public.get_creator(uname text)
returns json
language sql
stable
security definer
set search_path = public
as $$
  select json_build_object(
    'id', p.id,
    'full_name', p.full_name,
    'avatar_url', p.avatar_url,
    'username', p.username,
    'bio', p.bio,
    'created_at', p.created_at,
    'x_handle', p.x_handle,
    'instagram_handle', p.instagram_handle,
    'linkedin_handle', p.linkedin_handle,
    'website_url', p.website_url,
    'cta_url', p.cta_url
  )
  from public.profiles p
  where lower(p.username) = lower(btrim(uname));
$$;
grant execute on function public.get_creator(text) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- set_my_socials(...) — the caller updates their OWN socials + CTA. Handles are
-- usernames only (no URL); website/cta must be https. SECURITY DEFINER so it can
-- write columns the client update grant excludes; validates server-side and
-- raises a clear message the account modal surfaces. Empty string → null.
-- ---------------------------------------------------------------------------
create or replace function public.set_my_socials(
  p_x         text,
  p_instagram text,
  p_linkedin  text,
  p_website   text,
  p_cta       text
)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  vx  text := nullif(btrim(ltrim(coalesce(p_x, ''), '@')), '');
  vi  text := nullif(btrim(ltrim(coalesce(p_instagram, ''), '@')), '');
  vl  text := nullif(btrim(ltrim(coalesce(p_linkedin, ''), '@')), '');
  vw  text := nullif(btrim(coalesce(p_website, '')), '');
  vc  text := nullif(btrim(coalesce(p_cta, '')), '');
  handle_re text := '^[A-Za-z0-9._-]+$';
begin
  if uid is null then
    raise exception 'unauthenticated';
  end if;
  -- Handles: a username, never a link.
  if vx is not null and vx !~ handle_re then
    raise exception 'X (Twitter) must be a username, not a link';
  end if;
  if vi is not null and vi !~ handle_re then
    raise exception 'Instagram must be a username, not a link';
  end if;
  if vl is not null and vl !~ handle_re then
    raise exception 'LinkedIn must be a username, not a link';
  end if;
  -- URLs: https only.
  if vw is not null and vw !~* '^https://[^ ]+\.[^ ]+' then
    raise exception 'Website must be a valid https:// link';
  end if;
  if vc is not null and vc !~* '^https://[^ ]+\.[^ ]+' then
    raise exception 'Custom CTA link must be a valid https:// link';
  end if;

  -- Clamp lengths server-side (defense against oversized payloads / bloat).
  update public.profiles set
    x_handle         = left(vx, 50),
    instagram_handle = left(vi, 50),
    linkedin_handle  = left(vl, 100),
    website_url      = left(vw, 400),
    cta_url          = left(vc, 400)
  where id = uid;

  return json_build_object('success', true);
end;
$$;
grant execute on function public.set_my_socials(text, text, text, text, text)
  to authenticated;

-- ---------------------------------------------------------------------------
-- RPC: ensure_my_username() — returns the caller's username, generating a
-- unique one from their name (or "user") on first use. Used by "Become Creator".
-- ---------------------------------------------------------------------------
create or replace function public.ensure_my_username()
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  uid   uuid := auth.uid();
  uname text;
  base  text;
  cand  text;
  n     int := 0;
begin
  if uid is null then
    return null;
  end if;
  select username, full_name into uname, base from profiles where id = uid;
  if uname is not null then
    return uname;
  end if;
  base := lower(regexp_replace(coalesce(base, 'user'), '[^a-zA-Z0-9]', '', 'g'));
  if base = '' then
    base := 'user';
  end if;
  cand := base;
  while exists (select 1 from profiles where username = cand) loop
    n := n + 1;
    cand := base || n::text;
  end loop;
  update profiles set username = cand where id = uid;
  return cand;
end;
$$;
grant execute on function public.ensure_my_username() to authenticated;

-- get_window_stats was the first-pass analytics aggregate. It's superseded by
-- get_analytics_windows (single combined RPC, see the Analytics section below)
-- and is no longer called anywhere — dropped.
drop function if exists public.get_window_stats(date, date);

-- ---------------------------------------------------------------------------
-- RPC: list_creators() — every creator with a username and at least one live
-- (approved, public, published) design, plus that design count. Powers the
-- "All Creators" popup in the sidebar.
-- ---------------------------------------------------------------------------
-- ---------------------------------------------------------------------------
-- Creator Program applications — submitted from the "Join the Creator Program"
-- modal ("Become a Creator"). One row per submission; applicant must be logged
-- in. Admins review them.
-- ---------------------------------------------------------------------------
create table if not exists public.creator_applications (
  id                     uuid primary key default gen_random_uuid(),
  user_id                uuid not null references public.profiles (id) on delete cascade,
  role                   text not null,
  social_url             text,
  expected_contributions int,
  -- Why the applicant wants to become a creator (free text).
  reason                 text,
  -- Review state, set by admins on the /admin/applications page.
  status                 text not null default 'pending'
                           check (status in ('pending', 'approved', 'rejected')),
  created_at             timestamptz not null default now()
);
create index if not exists creator_applications_user_idx
  on public.creator_applications (user_id);
-- Backfill for tables created before these columns existed.
alter table public.creator_applications
  add column if not exists status text not null default 'pending';
alter table public.creator_applications
  add column if not exists reason text;
-- When an admin approved/rejected the application (drives the 7-day re-apply
-- cooldown after a rejection) and the admin's rejection feedback (emailed to
-- the applicant, shown as "Feedback from Our Team").
alter table public.creator_applications
  add column if not exists reviewed_at timestamptz;
alter table public.creator_applications
  add column if not exists rejection_reason text;

-- Applications are inserted ONLY through /api/creator-apply (service role),
-- which validates the https social link and rejects duplicate pending apps.
-- Clients must not insert directly (that bypasses validation), so no insert
-- grant for authenticated. Idempotent revoke clears any prior grant.
revoke insert on public.creator_applications from authenticated;
grant select on public.creator_applications to authenticated;
grant update on public.creator_applications to authenticated;

-- At most one PENDING application per user (DB-level guard against spamming
-- multiple submissions; the route also checks).
create unique index if not exists creator_applications_one_pending
  on public.creator_applications (user_id)
  where status = 'pending';

alter table public.creator_applications enable row level security;

-- Direct client inserts are disabled — applications come in via the service-role
-- route only (see grant note above). Drop the legacy insert-own policy.
drop policy if exists "Creator apps: insert own" on public.creator_applications;

-- A user may read their own application (to see review status).
drop policy if exists "Creator apps: select own" on public.creator_applications;
create policy "Creator apps: select own"
  on public.creator_applications
  for select
  to authenticated
  using (user_id = auth.uid());

-- Only admins may read submissions.
drop policy if exists "Creator apps: admin select" on public.creator_applications;
create policy "Creator apps: admin select"
  on public.creator_applications
  for select
  to authenticated
  using (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.role = 'admin'
    )
  );

-- Only admins may update (approve / reject) submissions.
drop policy if exists "Creator apps: admin update" on public.creator_applications;
create policy "Creator apps: admin update"
  on public.creator_applications
  for update
  to authenticated
  using (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.role = 'admin'
    )
  )
  with check (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.role = 'admin'
    )
  );

-- ---------------------------------------------------------------------------
-- Auto-grant the creator role when an application is approved. The app's
-- approve route already flips the role, but this trigger guarantees it for ANY
-- approval path (direct SQL, future tooling). SECURITY DEFINER so it runs as the
-- owner — current_user is then not 'authenticated'/'anon', so it isn't blocked
-- by prevent_role_self_change. Never demotes an admin. Fires only on the
-- transition INTO 'approved'.
-- ---------------------------------------------------------------------------
create or replace function public.grant_creator_on_approval()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status = 'approved'
     and (tg_op = 'INSERT' or old.status is distinct from 'approved')
  then
    update public.profiles
    set role = 'creator'
    where id = new.user_id
      and role <> 'admin';
  end if;
  return new;
end;
$$;

drop trigger if exists creator_app_approved on public.creator_applications;
create trigger creator_app_approved
  after insert or update on public.creator_applications
  for each row
  execute function public.grant_creator_on_approval();

-- ---------------------------------------------------------------------------
-- Creator onboarding — once an application is approved (role => 'creator'), the
-- app forces a one-time "Choose your username" modal on the creator's next
-- visit. `creator_onboarded` flips true the moment they pick a handle, so the
-- modal never shows again. Idempotent.
-- (The creator_onboarded column itself is added earlier, before the Grants
-- section, so the column-scoped profiles grant can reference it on a fresh run.)
-- ---------------------------------------------------------------------------

-- Creators who already chose a username (pre-existing rows) are onboarded.
update public.profiles
  set creator_onboarded = true
  where username is not null and creator_onboarded = false;

-- ---------------------------------------------------------------------------
-- RPC: is_username_available(uname) — true when no other profile holds the
-- (case-insensitive) handle. profiles RLS is "own row only", so this
-- SECURITY DEFINER fn is the only way the client can probe other rows. Powers
-- the live availability check in the creator username modal.
-- ---------------------------------------------------------------------------
create or replace function public.is_username_available(uname text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select not exists (
    select 1 from public.profiles
    where lower(username) = lower(btrim(uname))
      and id <> auth.uid()
  );
$$;
grant execute on function public.is_username_available(text) to authenticated;

-- ---------------------------------------------------------------------------
-- RPC: set_my_username(uname) — claim a handle for the caller and mark them
-- onboarded. Validates format (3–20 chars: a-z, 0-9, _), normalizes to
-- lowercase, and rejects handles taken by someone else. Returns
-- {ok:true, username} or {ok:false, error:'unauthenticated'|'invalid'|'taken'}.
-- The unique_violation guard closes the check-then-write race.
-- ---------------------------------------------------------------------------
create or replace function public.set_my_username(uname text)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  uid  uuid := auth.uid();
  norm text := lower(btrim(uname));
  r    text;
begin
  if uid is null then
    return json_build_object('ok', false, 'error', 'unauthenticated');
  end if;
  -- Only approved creators (and admins) may claim a handle. A normal user has
  -- no creator page/upload access, so a handle would be meaningless — and this
  -- keeps the function from being a back door to set creator_onboarded/username.
  select role into r from profiles where id = uid;
  if r is null or r not in ('creator', 'admin') then
    return json_build_object('ok', false, 'error', 'forbidden');
  end if;
  if norm !~ '^[a-z0-9_]{3,20}$' then
    return json_build_object('ok', false, 'error', 'invalid');
  end if;
  if exists (
    select 1 from profiles where lower(username) = norm and id <> uid
  ) then
    return json_build_object('ok', false, 'error', 'taken');
  end if;
  update profiles
    set username = norm, creator_onboarded = true
    where id = uid;
  return json_build_object('ok', true, 'username', norm);
exception when unique_violation then
  return json_build_object('ok', false, 'error', 'taken');
end;
$$;
grant execute on function public.set_my_username(text) to authenticated;

-- ---------------------------------------------------------------------------
-- RPC: get_creator_designs(uname) — a creator's designs as seen by the caller.
-- The owner and any admin see EVERYTHING (pending / rejected / private /
-- unpublished); everyone else sees only live designs (approved + public +
-- published). profiles/components RLS can't express "owner-or-admin sees all of
-- THIS user's rows", so this SECURITY DEFINER fn is the read path the creator
-- page uses. figma_data is never returned.
-- ---------------------------------------------------------------------------
-- Per-creator manual ordering. Distinct from the global `featured`/`featured_at`
-- (which an admin uses to pin on the HOME gallery): creator_pinned_at only
-- arranges a creator's OWN designs, on their portal and in the home gallery when
-- that creator is selected. Idempotent.
alter table public.components
  add column if not exists creator_pinned_at timestamptz;

-- The gallery orders by creator_pinned_at, which requires the column be
-- selectable by anon/authenticated (added here since it didn't exist at the main
-- components grant above). Without it the client read fails with
-- "permission denied for table components".
grant select (creator_pinned_at) on public.components to anon, authenticated;

-- Creator portal / creator gallery view: get_creator_designs filters by
-- uploaded_by and orders by (creator_pinned_at desc, created_at desc). This
-- composite turns that into an index scan instead of a full scan + sort, which
-- matters once a creator has many components.
create index if not exists components_creator_order_idx
  on public.components (uploaded_by, creator_pinned_at desc nulls last, created_at desc);

-- RPC: pin_creator_design(design_id) — pin one of the caller's designs to the
-- top of their portal/feed. Owner or admin only. Stamps creator_pinned_at = now
-- so the most-recently-pinned leads.
create or replace function public.pin_creator_design(design_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  caller uuid := auth.uid();
  owner  uuid;
begin
  if caller is null then
    return false;
  end if;
  select uploaded_by into owner from components where id = design_id;
  if owner is null then
    return false;
  end if;
  if caller <> owner and not exists (
    select 1 from profiles where id = caller and role = 'admin'
  ) then
    return false;
  end if;
  update components set creator_pinned_at = now() where id = design_id;
  return true;
end;
$$;
grant execute on function public.pin_creator_design(uuid) to authenticated;

-- Return columns changed (added creator_pinned_at) → drop before recreate.
drop function if exists public.get_creator_designs(text);
create or replace function public.get_creator_designs(uname text)
returns table (
  id                uuid,
  category          text,
  section           text,
  preview_url       text,
  aspect_ratio      numeric,
  figma_url         text,
  status            text,
  is_private        boolean,
  is_published      boolean,
  created_at        timestamptz,
  copy_count        int,
  featured          boolean,
  creator_pinned_at timestamptz,
  rejection_reason  text
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  target     uuid;
  caller     uuid := auth.uid();
  privileged boolean := false;
begin
  select p.id into target from profiles p where lower(p.username) = lower(btrim(uname));
  if target is null then
    return;
  end if;
  -- Qualify profiles.id: the RETURNS TABLE declares an `id` OUT column, so a
  -- bare `id` here is ambiguous ("column reference id is ambiguous").
  privileged := caller is not null and (
    caller = target
    or exists (select 1 from profiles p where p.id = caller and p.role = 'admin')
  );
  return query
    select c.id, c.category, c.section, c.preview_url, c.aspect_ratio,
           c.figma_url, c.status, c.is_private, c.is_published,
           c.created_at, c.copy_count, c.featured, c.creator_pinned_at,
           c.rejection_reason
    from components c
    where c.uploaded_by = target
      and (
        privileged
        or (c.status = 'approved' and c.is_private = false and c.is_published = true)
      )
    -- Creator's manual order leads (newest pin first), then newest design.
    order by c.creator_pinned_at desc nulls last, c.created_at desc;
end;
$$;
grant execute on function public.get_creator_designs(text) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- RPC: update_creator_bio(target, new_bio) — set a creator's bio. Allowed when
-- the caller IS the target or is an admin (admins may edit any creator page).
-- Empty/whitespace bio is stored as null. SECURITY DEFINER so an admin can
-- write a row that isn't their own (profiles RLS is own-row only).
-- ---------------------------------------------------------------------------
create or replace function public.update_creator_bio(target uuid, new_bio text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare caller uuid := auth.uid();
begin
  if caller is null then
    return false;
  end if;
  if caller <> target and not exists (
    select 1 from profiles where id = caller and role = 'admin'
  ) then
    return false;
  end if;
  update profiles set bio = nullif(btrim(left(coalesce(new_bio, ''), 280)), '')
  where id = target;
  return true;
end;
$$;
grant execute on function public.update_creator_bio(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- RPC: set_design_privacy(design_id, make_private) — flip a design's privacy.
-- Allowed for the design's owner OR an admin, regardless of publish state (the
-- column-restrictive "owner update own" policy forbids editing a live design,
-- so this DEFINER fn is how the creator page toggles privacy on live blocks).
-- ---------------------------------------------------------------------------
create or replace function public.set_design_privacy(design_id uuid, make_private boolean)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  caller uuid := auth.uid();
  owner  uuid;
begin
  if caller is null then
    return false;
  end if;
  select uploaded_by into owner from components where id = design_id;
  if owner is null then
    return false;
  end if;
  if caller <> owner and not exists (
    select 1 from profiles where id = caller and role = 'admin'
  ) then
    return false;
  end if;
  update components set is_private = make_private where id = design_id;
  return true;
end;
$$;
grant execute on function public.set_design_privacy(uuid, boolean) to authenticated;

-- ---------------------------------------------------------------------------
-- RPC: delete_design(design_id) — delete a design. Owner or admin only. The
-- owner/admin DELETE policies already permit this via a direct delete, but
-- routing it through one DEFINER fn keeps the creator page's owner-or-admin
-- authorization in a single place.
-- ---------------------------------------------------------------------------
create or replace function public.delete_design(design_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  caller uuid := auth.uid();
  owner  uuid;
begin
  if caller is null then
    return false;
  end if;
  select uploaded_by into owner from components where id = design_id;
  if owner is null then
    return false;
  end if;
  if caller <> owner and not exists (
    select 1 from profiles where id = caller and role = 'admin'
  ) then
    return false;
  end if;
  delete from components where id = design_id;
  return true;
end;
$$;
grant execute on function public.delete_design(uuid) to authenticated;

-- Return columns changed (added id + bio) — drop first, since CREATE OR REPLACE
-- can't alter a function's OUT signature.
drop function if exists public.list_creators();
create or replace function public.list_creators()
returns table (id uuid, username text, full_name text, avatar_url text, bio text, count bigint)
language sql
stable
security definer
set search_path = public
as $$
  -- INNER JOIN: only creators with at least one live (published/public/approved)
  -- design appear, so selecting one always shows components in the gallery.
  select p.id, p.username, p.full_name, p.avatar_url, p.bio, count(c.id) as count
  from public.profiles p
  join public.components c
    on c.uploaded_by = p.id
   and c.is_published = true
   and c.is_private = false
   and c.status = 'approved'
  where p.username is not null
  group by p.id, p.username, p.full_name, p.avatar_url, p.bio
  order by count desc, p.full_name asc;
$$;
grant execute on function public.list_creators() to anon, authenticated;

-- ---------------------------------------------------------------------------
-- RPC: get_sidebar_counts() — pre-aggregated badge counts for the home sidebar.
-- Counts ONLY gallery-visible components: published AND NOT private. Runs under
-- the service-role client (which bypasses RLS), so the is_private filter is
-- explicit here — otherwise private designs would still be counted even though
-- they're hidden from the gallery. Returns:
--   { categories: { "<Category>": n },
--     sections:   { "<Category>|<Section>": n },
--     logoLetters: [ "A", "B", … ]  -- Logos letters that have ≥1 component }
-- ---------------------------------------------------------------------------
create or replace function public.get_sidebar_counts()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  with vis as (
    select category, section, filters
    from public.components
    where is_published = true
      and is_private = false
  )
  select jsonb_build_object(
    'categories', coalesce((
      select jsonb_object_agg(category, c)
      from (
        select category, count(*) as c
        from vis where category is not null group by category
      ) a
    ), '{}'::jsonb),
    'sections', coalesce((
      select jsonb_object_agg(category || '|' || section, c)
      from (
        select category, section, count(*) as c
        from vis where category is not null and section is not null
        group by category, section
      ) b
    ), '{}'::jsonb),
    'logoLetters', coalesce((
      select jsonb_agg(distinct f)
      from vis, unnest(coalesce(filters, '{}'::text[])) as f
      where category = 'Logos'
    ), '[]'::jsonb)
  );
$$;
grant execute on function public.get_sidebar_counts() to anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- RPC: get_creator_counts(creator_ids uuid[]) — per-creator design status
-- counts for the admin Creators page, aggregated in-DB (no raw component rows
-- pulled to JS). live = approved + published + public.
-- ---------------------------------------------------------------------------
create or replace function public.get_creator_counts(creator_ids uuid[])
returns table (
  uploaded_by uuid,
  total       bigint,
  live        bigint,
  pending     bigint,
  rejected    bigint
)
language sql
stable
security definer
set search_path = public
as $$
  select
    c.uploaded_by,
    count(*) as total,
    count(*) filter (
      where c.status = 'approved' and c.is_published and not c.is_private
    ) as live,
    count(*) filter (where c.status = 'pending') as pending,
    count(*) filter (where c.status = 'rejected') as rejected
  from public.components c
  where c.uploaded_by = any (creator_ids)
  group by c.uploaded_by;
$$;
grant execute on function public.get_creator_counts(uuid[]) to service_role;
revoke execute on function public.get_creator_counts(uuid[])
  from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- RPC: get_creator_sidebar_counts(creator_id) — category / section / logo-letter
-- badge counts for ONE creator, aggregated in-DB. Mirrors get_sidebar_counts but
-- scoped to a single uploader, over their LIVE designs only (approved + public +
-- published). Replaces the client pulling every component row just to tally in
-- JS. Public-safe (only live designs), so granted to anon/authenticated.
-- ---------------------------------------------------------------------------
create or replace function public.get_creator_sidebar_counts(creator_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  with live as (
    select category, section, filters
    from public.components
    where uploaded_by = creator_id
      and is_published = true and is_private = false and status = 'approved'
  )
  select jsonb_build_object(
    'categories', (
      select coalesce(jsonb_object_agg(category, n), '{}'::jsonb)
      from (
        select category, count(*) n from live
        where category is not null group by category
      ) t
    ),
    'sections', (
      select coalesce(jsonb_object_agg(category || '|' || section, n), '{}'::jsonb)
      from (
        select category, section, count(*) n from live
        where category is not null and section is not null
        group by category, section
      ) t
    ),
    'logoLetters', (
      select coalesce(jsonb_agg(distinct f), '[]'::jsonb)
      from live, unnest(coalesce(filters, '{}')) f
      where category = 'Logos'
    )
  );
$$;
grant execute on function public.get_creator_sidebar_counts(uuid) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- RPC: list_admin_ids() — ids of admins who have at least one LIVE design. Backs
-- the "Lander Studio" sidebar entry; the client scopes the gallery to
-- uploaded_by IN these ids. Restricted to admins WITH live uploads so it never
-- discloses an admin id the gallery rows don't already carry (every admin upload
-- already exposes its uploaded_by). security definer is the public read path
-- since profiles RLS is "own row only".
-- ---------------------------------------------------------------------------
create or replace function public.list_admin_ids()
returns uuid[]
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(array_agg(distinct p.id), '{}'::uuid[])
  from public.profiles p
  join public.components c
    on c.uploaded_by = p.id
   and c.is_published = true
   and c.is_private = false
   and c.status = 'approved'
  where p.role = 'admin';
$$;
grant execute on function public.list_admin_ids() to anon, authenticated;

-- ---------------------------------------------------------------------------
-- RPC: get_lander_sidebar_counts() — category / section / logo-letter badge
-- counts for the "Lander Studio" view: every LIVE design (approved + public +
-- published) uploaded directly by an admin. Mirrors get_creator_sidebar_counts
-- but scoped to the whole admin set instead of one uploader.
-- ---------------------------------------------------------------------------
create or replace function public.get_lander_sidebar_counts()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  with live as (
    select category, section, filters
    from public.components
    where uploaded_by in (select id from public.profiles where role = 'admin')
      and is_published = true and is_private = false and status = 'approved'
  )
  select jsonb_build_object(
    'categories', (
      select coalesce(jsonb_object_agg(category, n), '{}'::jsonb)
      from (
        select category, count(*) n from live
        where category is not null group by category
      ) t
    ),
    'sections', (
      select coalesce(jsonb_object_agg(category || '|' || section, n), '{}'::jsonb)
      from (
        select category, section, count(*) n from live
        where category is not null and section is not null
        group by category, section
      ) t
    ),
    'logoLetters', (
      select coalesce(jsonb_agg(distinct f), '[]'::jsonb)
      from live, unnest(coalesce(filters, '{}')) f
      where category = 'Logos'
    )
  );
$$;
grant execute on function public.get_lander_sidebar_counts() to anon, authenticated;

-- =============================================================================
-- Analytics RPCs (admin-only; called via the service-role client which bypasses
-- RLS). Aggregate inside Postgres so the analytics page never pulls raw event
-- rows to JS. Persisted here so a fresh deploy doesn't lose them.
-- =============================================================================

-- get_per_user_activity(activity_date) — per-user copy activity for one IST day:
-- one row per user who copied that day, with their copy count, the components
-- they copied (most recent first) and their most recent copy time. Ordered by
-- most recent copy. Powers the "Per-user activity" table.
drop function if exists public.get_per_user_activity(date);
create or replace function public.get_per_user_activity(activity_date date)
returns table (
  user_id       uuid,
  copies_count  bigint,
  component_ids uuid[],
  last_copy     timestamptz
)
language sql
stable
as $$
  select
    ce.user_id,
    count(*) as copies_count,
    array_agg(ce.component_id order by ce.copied_at desc) as component_ids,
    max(ce.copied_at) as last_copy
  from public.copy_events ce
  where ce.date = activity_date
    and ce.user_id is not null
  group by ce.user_id
  order by max(ce.copied_at) desc;
$$;
-- Admin-only: lock to the service-role client (the analytics page). Without the
-- explicit service_role grant the revoke would also strip the default PUBLIC
-- access it relies on, so grant first, then revoke from everyone else.
grant execute on function public.get_per_user_activity(date) to service_role;
revoke execute on function public.get_per_user_activity(date)
  from public, anon, authenticated;

-- get_analytics_windows(d_today, d_start7, d_date) — all KPI windows in a single
-- round trip as a JSON object keyed by window ('today','7d','all', and 'date'
-- when d_date is non-null). Each value: totalCopies, uniqueCopiers, totalLogins,
-- dau, newAccounts, byCategory. dau = average daily active users (distinct users
-- who logged in OR copied per day, averaged over the window's days; today/date =
-- that day's count). All metrics computed in-DB.
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
    from public.copy_events ce where ce.date <= d_today
  ),
  la as (
    select
      count(*) filter (where le.date = d_today)                   as t_total,
      count(*) filter (where le.date between d_start7 and d_today) as w_total,
      count(*)                                                     as a_total,
      count(*) filter (where d_date is not null and le.date = d_date) as d_total
    from public.login_events le where le.date <= d_today
  ),
  pa as (
    select
      count(*) filter (where d::date = d_today)                   as t_new,
      count(*) filter (where d::date between d_start7 and d_today) as w_new,
      count(*)                                                     as a_new,
      count(*) filter (where d_date is not null and d::date = d_date) as d_new
    from (select (p.created_at at time zone 'Asia/Kolkata') as d from public.profiles p) s
  ),
  cat as (
    select c.category,
      count(*) filter (where ce.date = d_today)                   as t_c,
      count(*) filter (where ce.date between d_start7 and d_today) as w_c,
      count(*)                                                     as a_c,
      count(*) filter (where d_date is not null and ce.date = d_date) as d_c
    from public.copy_events ce
    join public.components c on c.id = ce.component_id
    where ce.date <= d_today
    group by c.category
  ),
  act as (
    select user_id, date from public.copy_events  where date <= d_today and user_id is not null
    union all
    select user_id, date from public.login_events where date <= d_today and user_id is not null
  ),
  dd as (select date, count(distinct user_id) as u from act group by date),
  ad as (
    select
      round(coalesce(sum(u) filter (where date = d_today), 0))::int as t_dau,
      round(coalesce(sum(u) filter (where date between d_start7 and d_today), 0)::numeric
            / greatest(1, (d_today - d_start7 + 1)))::int as w_dau,
      round(coalesce(sum(u), 0)::numeric
            / greatest(1, (d_today - coalesce(min(date), d_today) + 1)))::int as a_dau,
      round(coalesce(sum(u) filter (where d_date is not null and date = d_date), 0))::int as d_dau
    from dd
  )
  select jsonb_build_object(
    'today', jsonb_build_object(
      'totalCopies', ca.t_total, 'uniqueCopiers', ca.t_uniq,
      'totalLogins', la.t_total, 'dau', ad.t_dau, 'newAccounts', pa.t_new,
      'byCategory', (select coalesce(jsonb_object_agg(category, t_c) filter (where category is not null), '{}'::jsonb) from cat)),
    '7d', jsonb_build_object(
      'totalCopies', ca.w_total, 'uniqueCopiers', ca.w_uniq,
      'totalLogins', la.w_total, 'dau', ad.w_dau, 'newAccounts', pa.w_new,
      'byCategory', (select coalesce(jsonb_object_agg(category, w_c) filter (where category is not null), '{}'::jsonb) from cat)),
    'all', jsonb_build_object(
      'totalCopies', ca.a_total, 'uniqueCopiers', ca.a_uniq,
      'totalLogins', la.a_total, 'dau', ad.a_dau, 'newAccounts', pa.a_new,
      'byCategory', (select coalesce(jsonb_object_agg(category, a_c) filter (where category is not null), '{}'::jsonb) from cat)),
    'date', case when d_date is null then null else jsonb_build_object(
      'totalCopies', ca.d_total, 'uniqueCopiers', ca.d_uniq,
      'totalLogins', la.d_total, 'dau', ad.d_dau, 'newAccounts', pa.d_new,
      'byCategory', (select coalesce(jsonb_object_agg(category, d_c) filter (where category is not null), '{}'::jsonb) from cat)) end
  ) into result from ca, la, pa, ad;
  return result;
end;
$$;
-- Admin-only: lock to the service-role client (analytics page). Grant first,
-- then revoke the default PUBLIC access.
grant execute on function public.get_analytics_windows(date, date, date) to service_role;
revoke execute on function public.get_analytics_windows(date, date, date)
  from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- get_component_detail(p_id) — one component (NO figma_data) joined with its
-- creator's public profile, in a single call. Drives the component detail view.
-- Visible to anyone for published+public components; the owner and admins may
-- read their own / any (incl. pending / private / rejected). SECURITY DEFINER so
-- the gating is explicit (admins have no broad components SELECT policy).
-- ---------------------------------------------------------------------------
create or replace function public.get_component_detail(p_id uuid)
returns table (
  id                   uuid,
  category             text,
  section              text,
  filters              text[],
  copy_count           int,
  figma_url            text,
  preview_url          text,
  aspect_ratio         numeric,
  colors               jsonb,
  is_published         boolean,
  is_private           boolean,
  status               text,
  featured             boolean,
  created_at           timestamptz,
  uploaded_by          uuid,
  creator_username      text,
  creator_display_name  text,
  creator_avatar_url    text,
  creator_bio           text,
  creator_x_handle      text,
  creator_instagram_handle text,
  creator_linkedin_handle  text,
  creator_website_url   text,
  creator_cta_url       text,
  creator_design_count  bigint
)
language sql
stable
security definer
set search_path = public
as $$
  select
    c.id, c.category, c.section, c.filters, c.copy_count, c.figma_url,
    c.preview_url, c.aspect_ratio, c.colors, c.is_published, c.is_private,
    c.status, c.featured, c.created_at, c.uploaded_by,
    p.username   as creator_username,
    p.full_name  as creator_display_name,
    p.avatar_url as creator_avatar_url,
    p.bio        as creator_bio,
    p.x_handle, p.instagram_handle, p.linkedin_handle, p.website_url, p.cta_url,
    coalesce((
      select count(*) from public.components c2
      where c2.uploaded_by = c.uploaded_by
        and c2.is_published = true and c2.is_private = false
        and c2.status = 'approved'
    ), 0) as creator_design_count
  from public.components c
  left join public.profiles p on p.id = c.uploaded_by
  where c.id = p_id
    and (
      (c.is_published = true and c.is_private = false)
      or c.uploaded_by = auth.uid()
      or exists (
        select 1 from public.profiles me
        where me.id = auth.uid() and me.role = 'admin'
      )
    );
$$;
grant execute on function public.get_component_detail(uuid) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- get_creator_by_id(p_id) — the per-CREATOR lightbox card (public profile +
-- live published design_count), keyed by uploaded_by. The gallery row already
-- carries the per-component bits (copy_count, created_at, figma_url), so the
-- lightbox fetches creator data once per creator and caches it client-side by
-- uploaded_by — opening any of a creator's components costs at most one call.
-- SECURITY DEFINER: profiles RLS is "own row only", so this is the public read
-- path. Returns no row for a null/unknown id (admin uploads have no creator).
-- ---------------------------------------------------------------------------
-- Return columns changed (added is_admin) → drop before recreate.
drop function if exists public.get_creator_by_id(uuid);
create or replace function public.get_creator_by_id(p_id uuid)
returns table (
  creator_username      text,
  creator_display_name  text,
  creator_avatar_url    text,
  creator_bio           text,
  creator_x_handle      text,
  creator_instagram_handle text,
  creator_linkedin_handle  text,
  creator_website_url   text,
  creator_cta_url       text,
  creator_design_count  bigint,
  is_admin              boolean
)
language sql
stable
security definer
set search_path = public
as $$
  select
    p.username, p.full_name, p.avatar_url, p.bio,
    p.x_handle, p.instagram_handle, p.linkedin_handle, p.website_url, p.cta_url,
    coalesce((
      select count(*) from public.components c2
      where c2.is_published = true and c2.is_private = false
        and c2.status = 'approved'
        and (
          -- Admin uploads render as the single "Lander Studio" agency card, so
          -- its count is the COMBINED total of every admin's uploads (not just
          -- this admin's). Real creators count only their own.
          case when p.role = 'admin'
            then c2.uploaded_by in (
              select id from public.profiles where role = 'admin'
            )
            else c2.uploaded_by = p.id
          end
        )
    ), 0) as creator_design_count,
    -- Admin uploads have no real creator profile → the client renders a fixed
    -- "Lander Studio" agency card instead of the admin's personal profile.
    (p.role = 'admin') as is_admin
  from public.profiles p
  where p.id = p_id;
$$;
grant execute on function public.get_creator_by_id(uuid) to anon, authenticated;

-- Speeds the status-filtered aggregate counts (approval analytics) at scale.
create index if not exists components_status_idx on public.components (status);

-- ---------------------------------------------------------------------------
-- get_approval_stats(d_today, d_start7) — moderation pipeline totals per window
-- (today / last-7-days / all-time) for the admin approvals analytics. Scoped to
-- CREATOR submissions (uploaders with an approved creator application); admin
-- uploads bypass moderation and are excluded. Windowed by the submission's IST
-- creation day. Aggregated in-DB; called via the service-role client.
-- ---------------------------------------------------------------------------
drop function if exists public.get_approval_stats();
create or replace function public.get_approval_stats(d_today date, d_start7 date)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  with sub as (
    select
      c.status,
      c.uploaded_by,
      (c.created_at at time zone 'Asia/Kolkata')::date as d
    from public.components c
    where c.uploaded_by in (
      select user_id from public.creator_applications where status = 'approved'
    )
  )
  select jsonb_build_object(
    'today', (
      select jsonb_build_object(
        'total', count(*),
        'approved', count(*) filter (where status = 'approved'),
        'rejected', count(*) filter (where status = 'rejected'),
        'pending', count(*) filter (where status = 'pending'),
        'creators_uploaded', count(distinct uploaded_by)
      ) from sub where d = d_today),
    '7d', (
      select jsonb_build_object(
        'total', count(*),
        'approved', count(*) filter (where status = 'approved'),
        'rejected', count(*) filter (where status = 'rejected'),
        'pending', count(*) filter (where status = 'pending'),
        'creators_uploaded', count(distinct uploaded_by)
      ) from sub where d between d_start7 and d_today),
    'all', (
      select jsonb_build_object(
        'total', count(*),
        'approved', count(*) filter (where status = 'approved'),
        'rejected', count(*) filter (where status = 'rejected'),
        'pending', count(*) filter (where status = 'pending'),
        'creators_uploaded', count(distinct uploaded_by)
      ) from sub)
  );
$$;
grant execute on function public.get_approval_stats(date, date) to service_role;
revoke execute on function public.get_approval_stats(date, date)
  from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- get_application_stats(d_today, d_start7) — Creator Program application counts
-- per window (today / 7d / all), windowed by the application's IST creation day.
-- ---------------------------------------------------------------------------
create or replace function public.get_application_stats(d_today date, d_start7 date)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  with a as (
    select status, (created_at at time zone 'Asia/Kolkata')::date as d
    from public.creator_applications
  )
  select jsonb_build_object(
    'today', (
      select jsonb_build_object(
        'total', count(*),
        'pending', count(*) filter (where status = 'pending'),
        'approved', count(*) filter (where status = 'approved'),
        'rejected', count(*) filter (where status = 'rejected')
      ) from a where d = d_today),
    '7d', (
      select jsonb_build_object(
        'total', count(*),
        'pending', count(*) filter (where status = 'pending'),
        'approved', count(*) filter (where status = 'approved'),
        'rejected', count(*) filter (where status = 'rejected')
      ) from a where d between d_start7 and d_today),
    'all', (
      select jsonb_build_object(
        'total', count(*),
        'pending', count(*) filter (where status = 'pending'),
        'approved', count(*) filter (where status = 'approved'),
        'rejected', count(*) filter (where status = 'rejected')
      ) from a)
  );
$$;
grant execute on function public.get_application_stats(date, date) to service_role;
revoke execute on function public.get_application_stats(date, date)
  from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- search_by_color(search_hexes) — server-side color search. Matches published,
-- public components against 1–2 picked colors using the precomputed colors_hsl
-- (falls back to converting colors[].hex for legacy rows). Match mode is decided
-- per SEARCH color: very dark/light → lightness ±15; gray → lightness ±20; else
-- hue family (±30° circular, sat ±55, light ±40) — mirrors the old client logic.
-- Score = sum of best matched pct per search color (a row hitting both ranks
-- highest). Returns ONLY grant-safe columns (NO figma_data, NO colors_hsl) plus
-- uploaded_by so the client can scope results to one creator's portal, top 300
-- by score. Replaces pulling the whole catalog to the client.
-- ---------------------------------------------------------------------------
-- Return columns changed (added uploaded_by, so the creator portal can scope
-- color results to one creator) → drop before recreate.
drop function if exists public.search_by_color(text[]);
create or replace function public.search_by_color(search_hexes text[])
returns table (
  id           uuid,
  category     text,
  section      text,
  filters      text[],
  preview_url  text,
  aspect_ratio numeric,
  colors       jsonb,
  uploaded_by  uuid
)
language sql
stable
security definer
set search_path = public
as $$
  with searches as (
    select
      u.idx,
      h.hsl[1] as sh, h.hsl[2] as ss, h.hsl[3] as sl,
      (h.hsl[3] < 20 or h.hsl[3] > 80) as dark_light,
      (h.hsl[2] < 10) as gray
    from unnest(search_hexes) with ordinality as u(hex, idx)
    cross join lateral (select public.hsl_from_hex(u.hex) as hsl) h
    where h.hsl is not null
  ),
  matches as (
    select c.id, sr.idx, max((elem ->> 'pct')::numeric) as pct
    from public.components c
    cross join lateral
      jsonb_array_elements(coalesce(c.colors_hsl, c.colors)) as elem
    cross join lateral (
      select case
        when elem ? 'h' then array[
          (elem ->> 'h')::numeric, (elem ->> 's')::numeric, (elem ->> 'l')::numeric
        ]
        else public.hsl_from_hex(elem ->> 'hex')
      end as eh
    ) ev
    cross join searches sr
    where c.is_published = true
      and c.is_private = false
      and coalesce(c.colors_hsl, c.colors) is not null
      and jsonb_typeof(coalesce(c.colors_hsl, c.colors)) = 'array'
      and ev.eh is not null
      and (
        case
          when sr.dark_light then abs(ev.eh[3] - sr.sl) <= 15
          when sr.gray       then abs(ev.eh[3] - sr.sl) <= 20
          else least(abs(ev.eh[1] - sr.sh), 360 - abs(ev.eh[1] - sr.sh)) <= 30
               and abs(ev.eh[2] - sr.ss) <= 55
               and abs(ev.eh[3] - sr.sl) <= 40
        end
      )
    group by c.id, sr.idx
  ),
  scored as (
    select id, sum(pct) as score from matches group by id
  )
  select c.id, c.category, c.section, c.filters, c.preview_url, c.aspect_ratio, c.colors, c.uploaded_by
  from scored s
  join public.components c on c.id = s.id
  order by s.score desc nulls last
  limit 300;
$$;
grant execute on function public.search_by_color(text[]) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- Mirror profiles.role into auth.users.raw_app_meta_data so the middleware can
-- authorize from the JWT (getUser() returns app_metadata, server-fresh) WITHOUT
-- a second DB round trip per protected navigation — that extra query was what
-- stalled the creator portal (and its loading skeleton) for 2-3s on cold
-- serverless. SECURITY DEFINER so it can write the auth schema.
-- ---------------------------------------------------------------------------
create or replace function public.sync_role_to_jwt()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' or new.role is distinct from old.role then
    update auth.users
      set raw_app_meta_data =
        coalesce(raw_app_meta_data, '{}'::jsonb)
        || jsonb_build_object('role', new.role)
      where id = new.id;
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_sync_role_to_jwt on public.profiles;
create trigger profiles_sync_role_to_jwt
  after insert or update of role on public.profiles
  for each row
  execute function public.sync_role_to_jwt();

-- Backfill existing users' app_metadata.role from their current profile role.
update auth.users u
  set raw_app_meta_data =
    coalesce(u.raw_app_meta_data, '{}'::jsonb)
    || jsonb_build_object('role', p.role)
  from public.profiles p
  where p.id = u.id and p.role is not null;
