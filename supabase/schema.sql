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
  -- beta: unlocks all categories. Self-claimed by visiting the beta link while
  -- logged in (the "Profiles: update own" policy permits the user to set it).
  beta         boolean     not null default false,
  created_at   timestamptz not null default now()
);
-- Backfill for databases created before the beta column existed.
alter table public.profiles add column if not exists beta boolean not null default false;

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
  insert into public.profiles (id, full_name, avatar_url)
  values (
    new.id,
    coalesce(
      new.raw_user_meta_data ->> 'full_name',
      new.raw_user_meta_data ->> 'name'
    ),
    coalesce(
      new.raw_user_meta_data ->> 'avatar_url',
      new.raw_user_meta_data ->> 'picture'
    )
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
grant insert (id, full_name, avatar_url, bio, username, creator_onboarded, beta)
  on public.profiles to authenticated;
-- `id` is included so PostgREST upserts work (ON CONFLICT DO UPDATE sets every
-- payload column, including the PK). It's safe: the "update own" RLS with-check
-- (auth.uid() = id) forbids changing id to anyone else's — it can only ever be
-- set back to the user's own id. `role`, `copies_today`, `last_copy_date` stay
-- OUT (the whole point) so privilege escalation / limit-reset remain blocked.
grant update (id, full_name, avatar_url, bio, username, creator_onboarded, beta)
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
  if owner = uid and pub = false then
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

-- A creator may edit their own design only while it's not yet published
-- (pending or rejected); the row must stay unpublished/non-approved after edit.
drop policy if exists "Components: owner update own" on public.components;
create policy "Components: owner update own"
  on public.components
  for update
  to authenticated
  using (uploaded_by = auth.uid() and is_published = false)
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
-- Upload rate limit: a creator may insert at most 20 components per rolling
-- hour. Enforced in a BEFORE INSERT trigger (not the client) so it can't be
-- bypassed. Admins are exempt. The raised message surfaces to the UploadForm.
-- ---------------------------------------------------------------------------
create or replace function public.enforce_creator_upload_rate()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  uploader_role text;
  recent        int;
begin
  select role into uploader_role from profiles where id = new.uploaded_by;
  -- Admins have no upload cap.
  if uploader_role = 'admin' then
    return new;
  end if;
  select count(*) into recent
  from components
  where uploaded_by = new.uploaded_by
    and created_at > now() - interval '1 hour';
  if recent >= 20 then
    raise exception 'Only 20 components allowed per hour';
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
    'created_at', p.created_at
  )
  from public.profiles p
  where lower(p.username) = lower(btrim(uname));
$$;
grant execute on function public.get_creator(text) to anon, authenticated;

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

-- ---------------------------------------------------------------------------
-- RPC: get_window_stats(start_date, end_date) — analytics KPIs for an IST day
-- window, aggregated entirely in the DB. Replaces pulling every copy/login row
-- to JS just to count uniques. Returns one row:
--   total_copies, unique_copiers, total_logins, unique_logins, new_accounts.
-- new_accounts uses the IST day boundaries [start 00:00, (end+1) 00:00).
-- SECURITY DEFINER + STABLE; analytics calls it via the service-role client.
-- ---------------------------------------------------------------------------
create or replace function public.get_window_stats(start_date date, end_date date)
returns table (
  total_copies  bigint,
  unique_copiers bigint,
  total_logins  bigint,
  unique_logins bigint,
  new_accounts  bigint
)
language sql
stable
security definer
set search_path = public
as $$
  select
    (select count(*)              from copy_events  where date between start_date and end_date),
    (select count(distinct user_id) from copy_events where date between start_date and end_date),
    (select count(*)              from login_events where date between start_date and end_date),
    (select count(distinct user_id) from login_events where date between start_date and end_date),
    (select count(*) from profiles
       where created_at >= ((start_date)::timestamp     at time zone 'Asia/Kolkata')
         and created_at <  ((end_date + 1)::timestamp   at time zone 'Asia/Kolkata'));
$$;
grant execute on function public.get_window_stats(date, date) to authenticated, service_role;

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
  creator_pinned_at timestamptz
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
           c.created_at, c.copy_count, c.featured, c.creator_pinned_at
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
  update profiles set bio = nullif(btrim(new_bio), '') where id = target;
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
