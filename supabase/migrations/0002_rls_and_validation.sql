-- ============================================================================
-- 0002_rls_and_validation.sql
-- Sistema de Gestão de Metas — V1
-- Migration 2/N: RLS por perfil+escopo, funções de apoio, motor de cálculo
-- de atingimento (discreto, sem interpolação, teto 120%) e as validações
-- críticas que a migration 1 deixou como constraint cruzada (peso=100% no
-- fechamento, Área+Regional válida, autoaprovação impossível).
--
-- NÃO inclui as funções completas de workflow (solicitar, aprovar, fechar,
-- reabrir) como RPCs transacionais — isso é a migration 3. Esta migration
-- garante que, mesmo antes dessas RPCs existirem, o banco já rejeita os
-- estados inválidos por conta própria (defesa em profundidade).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 0. Ajustes de schema pendentes da migration 1
-- ----------------------------------------------------------------------------

-- "Gestor pode ser configurado como Global" (doc. 03) — estendendo o mesmo
-- padrão que já existe para area_id (nulo = toda a regional): regional_id
-- nulo = todas as regionais (só faz sentido pra Gestor; Administrador já é
-- global pelo próprio perfil, não precisa de linha em user_access).
alter table user_access alter column regional_id drop not null;
alter table user_access add constraint chk_user_access_area_requires_regional
  check (regional_id is not null or area_id is null);

-- V1 não relança meta já apurada (doc. 01) — um resultado por meta;
-- correções passam por aprovação e atualizam esta mesma linha.
alter table goal_results add constraint uq_goal_results_goal unique (goal_id);

-- Reprovação exige justificativa obrigatória (doc. 01/04) — reforço em
-- banco, não só validação de formulário.
alter table approval_actions add constraint chk_reprovacao_justificativa
  check (action <> 'reprovar' or justification is not null);

-- ----------------------------------------------------------------------------
-- 1. Funções de apoio para perfil + escopo (usadas nas policies de RLS)
--    SECURITY DEFINER: consultam roles/user_roles/user_access ignorando a
--    RLS dessas tabelas, pra evitar recursão de policy chamando policy.
-- ----------------------------------------------------------------------------

create or replace function fn_has_role(p_user uuid, p_role_code text)
returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from user_roles ur
    join roles r on r.id = ur.role_id
    where ur.user_id = p_user and r.code = p_role_code and r.active
  );
$$;

create or replace function fn_is_admin(p_user uuid)
returns boolean
language sql stable security definer set search_path = public as $$
  select fn_has_role(p_user, 'administrador');
$$;

create or replace function fn_has_permission(p_user uuid, p_perm_code text)
returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from user_roles ur
    join role_permissions rp on rp.role_id = ur.role_id
    join permissions p on p.id = rp.permission_id
    where ur.user_id = p_user and p.code = p_perm_code and p.active
  );
$$;

-- Admin sempre tem escopo. Gestor/Usuário: precisa de uma linha ativa em
-- user_access que cubra (regional, área) — global, regional inteira, ou
-- área específica, nessa ordem de abrangência.
create or replace function fn_has_scope(p_user uuid, p_regional uuid, p_area uuid)
returns boolean
language sql stable security definer set search_path = public as $$
  select
    fn_is_admin(p_user)
    or exists (
      select 1 from user_access ua
      where ua.user_id = p_user
        and ua.active
        and (
          ua.regional_id is null
          or (ua.regional_id = p_regional and ua.area_id is null)
          or (ua.regional_id = p_regional and ua.area_id = p_area)
        )
    );
$$;

-- ----------------------------------------------------------------------------
-- 2. Motor de cálculo — atingimento por faixa discreta, sem interpolação.
--    Pega a maior faixa cujo critério o Real satisfaz; se nenhuma, 0;
--    teto 120% (não há faixa acima disso pra bater de qualquer forma,
--    o teto aqui é redundância de segurança).
-- ----------------------------------------------------------------------------

create or replace function fn_calc_attainment(p_goal_id uuid, p_real numeric)
returns numeric
language plpgsql stable as $$
declare
  v_direction text;
  v_result numeric := 0;
  v_band record;
begin
  if p_real is null then
    return null; -- não apurada
  end if;

  select i.direction into v_direction
  from goals g join indicators i on i.id = g.indicator_id
  where g.id = p_goal_id;

  if v_direction is null then
    raise exception 'Meta % não encontrada ou sem indicador com direção definida.', p_goal_id;
  end if;

  for v_band in
    select attainment_percentage, target_value
    from goal_ranges
    where goal_id = p_goal_id
    order by attainment_percentage desc
  loop
    if v_direction = 'maior_melhor' and p_real >= v_band.target_value then
      v_result := v_band.attainment_percentage;
      exit;
    elsif v_direction = 'menor_melhor' and p_real <= v_band.target_value then
      v_result := v_band.attainment_percentage;
      exit;
    end if;
  end loop;

  return least(greatest(v_result, 0), 120);
end;
$$;

-- ----------------------------------------------------------------------------
-- 3. Validação estrutural: toda Meta precisa ter um par Área+Regional que
--    exista em area_regionals (não dá pra expressar como CHECK simples).
-- ----------------------------------------------------------------------------

create or replace function fn_check_goal_area_regional()
returns trigger language plpgsql as $$
begin
  if not exists (
    select 1 from area_regionals ar
    where ar.area_id = new.area_id and ar.regional_id = new.regional_id and ar.active
  ) then
    raise exception 'A Área % não está vinculada à Regional % (cadastre em area_regionals antes de criar a meta).', new.area_id, new.regional_id;
  end if;
  return new;
end;
$$;

create trigger trg_goals_check_area_regional
before insert or update of area_id, regional_id on goals
for each row execute function fn_check_goal_area_regional();

-- ----------------------------------------------------------------------------
-- 4. Validação crítica: Área só fecha com todas as metas aplicáveis
--    apuradas E peso total = 100%. Vale independente de qual caminho leva
--    a essa gravação (app hoje, função de workflow amanhã).
-- ----------------------------------------------------------------------------

create or replace function fn_check_area_closure()
returns trigger language plpgsql as $$
declare
  v_pending int;
  v_weight numeric;
begin
  if new.status = 'fechada' and (old is null or old.status is distinct from 'fechada') then
    select count(*) into v_pending
    from goals g
    left join goal_results gr on gr.goal_id = g.id
    where g.area_id = new.area_id and g.regional_id = new.regional_id
      and g.cycle_id = new.cycle_id and g.status = 'ativa'
      and (gr.id is null or gr.status = 'pendente');

    if v_pending > 0 then
      raise exception 'Área não pode ser fechada: % meta(s) aplicável(is) ainda não apurada(s).', v_pending;
    end if;

    select coalesce(sum(weight), 0) into v_weight
    from goals
    where area_id = new.area_id and regional_id = new.regional_id
      and cycle_id = new.cycle_id and status = 'ativa';

    if v_weight <> 100 then
      raise exception 'Área não pode ser fechada: peso total das metas ativas é % (precisa ser 100).', v_weight;
    end if;
  end if;
  return new;
end;
$$;

create trigger trg_area_closures_check
before insert or update of status on area_closures
for each row execute function fn_check_area_closure();

-- ----------------------------------------------------------------------------
-- 5. RLS — habilitar em todas as tabelas de negócio e aplicar policies por
--    perfil + escopo (doc. 03). Convenção: dado de referência (regionals,
--    areas, indicators, measurement_units, goal_cycles, area_regionals) é
--    visível a qualquer usuário autenticado — a informação sensível é
--    goals/goal_results/employees pra baixo, onde o escopo realmente
--    importa. Decisão documentada em DECISIONS.md.
-- ----------------------------------------------------------------------------

alter table regionals enable row level security;
alter table areas enable row level security;
alter table area_regionals enable row level security;
alter table roles enable row level security;
alter table permissions enable row level security;
alter table role_permissions enable row level security;
alter table employees enable row level security;
alter table users enable row level security;
alter table user_roles enable row level security;
alter table user_access enable row level security;
alter table measurement_units enable row level security;
alter table indicators enable row level security;
alter table goal_cycles enable row level security;
alter table goals enable row level security;
alter table goal_ranges enable row level security;
alter table goal_results enable row level security;
alter table goal_result_history enable row level security;
alter table approval_requests enable row level security;
alter table approval_request_items enable row level security;
alter table approval_actions enable row level security;
alter table area_closures enable row level security;
alter table notifications enable row level security;
alter table audit_logs enable row level security;

-- Dado de referência: leitura livre pra autenticado, escrita só admin.
create policy ref_select on regionals for select using (auth.uid() is not null);
create policy ref_write  on regionals for all    using (fn_is_admin(auth.uid())) with check (fn_is_admin(auth.uid()));

create policy ref_select on areas for select using (auth.uid() is not null);
create policy ref_write  on areas for all    using (fn_is_admin(auth.uid())) with check (fn_is_admin(auth.uid()));

create policy ref_select on area_regionals for select using (auth.uid() is not null);
create policy ref_write  on area_regionals for all    using (fn_is_admin(auth.uid())) with check (fn_is_admin(auth.uid()));

create policy ref_select on measurement_units for select using (auth.uid() is not null);
create policy ref_write  on measurement_units for all    using (fn_is_admin(auth.uid())) with check (fn_is_admin(auth.uid()));

create policy ref_select on indicators for select using (auth.uid() is not null);
create policy ref_write  on indicators for all    using (fn_is_admin(auth.uid())) with check (fn_is_admin(auth.uid()));

create policy ref_select on goal_cycles for select using (auth.uid() is not null);
create policy ref_write  on goal_cycles for all    using (fn_is_admin(auth.uid())) with check (fn_is_admin(auth.uid()));

-- Segurança: só admin gerencia perfis/permissões.
create policy admin_only on roles             for all using (fn_is_admin(auth.uid())) with check (fn_is_admin(auth.uid()));
create policy admin_only on permissions       for all using (fn_is_admin(auth.uid())) with check (fn_is_admin(auth.uid()));
create policy admin_only on role_permissions  for all using (fn_is_admin(auth.uid())) with check (fn_is_admin(auth.uid()));

-- user_roles / user_access: admin gerencia; o próprio usuário pode ver os
-- seus (inofensivo, ajuda a UI a saber o próprio escopo).
create policy admin_manage on user_roles  for all    using (fn_is_admin(auth.uid())) with check (fn_is_admin(auth.uid()));
create policy self_select  on user_roles  for select using (user_id = auth.uid());
create policy admin_manage on user_access for all    using (fn_is_admin(auth.uid())) with check (fn_is_admin(auth.uid()));
create policy self_select  on user_access for select using (user_id = auth.uid());

-- employees: visível dentro do escopo; gerido por admin ou gestor com
-- permissão explícita (doc. 03: "Gerenciar usuários: Conforme permissão").
create policy scoped_select on employees for select
  using (fn_has_scope(auth.uid(), regional_id, area_id));
create policy scoped_write on employees for all
  using (fn_is_admin(auth.uid()) or (fn_has_role(auth.uid(), 'gestor') and fn_has_permission(auth.uid(), 'gerenciar_usuarios') and fn_has_scope(auth.uid(), regional_id, area_id)))
  with check (fn_is_admin(auth.uid()) or (fn_has_role(auth.uid(), 'gestor') and fn_has_permission(auth.uid(), 'gerenciar_usuarios') and fn_has_scope(auth.uid(), regional_id, area_id)));

-- users: cada um vê a si mesmo; admin/gestor com permissão vê no escopo
-- (via employee vinculado).
create policy self_select on users for select using (id = auth.uid());
create policy scoped_select on users for select
  using (fn_is_admin(auth.uid()) or exists (
    select 1 from employees e where e.id = users.employee_id and fn_has_scope(auth.uid(), e.regional_id, e.area_id)
  ));
create policy admin_write on users for all
  using (fn_is_admin(auth.uid())) with check (fn_is_admin(auth.uid()));

-- goals: SELECT no escopo; criar/editar só admin/gestor no escopo (Usuário
-- nunca cria/edita meta — doc. 03). Sem policy de DELETE: exclusão é
-- lógica via UPDATE de status, coberta pela policy de UPDATE abaixo.
create policy scoped_select on goals for select
  using (fn_has_scope(auth.uid(), regional_id, area_id));
create policy scoped_write on goals for insert
  with check (fn_is_admin(auth.uid()) or (fn_has_role(auth.uid(), 'gestor') and fn_has_scope(auth.uid(), regional_id, area_id)));
create policy scoped_update on goals for update
  using (fn_is_admin(auth.uid()) or (fn_has_role(auth.uid(), 'gestor') and fn_has_scope(auth.uid(), regional_id, area_id)))
  with check (fn_is_admin(auth.uid()) or (fn_has_role(auth.uid(), 'gestor') and fn_has_scope(auth.uid(), regional_id, area_id)));

-- goal_ranges: segue o escopo da meta pai.
create policy scoped_select on goal_ranges for select
  using (exists (select 1 from goals g where g.id = goal_ranges.goal_id and fn_has_scope(auth.uid(), g.regional_id, g.area_id)));
create policy scoped_write on goal_ranges for all
  using (exists (select 1 from goals g where g.id = goal_ranges.goal_id and (fn_is_admin(auth.uid()) or (fn_has_role(auth.uid(), 'gestor') and fn_has_scope(auth.uid(), g.regional_id, g.area_id)))))
  with check (exists (select 1 from goals g where g.id = goal_ranges.goal_id and (fn_is_admin(auth.uid()) or (fn_has_role(auth.uid(), 'gestor') and fn_has_scope(auth.uid(), g.regional_id, g.area_id)))));

-- goal_results: SELECT no escopo. INSERT (1ª apuração) por admin/gestor
-- sempre, ou Usuário com permissão 'lancar_resultado' — tudo dentro do
-- escopo. SEM policy de UPDATE: alteração de resultado sempre passa por
-- aprovação, e isso só acontece via função SECURITY DEFINER (migration 3),
-- que roda como dono da tabela e ignora RLS — o cliente jamais atualiza
-- goal_results direto, nem sendo admin. Isso é o que torna a regra do
-- doc. 01 ("alteração sempre exige aprovação") garantida pelo banco, não
-- só pela tela.
create policy scoped_select on goal_results for select
  using (exists (select 1 from goals g where g.id = goal_results.goal_id and fn_has_scope(auth.uid(), g.regional_id, g.area_id)));
create policy scoped_insert on goal_results for insert
  with check (exists (
    select 1 from goals g where g.id = goal_results.goal_id and (
      fn_is_admin(auth.uid())
      or (fn_has_role(auth.uid(), 'gestor') and fn_has_scope(auth.uid(), g.regional_id, g.area_id))
      or (fn_has_permission(auth.uid(), 'lancar_resultado') and fn_has_scope(auth.uid(), g.regional_id, g.area_id))
    )
  ));

-- goal_result_history: só leitura no escopo; nenhuma policy de escrita —
-- só a função de aprovação (SECURITY DEFINER) grava aqui.
create policy scoped_select on goal_result_history for select
  using (fn_is_admin(auth.uid()) or exists (
    select 1 from goal_results gr join goals g on g.id = gr.goal_id
    where gr.id = goal_result_history.goal_result_id and fn_has_scope(auth.uid(), g.regional_id, g.area_id)
  ));

-- approval_requests: cada um vê as próprias; admin/gestor no escopo da
-- meta veem as do escopo (pra aprovar). Criar solicitação: qualquer
-- autenticado com escopo (admin/gestor sempre podem; usuário comum
-- também pode solicitar per doc. 03 "Se autorizado" — permissão
-- 'solicitar_alteracao' cobre esse caso).
create policy self_select on approval_requests for select using (requester_id = auth.uid());
create policy scoped_select on approval_requests for select
  using (fn_is_admin(auth.uid()) or (fn_has_role(auth.uid(), 'gestor') and exists (
    select 1 from goals g where g.id = approval_requests.goal_id and fn_has_scope(auth.uid(), g.regional_id, g.area_id)
  )));
create policy scoped_insert on approval_requests for insert
  with check (
    requester_id = auth.uid()
    and exists (select 1 from goals g where g.id = approval_requests.goal_id and (
      fn_is_admin(auth.uid())
      or fn_has_role(auth.uid(), 'gestor')
      or (fn_has_permission(auth.uid(), 'solicitar_alteracao') and fn_has_scope(auth.uid(), g.regional_id, g.area_id))
    ))
  );

-- approval_request_items: acompanha a request pai (mesma regra de select;
-- insert só quando a request ainda é do próprio solicitante).
create policy scoped_select on approval_request_items for select
  using (exists (select 1 from approval_requests r where r.id = approval_request_items.request_id and (
    r.requester_id = auth.uid() or fn_is_admin(auth.uid()) or fn_has_role(auth.uid(), 'gestor')
  )));
create policy scoped_insert on approval_request_items for insert
  with check (exists (select 1 from approval_requests r where r.id = approval_request_items.request_id and r.requester_id = auth.uid()));

-- approval_actions: autoaprovação impossível — aqui, no banco, não só na
-- tela. O aprovador precisa ser admin/gestor, ter escopo sobre a meta da
-- solicitação, e NÃO pode ser o próprio solicitante.
create policy scoped_select on approval_actions for select
  using (fn_is_admin(auth.uid()) or exists (
    select 1 from approval_requests r where r.id = approval_actions.request_id and (
      r.requester_id = auth.uid() or fn_has_role(auth.uid(), 'gestor')
    )
  ));
create policy no_self_approval on approval_actions for insert
  with check (
    approver_id = auth.uid()
    and (fn_is_admin(auth.uid()) or fn_has_role(auth.uid(), 'gestor'))
    and not exists (
      select 1 from approval_requests r where r.id = approval_actions.request_id and r.requester_id = auth.uid()
    )
    and exists (
      select 1 from approval_requests r join goals g on g.id = r.goal_id
      where r.id = approval_actions.request_id and fn_has_scope(auth.uid(), g.regional_id, g.area_id)
    )
  );

-- area_closures: SELECT no escopo; fechar/reabrir direto só admin/gestor
-- no escopo (a validação de peso=100%/metas apuradas é o trigger acima,
-- independente de quem grava).
create policy scoped_select on area_closures for select
  using (fn_has_scope(auth.uid(), regional_id, area_id));
create policy scoped_write on area_closures for all
  using (fn_is_admin(auth.uid()) or (fn_has_role(auth.uid(), 'gestor') and fn_has_scope(auth.uid(), regional_id, area_id)))
  with check (fn_is_admin(auth.uid()) or (fn_has_role(auth.uid(), 'gestor') and fn_has_scope(auth.uid(), regional_id, area_id)));

-- notifications: só a própria — leitura e marcar como lida. Inserção é
-- sempre via função/trigger do sistema (nenhuma policy de insert aqui).
create policy self_select on notifications for select using (user_id = auth.uid());
create policy self_update on notifications for update
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- audit_logs: exclusiva do Administrador (doc. 03/05); gravação só via
-- função/trigger do sistema.
create policy admin_only_select on audit_logs for select using (fn_is_admin(auth.uid()));
