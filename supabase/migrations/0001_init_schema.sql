-- ============================================================================
-- 0001_init_schema.sql
-- Sistema de Gestão de Metas — V1
-- Migration 1/N: estrutura de tabelas, chaves e constraints estruturais.
-- NÃO inclui RLS, policies, funções de cálculo/aprovação nem seed — isso vem
-- em migrations seguintes, como etapas verificáveis separadas (doc. 10).
-- ============================================================================

create extension if not exists pgcrypto; -- gen_random_uuid()

-- Função utilitária: mantém updated_at sempre corrente em UPDATE.
create or replace function set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

-- ============================================================================
-- ORGANIZAÇÃO: Regionais e Áreas
-- ============================================================================

create table regionals (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  code        text not null unique,
  active      boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create trigger trg_regionals_updated_at before update on regionals
  for each row execute function set_updated_at();

create table areas (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  code        text not null unique,
  active      boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create trigger trg_areas_updated_at before update on areas
  for each row execute function set_updated_at();

-- Uma Área pode existir em mais de uma Regional (ex.: "Facilities" em Norte
-- e Sudeste ao mesmo tempo). Metas sempre referenciam um par Área+Regional
-- que precisa existir aqui — a checagem cruzada é feita em migration futura
-- (função/trigger), não dá para expressar como CHECK simples de coluna.
create table area_regionals (
  id           uuid primary key default gen_random_uuid(),
  area_id      uuid not null references areas(id),
  regional_id  uuid not null references regionals(id),
  active       boolean not null default true,
  unique (area_id, regional_id)
);
create index idx_area_regionals_regional on area_regionals(regional_id);

-- ============================================================================
-- SEGURANÇA: Perfis e Permissões (perfil + escopo + estado — doc. 03)
-- ============================================================================

create table roles (
  id      uuid primary key default gen_random_uuid(),
  name    text not null,
  code    text not null unique, -- 'administrador' | 'gestor' | 'usuario'
  active  boolean not null default true
);

create table permissions (
  id           uuid primary key default gen_random_uuid(),
  name         text not null,
  code         text not null unique,
  description  text,
  active       boolean not null default true
);

create table role_permissions (
  role_id        uuid not null references roles(id) on delete cascade,
  permission_id  uuid not null references permissions(id) on delete cascade,
  unique (role_id, permission_id)
);

-- ============================================================================
-- PESSOAS
-- ============================================================================

-- employee = pessoa física da organização (pode não ter login no sistema).
-- área/regional aqui representam a lotação principal da pessoa, usada para
-- exibição e para o escopo padrão de acesso — não para peso individual em
-- metas: metas são coletivas por Área (doc. 01), não há rateio por pessoa.
create table employees (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  email       text,
  cargo       text, -- Coordenador, Supervisor, Analista etc. — não é o Perfil
  area_id     uuid references areas(id),
  regional_id uuid references regionals(id),
  status      text not null default 'ativo' check (status in ('ativo', 'inativo')),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index idx_employees_area on employees(area_id);
create index idx_employees_regional on employees(regional_id);
create trigger trg_employees_updated_at before update on employees
  for each row execute function set_updated_at();

-- users.id = auth.users.id (Supabase Auth é a fonte da senha/autenticação;
-- esta tabela só guarda o vínculo com employee + status de acesso).
create table users (
  id             uuid primary key references auth.users(id) on delete cascade,
  employee_id    uuid references employees(id),
  email          text not null unique,
  status         text not null default 'ativo' check (status in ('ativo', 'inativo')),
  created_at     timestamptz not null default now(),
  last_login_at  timestamptz
);
create index idx_users_employee on users(employee_id);

create table user_roles (
  user_id  uuid not null references users(id) on delete cascade,
  role_id  uuid not null references roles(id) on delete cascade,
  unique (user_id, role_id)
);

-- Escopo do Usuário/Gestor. area_id nulo = acesso à Regional inteira
-- (todas as áreas daquela regional), conforme doc. 02.
create table user_access (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references users(id) on delete cascade,
  regional_id  uuid not null references regionals(id),
  area_id      uuid references areas(id),
  active       boolean not null default true
);
create index idx_user_access_user on user_access(user_id);

-- ============================================================================
-- INDICADORES
-- ============================================================================

create table measurement_units (
  id      uuid primary key default gen_random_uuid(),
  name    text not null,
  code    text not null unique, -- ex.: '%', 'R$', 'dias', 'unid'
  active  boolean not null default true
);

create table indicators (
  id                   uuid primary key default gen_random_uuid(),
  name                 text not null,
  description          text,
  value_type           text, -- ex.: 'numero' | 'percentual' | 'moeda' | 'tempo' — livre, não há enum fechado no doc.
  measurement_unit_id  uuid references measurement_units(id),
  direction            text not null check (direction in ('maior_melhor', 'menor_melhor')),
  active               boolean not null default true,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);
create trigger trg_indicators_updated_at before update on indicators
  for each row execute function set_updated_at();

-- ============================================================================
-- CICLO E METAS
-- ============================================================================

create table goal_cycles (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  year        integer not null,
  status      text not null default 'ativo' check (status in ('ativo', 'encerrado')),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create trigger trg_goal_cycles_updated_at before update on goal_cycles
  for each row execute function set_updated_at();

create table goals (
  id           uuid primary key default gen_random_uuid(),
  cycle_id     uuid not null references goal_cycles(id),
  regional_id  uuid not null references regionals(id),
  area_id      uuid not null references areas(id),
  indicator_id uuid not null references indicators(id),
  weight       numeric(5,2) not null check (weight >= 0 and weight <= 100), -- em %
  -- 'ativa' = conta para o fechamento da Área; 'excluida' = exclusão lógica
  -- (doc. 04: "Exclusão é lógica/controlada, preservando histórico").
  status       text not null default 'ativa' check (status in ('ativa', 'excluida')),
  created_by   uuid references users(id),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index idx_goals_cycle_area on goals(cycle_id, area_id);
create index idx_goals_regional on goals(regional_id);
create trigger trg_goals_updated_at before update on goals
  for each row execute function set_updated_at();

-- Faixas fixas 80/90/100/110/120 (doc. 01/07) — target_value é o valor real
-- correspondente a cada faixa para ESTA meta (ex.: faixa 100% = R$50.000).
create table goal_ranges (
  id                     uuid primary key default gen_random_uuid(),
  goal_id                uuid not null references goals(id) on delete cascade,
  attainment_percentage  numeric(5,2) not null check (attainment_percentage in (80, 90, 100, 110, 120)),
  target_value           numeric not null,
  unique (goal_id, attainment_percentage)
);
create index idx_goal_ranges_goal on goal_ranges(goal_id);

-- ============================================================================
-- APURAÇÃO
-- ============================================================================

-- status espelha o motor de cálculo já validado no painel de referência:
-- 'pendente'  = aguardando apuração (entra como 0% no consolidado)
-- 'critico'   = abaixo do mínimo (faixa 80%)
-- 'parcial'   = atingiu parcialmente
-- 'atingido'  = atingiu ou superou (teto 120%)
create table goal_results (
  id                     uuid primary key default gen_random_uuid(),
  goal_id                uuid not null references goals(id),
  real_value             numeric,
  realization_month      date, -- mês de apuração (dia fixado em 1)
  realization_date       timestamptz,
  attainment_percentage  numeric(6,2) check (attainment_percentage >= 0 and attainment_percentage <= 120),
  weighted_result        numeric(6,2), -- cache de attainment% × peso, recalculado em toda escrita
  status                 text not null default 'pendente' check (status in ('pendente', 'critico', 'parcial', 'atingido')),
  created_by             uuid references users(id),
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);
create index idx_goal_results_goal on goal_results(goal_id);
create trigger trg_goal_results_updated_at before update on goal_results
  for each row execute function set_updated_at();

-- Histórico imutável de toda alteração de resultado (nunca apagar).
create table goal_result_history (
  id                       uuid primary key default gen_random_uuid(),
  goal_result_id           uuid not null references goal_results(id),
  action                   text not null, -- 'lancamento' | 'alteracao_aprovada' | ...
  previous_value           numeric,
  new_value                numeric,
  previous_attainment      numeric(6,2),
  new_attainment           numeric(6,2),
  previous_weighted_result numeric(6,2),
  new_weighted_result      numeric(6,2),
  justification            text,
  performed_by             uuid references users(id),
  performed_at             timestamptz not null default now()
);
create index idx_goal_result_history_result on goal_result_history(goal_result_id);

-- ============================================================================
-- APROVAÇÃO
-- ============================================================================

create table approval_requests (
  id            uuid primary key default gen_random_uuid(),
  request_type  text not null, -- 'inclusao' | 'alteracao_meta' | 'alteracao_resultado' | 'exclusao' | 'reabertura'
  goal_id       uuid references goals(id),
  requester_id  uuid not null references users(id),
  status        text not null default 'pendente' check (status in ('pendente', 'aprovada', 'reprovada')),
  justification text,
  created_at    timestamptz not null default now(),
  resolved_at   timestamptz
);
create index idx_approval_requests_status on approval_requests(status);
create index idx_approval_requests_requester on approval_requests(requester_id);

create table approval_request_items (
  id               uuid primary key default gen_random_uuid(),
  request_id       uuid not null references approval_requests(id) on delete cascade,
  field_name       text not null,
  previous_value   text,
  requested_value  text,
  action           text -- 'criar' | 'alterar' | 'excluir'
);

create table approval_actions (
  id            uuid primary key default gen_random_uuid(),
  request_id    uuid not null references approval_requests(id) on delete cascade,
  approver_id   uuid not null references users(id),
  action        text not null check (action in ('aprovar', 'reprovar')),
  -- justificativa obrigatória em reprovação (doc. 01) — reforçado por
  -- trigger/validação de aplicação na migration de funções, não só aqui.
  justification text,
  created_at    timestamptz not null default now()
);

-- ============================================================================
-- FECHAMENTO, NOTIFICAÇÕES E AUDITORIA
-- ============================================================================

create table area_closures (
  id             uuid primary key default gen_random_uuid(),
  area_id        uuid not null references areas(id),
  regional_id    uuid not null references regionals(id),
  cycle_id       uuid not null references goal_cycles(id),
  status         text not null default 'aberta' check (status in ('aberta', 'fechada')),
  closed_by      uuid references users(id),
  closed_at      timestamptz,
  reopened_by    uuid references users(id),
  reopened_at    timestamptz,
  reopen_reason  text,
  unique (area_id, regional_id, cycle_id)
);
create index idx_area_closures_cycle on area_closures(cycle_id);

create table notifications (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references users(id) on delete cascade,
  type        text not null,
  title       text not null,
  message     text,
  read        boolean not null default false,
  created_at  timestamptz not null default now()
);
create index idx_notifications_user_unread on notifications(user_id, read);

create table audit_logs (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid references users(id),
  action      text not null,
  entity      text not null,
  entity_id   uuid,
  old_data    jsonb,
  new_data    jsonb,
  created_at  timestamptz not null default now(),
  ip_address  inet
);
create index idx_audit_logs_entity on audit_logs(entity, entity_id);
create index idx_audit_logs_user on audit_logs(user_id);
