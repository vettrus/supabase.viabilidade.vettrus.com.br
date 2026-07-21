-- ============================================================================
-- 0001_admin_leads_kommo.sql
-- Painel /admin — tabelas base + RLS.
-- Rode no SQL Editor do Supabase Studio (supabase.viabilidade.vettrus.com.br).
-- Idempotente: pode rodar mais de uma vez.
-- ============================================================================

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- user_roles — papéis por usuário (admin). auth.users é gerenciado pelo GoTrue.
-- ---------------------------------------------------------------------------
create table if not exists public.user_roles (
  user_id    uuid        not null references auth.users (id) on delete cascade,
  role       text        not null default 'admin',
  created_at timestamptz not null default now(),
  primary key (user_id, role)
);

-- ---------------------------------------------------------------------------
-- leads — cada preenchimento da LP + resultado da sincronização Kommo.
-- Inserido pela edge function `submit-lead` (service role, bypassa RLS).
-- ---------------------------------------------------------------------------
create table if not exists public.leads (
  id              uuid        primary key default gen_random_uuid(),
  created_at      timestamptz not null default now(),
  name            text,
  email           text,
  phone           text,
  company         text,
  message         text,
  source_section  text,
  ab_assignments  jsonb       not null default '{}'::jsonb,
  utm             jsonb       not null default '{}'::jsonb,
  kommo_lead_id   text,
  kommo_synced_at timestamptz,
  kommo_error     text
);

create index if not exists leads_created_at_idx     on public.leads (created_at desc);
create index if not exists leads_kommo_lead_id_idx  on public.leads (kommo_lead_id);
create index if not exists leads_kommo_error_idx     on public.leads (kommo_error) where kommo_error is not null;

-- ---------------------------------------------------------------------------
-- site_content — armazém genérico de configuração/CMS por seção.
-- section = 'kommo_config' guarda credenciais + IDs de campo do Kommo.
-- ---------------------------------------------------------------------------
create table if not exists public.site_content (
  section    text        primary key,
  data       jsonb       not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Helper: is_admin() — SECURITY DEFINER evita recursão de RLS em user_roles.
-- ---------------------------------------------------------------------------
create or replace function public.is_admin(uid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.user_roles
    where user_id = uid and role = 'admin'
  );
$$;

revoke all on function public.is_admin(uuid) from public;
grant execute on function public.is_admin(uuid) to authenticated, anon;

-- ---------------------------------------------------------------------------
-- RLS. service_role (edge functions) bypassa tudo automaticamente.
-- ---------------------------------------------------------------------------
alter table public.user_roles   enable row level security;
alter table public.leads        enable row level security;
alter table public.site_content enable row level security;

-- user_roles: admin lê a lista; escrita só via service role (create/delete-admin).
drop policy if exists user_roles_admin_select on public.user_roles;
create policy user_roles_admin_select on public.user_roles
  for select to authenticated
  using (public.is_admin(auth.uid()));

-- leads: admin lê tudo pelo PostgREST. Escrita só via service role.
drop policy if exists leads_admin_select on public.leads;
create policy leads_admin_select on public.leads
  for select to authenticated
  using (public.is_admin(auth.uid()));

-- site_content: admin lê/escreve. Contém token do Kommo — NÃO exponha ao público.
drop policy if exists site_content_admin_all on public.site_content;
create policy site_content_admin_all on public.site_content
  for all to authenticated
  using (public.is_admin(auth.uid()))
  with check (public.is_admin(auth.uid()));

-- ---------------------------------------------------------------------------
-- Seed do primeiro admin. Rode o bootstrap (cria o usuário no GoTrue) ANTES,
-- ou depois re-execute só este bloco. Idempotente.
-- ---------------------------------------------------------------------------
insert into public.user_roles (user_id, role)
select id, 'admin' from auth.users where email = 'dev@vettrus.com.br'
on conflict (user_id, role) do nothing;
