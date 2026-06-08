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
  category     text check (category in ('Website', 'Mobile Apps', 'Dashboard', 'Logos')),
  section      text,
  filters      text[],
  copy_count   int         not null default 0,
  -- figma_url:   the Figma share link for the component/section.
  figma_url    text,
  -- preview_url: a Cloudinary URL for the preview image (no Supabase Storage
  --              bucket is used for previews).
  preview_url  text,
  -- Array of objects, e.g. [{"hex": "#3B82F6", "pct": 60}]
  colors       jsonb,
  uploaded_by  uuid references public.profiles (id) on delete set null,
  is_published boolean     not null default true,
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

-- Helpful indexes for the common access paths.
create index if not exists components_category_idx   on public.components (category);
create index if not exists components_published_idx  on public.components (is_published);
create index if not exists components_filters_idx    on public.components using gin (filters);
create index if not exists copy_events_user_idx      on public.copy_events (user_id);
create index if not exists copy_events_component_idx on public.copy_events (component_id);

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
-- Row Level Security
-- -----------------------------------------------------------------------------

alter table public.profiles    enable row level security;
alter table public.components  enable row level security;
alter table public.copy_events enable row level security;

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
-- RPC: search_by_color(search_hex text, tolerance int)
-- Unpacks each component's colors array, compares every color to search_hex by
-- per-channel RGB difference within `tolerance`, and returns matching published
-- components ordered by the matched color's pct descending.
-- STABLE; handles null/malformed input and null colors gracefully.
-- -----------------------------------------------------------------------------

create or replace function public.search_by_color(search_hex text, tolerance int)
returns setof public.components
language plpgsql
stable
as $$
declare
  hex text;
  sr  int;
  sg  int;
  sb  int;
  tol int := coalesce(tolerance, 0);
begin
  -- Bail out cleanly on null / malformed input.
  if search_hex is null then
    return;
  end if;

  hex := upper(trim(search_hex));
  if hex !~ '^#[0-9A-F]{6}$' then
    return;
  end if;

  -- Target RGB channels (hex pair -> 0..255).
  sr := ('x' || substr(hex, 2, 2))::bit(8)::int;
  sg := ('x' || substr(hex, 4, 2))::bit(8)::int;
  sb := ('x' || substr(hex, 6, 2))::bit(8)::int;

  return query
  select c.*
  from (
    -- One row per component: keep the highest pct among its matching colors.
    select distinct on (comp.id)
           comp.id,
           (elem ->> 'pct')::numeric as pct
    from public.components comp
    cross join lateral jsonb_array_elements(comp.colors) as elem
    where comp.is_published = true
      and comp.colors is not null
      and jsonb_typeof(comp.colors) = 'array'
      and (elem ->> 'hex') ~* '^#[0-9A-F]{6}$'
      and abs(('x' || substr(upper(elem ->> 'hex'), 2, 2))::bit(8)::int - sr) <= tol
      and abs(('x' || substr(upper(elem ->> 'hex'), 4, 2))::bit(8)::int - sg) <= tol
      and abs(('x' || substr(upper(elem ->> 'hex'), 6, 2))::bit(8)::int - sb) <= tol
    order by comp.id, (elem ->> 'pct')::numeric desc nulls last
  ) m
  join public.components c on c.id = m.id
  order by m.pct desc nulls last;
end;
$$;
