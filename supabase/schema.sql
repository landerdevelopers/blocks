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
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid references public.profiles (id) on delete cascade,
  date       date        not null default current_date,
  created_at timestamptz not null default now()
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

-- profiles: a logged-in user manages only their own row (RLS scopes it to
-- auth.uid()). anon needs no access.
grant select, insert, update on public.profiles to authenticated;

-- components: everyone may read (published-only via RLS); writes are admin-only
-- (gated by the policies below).
grant select on public.components to anon, authenticated;
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
-- user from updating those columns directly. Logs a copy_events row.
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
begin
  if uid is null then
    return json_build_object('success', false, 'reason', 'unauthenticated');
  end if;

  select * into prof from profiles where id = uid;

  if prof.last_copy_date = today_ist then
    if prof.copies_today >= 10 then
      return json_build_object('success', false, 'reason', 'limit_reached');
    end if;
  else
    update profiles set copies_today = 0, last_copy_date = today_ist where id = uid;
    prof.copies_today := 0;
  end if;

  update profiles
  set copies_today = copies_today + 1, last_copy_date = today_ist
  where id = uid;

  insert into copy_events (user_id, component_id, date)
  values (uid, component_id, today_ist);

  return json_build_object('success', true, 'copies_today', prof.copies_today + 1);
end;
$$;
