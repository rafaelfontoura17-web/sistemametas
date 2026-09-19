-- ============================================================================
-- 0003_approval_workflow.sql
-- Sistema de Gestão de Metas — V1
-- Migration 3/N: workflow de aprovação completo (solicitar, aprovar,
-- reprovar, efetivar, histórico, notificações).
-- Hierarquia de Gestor definida por escopo (decisão do usuário):
--   Gestor de Regional inteira > Gestor de Área específica dentro dela;
--   Gestor Global > qualquer Gestor de Regional/Área;
--   Administrador sempre pode aprovar, independente de hierarquia.
-- Construída em cima das funções fn_is_admin/fn_has_role/fn_has_scope/
-- fn_has_permission/fn_calc_attainment já definidas na migration 2.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 0. approval_requests precisa do escopo (regional/área/ciclo) direto na
-- linha — "reabertura" não tem goal_id (é sobre o fechamento de uma Área
-- inteira, não sobre uma meta específica), então só goal_id não bastava
-- pra saber quem pode aprovar nem pra achar a solicitação certa.
-- ----------------------------------------------------------------------------

alter table approval_requests add column if not exists regional_id uuid references regionals(id);
alter table approval_requests add column if not exists area_id uuid references areas(id);
alter table approval_requests add column if not exists cycle_id uuid references goal_cycles(id);

update approval_requests ar set
  regional_id = g.regional_id, area_id = g.area_id
from goals g where g.id = ar.goal_id and ar.regional_id is null;

alter table approval_requests alter column regional_id set not null;
alter table approval_requests alter column area_id set not null;

do $$ begin
  alter table approval_requests add constraint chk_approval_requests_type
    check (request_type in ('alteracao_meta', 'alteracao_resultado', 'exclusao', 'reabertura'));
exception when duplicate_object then null; end $$;

do $$ begin
  alter table approval_requests add constraint chk_approval_requests_reabertura_cycle
    check (request_type <> 'reabertura' or cycle_id is not null);
exception when duplicate_object then null; end $$;

do $$ begin
  alter table approval_requests add constraint chk_approval_requests_goal
    check (request_type = 'reabertura' or goal_id is not null);
exception when duplicate_object then null; end $$;

-- ----------------------------------------------------------------------------
-- 1. Amplitude de escopo (pra comparar Gestor requerente vs. aprovador).
-- 3 = global, 2 = regional inteira, 1 = área específica, 0 = sem acesso.
-- Mesmo critério de fn_has_scope, só que devolvendo o "nível" em vez de
-- booleano — necessário pra decidir QUAL Gestor é hierarquicamente acima.
-- ----------------------------------------------------------------------------

create or replace function fn_gestor_scope_level(p_user uuid, p_regional uuid, p_area uuid)
returns int language sql stable security definer set search_path = public as $$
  select coalesce(max(
    case
      when ua.regional_id is null then 3
      when ua.regional_id = p_regional and ua.area_id is null then 2
      when ua.regional_id = p_regional and ua.area_id = p_area then 1
      else 0
    end
  ), 0)
  from user_access ua
  where ua.user_id = p_user and ua.active;
$$;

-- ----------------------------------------------------------------------------
-- 2. Elegibilidade de aprovador — regra central da hierarquia + autoaprovação.
-- ----------------------------------------------------------------------------

create or replace function fn_is_eligible_approver(p_request_id uuid, p_approver uuid)
returns boolean language plpgsql stable security definer set search_path = public as $$
declare
  v_req approval_requests;
begin
  select * into v_req from approval_requests where id = p_request_id;
  if v_req.id is null or v_req.status <> 'pendente' then
    return false;
  end if;
  if v_req.requester_id = p_approver then
    return false; -- autoaprovação: nunca, sob nenhuma circunstância
  end if;
  if fn_is_admin(p_approver) then
    return true; -- Admin aprova sempre (doc. 03)
  end if;
  if not fn_has_role(p_approver, 'gestor') then
    return false; -- Usuário nunca aprova (doc. 03)
  end if;
  if not fn_has_scope(p_approver, v_req.regional_id, v_req.area_id) then
    return false;
  end if;
  if fn_has_role(v_req.requester_id, 'gestor') then
    -- requerente também é Gestor: só um Gestor de escopo ESTRITAMENTE
    -- mais amplo pode aprovar (hierarquia por escopo).
    return fn_gestor_scope_level(p_approver, v_req.regional_id, v_req.area_id)
         > fn_gestor_scope_level(v_req.requester_id, v_req.regional_id, v_req.area_id);
  end if;
  -- requerente é Usuário comum: qualquer Gestor com acesso ao escopo serve.
  return true;
end;
$$;

create or replace function fn_can_approve(p_request_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select fn_is_eligible_approver(p_request_id, auth.uid());
$$;

-- ----------------------------------------------------------------------------
-- 3. As policies "scoped_insert"/"scoped_select" de approval_requests, e
-- "no_self_approval" de approval_actions (migration 2), validavam escopo
-- só através de goals.goal_id — mas "reabertura" não tem goal_id. Refeitas
-- aqui usando as colunas de escopo da própria approval_requests (seção 0),
-- que cobrem os dois casos, e a policy de approval_actions ganha a
-- hierarquia (fn_gestor_scope_level), que a versão da migration 2 não
-- tinha como expressar ainda.
-- ----------------------------------------------------------------------------

drop policy if exists scoped_select on approval_requests;
create policy scoped_select on approval_requests for select using (
  fn_is_admin(auth.uid())
  or (fn_has_role(auth.uid(), 'gestor') and fn_has_scope(auth.uid(), regional_id, area_id))
);

drop policy if exists scoped_insert on approval_requests;
create policy scoped_insert on approval_requests for insert with check (
  requester_id = auth.uid()
  and (
    (request_type <> 'reabertura' and exists (
      select 1 from goals g where g.id = approval_requests.goal_id and (
        fn_is_admin(auth.uid())
        or fn_has_role(auth.uid(), 'gestor')
        or (fn_has_permission(auth.uid(), 'solicitar_alteracao') and fn_has_scope(auth.uid(), g.regional_id, g.area_id))
      )
    ))
    or
    (request_type = 'reabertura'
      and fn_has_scope(auth.uid(), regional_id, area_id)
      and (fn_is_admin(auth.uid()) or fn_has_role(auth.uid(), 'gestor') or fn_has_permission(auth.uid(), 'solicitar_alteracao'))
      and exists (
        select 1 from area_closures ac
        where ac.area_id = approval_requests.area_id and ac.regional_id = approval_requests.regional_id
          and ac.cycle_id = approval_requests.cycle_id and ac.status = 'fechada'
      )
    )
  )
);

drop policy if exists no_self_approval on approval_actions;
create policy no_self_approval on approval_actions for insert with check (
  approver_id = auth.uid()
  and exists (
    select 1 from approval_requests r
    where r.id = approval_actions.request_id
      and r.requester_id <> auth.uid()
      and r.status = 'pendente'
      and (
        fn_is_admin(auth.uid())
        or (
          fn_has_role(auth.uid(), 'gestor')
          and fn_has_scope(auth.uid(), r.regional_id, r.area_id)
          and (
            not fn_has_role(r.requester_id, 'gestor')
            or fn_gestor_scope_level(auth.uid(), r.regional_id, r.area_id)
               > fn_gestor_scope_level(r.requester_id, r.regional_id, r.area_id)
          )
        )
      )
  )
);

-- ----------------------------------------------------------------------------
-- 4. Motor de cálculo — a migration 2 definiu fn_calc_attainment() como
-- função pura, mas nada ainda gravava o resultado em goal_results. Este
-- trigger fecha essa lacuna: toda vez que real_value é definido/alterado,
-- recalcula attainment_percentage, weighted_result e status automaticamente
-- — o cliente nunca envia esses três campos manualmente.
-- ----------------------------------------------------------------------------

create or replace function fn_apply_goal_result()
returns trigger language plpgsql as $$
declare
  v_weight numeric;
begin
  if new.real_value is null then
    new.attainment_percentage := null;
    new.weighted_result := null;
    new.status := 'pendente';
    return new;
  end if;

  select weight into v_weight from goals where id = new.goal_id;

  new.attainment_percentage := fn_calc_attainment(new.goal_id, new.real_value);
  new.weighted_result := round((new.attainment_percentage / 100.0) * v_weight, 2);
  new.status := case
    when new.attainment_percentage = 0 then 'critico'
    when new.attainment_percentage < 100 then 'parcial'
    else 'atingido'
  end;
  return new;
end;
$$;

create trigger trg_apply_goal_result
  before insert or update of real_value on goal_results
  for each row execute function fn_apply_goal_result();

-- ----------------------------------------------------------------------------
-- 5. Criar solicitação — única porta de entrada pra approval_request_items
-- (a tabela em si aceita insert direto via RLS, mas os itens só entram
-- por aqui) e ponto central de notificação dos aprovadores elegíveis.
-- p_items: array de {"field_name","previous_value","requested_value","action"}.
-- ----------------------------------------------------------------------------

create or replace function fn_notify_eligible_approvers(p_request_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_req approval_requests;
  v_candidate record;
begin
  select * into v_req from approval_requests where id = p_request_id;
  for v_candidate in
    select distinct u.id
    from users u
    where fn_is_admin(u.id)
       or (fn_has_role(u.id, 'gestor') and exists (
             select 1 from user_access ua
             where ua.user_id = u.id and ua.active
               and (ua.regional_id is null or ua.regional_id = v_req.regional_id)
           ))
  loop
    if fn_is_eligible_approver(p_request_id, v_candidate.id) then
      insert into notifications (user_id, type, title, message)
      values (v_candidate.id, 'aprovacao_pendente', 'Nova solicitação aguardando aprovação',
              'Tipo: ' || v_req.request_type || '. Justificativa: ' || coalesce(v_req.justification, '(sem justificativa)'));
    end if;
  end loop;
end;
$$;

create or replace function create_approval_request(
  p_request_type text,
  p_goal_id uuid,
  p_regional_id uuid,
  p_area_id uuid,
  p_cycle_id uuid,
  p_justification text,
  p_items jsonb
) returns approval_requests
language plpgsql security definer set search_path = public as $$
declare
  v_req approval_requests;
  v_item jsonb;
begin
  insert into approval_requests (request_type, goal_id, regional_id, area_id, cycle_id, requester_id, justification)
  values (p_request_type, p_goal_id, p_regional_id, p_area_id, p_cycle_id, auth.uid(), p_justification)
  returning * into v_req;
  -- a validação de quem pode solicitar o quê já é garantida pela policy
  -- scoped_insert (seção 3) — se chegou aqui, é porque passou nela.

  if p_items is not null then
    for v_item in select * from jsonb_array_elements(p_items) loop
      insert into approval_request_items (request_id, field_name, previous_value, requested_value, action)
      values (v_req.id, v_item->>'field_name', v_item->>'previous_value', v_item->>'requested_value', v_item->>'action');
    end loop;
  end if;

  perform fn_notify_eligible_approvers(v_req.id);

  return v_req;
end;
$$;

-- ----------------------------------------------------------------------------
-- 6. Aprovar — efetiva a mudança, registra histórico/auditoria e notifica
-- o solicitante. Cada request_type sabe aplicar a si mesmo.
-- ----------------------------------------------------------------------------

create or replace function approve_request(p_request_id uuid, p_justification text default null)
returns approval_requests
language plpgsql security definer set search_path = public as $$
declare
  v_req approval_requests;
  v_new_real numeric;
  v_new_weight numeric;
  v_old_result goal_results;
  v_new_result goal_results;
  v_reopened int;
begin
  if not fn_can_approve(p_request_id) then
    raise exception 'Sem permissão para aprovar esta solicitação.';
  end if;

  select * into v_req from approval_requests where id = p_request_id;

  case v_req.request_type
    when 'alteracao_resultado' then
      select requested_value::numeric into v_new_real
      from approval_request_items where request_id = v_req.id and field_name = 'real_value' limit 1;

      select * into v_old_result from goal_results where goal_id = v_req.goal_id;

      update goal_results set real_value = v_new_real
      where goal_id = v_req.goal_id
      returning * into v_new_result; -- dispara trg_apply_goal_result e recalcula tudo

      insert into goal_result_history (
        goal_result_id, action, previous_value, new_value,
        previous_attainment, new_attainment, previous_weighted_result, new_weighted_result,
        justification, performed_by
      ) values (
        v_old_result.id, 'alteracao_aprovada', v_old_result.real_value, v_new_result.real_value,
        v_old_result.attainment_percentage, v_new_result.attainment_percentage,
        v_old_result.weighted_result, v_new_result.weighted_result,
        v_req.justification, auth.uid()
      );

    when 'alteracao_meta' then
      select requested_value::numeric into v_new_weight
      from approval_request_items where request_id = v_req.id and field_name = 'weight' limit 1;
      update goals set weight = v_new_weight where id = v_req.goal_id;

    when 'exclusao' then
      update goals set status = 'excluida' where id = v_req.goal_id;

    when 'reabertura' then
      update area_closures
      set status = 'aberta', reopened_by = auth.uid(), reopened_at = now(), reopen_reason = v_req.justification
      where area_id = v_req.area_id and regional_id = v_req.regional_id and cycle_id = v_req.cycle_id
        and status = 'fechada';
      get diagnostics v_reopened = row_count;
      if v_reopened = 0 then
        raise exception 'Não há fechamento ativo pra reabrir nesta Área/Regional/Ciclo.';
      end if;

    when 'inclusao' then
      raise exception 'Criação de meta é direta (Admin/Gestor), não passa por aprovação — não deveria existir uma solicitação deste tipo.';

    else
      raise exception 'Tipo de solicitação desconhecido: %', v_req.request_type;
  end case;

  update approval_requests set status = 'aprovada', resolved_at = now() where id = v_req.id
  returning * into v_req;

  insert into approval_actions (request_id, approver_id, action, justification)
  values (v_req.id, auth.uid(), 'aprovar', p_justification);

  insert into audit_logs (user_id, action, entity, entity_id, new_data)
  values (auth.uid(), 'aprovar_solicitacao', 'approval_requests', v_req.id, to_jsonb(v_req));

  insert into notifications (user_id, type, title, message)
  values (v_req.requester_id, 'solicitacao_aprovada', 'Solicitação aprovada',
          'Sua solicitação (' || v_req.request_type || ') foi aprovada.');

  return v_req;
end;
$$;

-- ----------------------------------------------------------------------------
-- 7. Reprovar — justificativa obrigatória, nada é efetivado.
-- ----------------------------------------------------------------------------

create or replace function reject_request(p_request_id uuid, p_justification text)
returns approval_requests
language plpgsql security definer set search_path = public as $$
declare
  v_req approval_requests;
begin
  if p_justification is null or length(trim(p_justification)) = 0 then
    raise exception 'Justificativa é obrigatória para reprovação.';
  end if;
  if not fn_can_approve(p_request_id) then
    raise exception 'Sem permissão para reprovar esta solicitação.';
  end if;

  update approval_requests set status = 'reprovada', resolved_at = now()
  where id = p_request_id
  returning * into v_req;

  insert into approval_actions (request_id, approver_id, action, justification)
  values (v_req.id, auth.uid(), 'reprovar', p_justification);

  insert into audit_logs (user_id, action, entity, entity_id, new_data)
  values (auth.uid(), 'reprovar_solicitacao', 'approval_requests', v_req.id, to_jsonb(v_req));

  insert into notifications (user_id, type, title, message)
  values (v_req.requester_id, 'solicitacao_reprovada', 'Solicitação reprovada', p_justification);

  return v_req;
end;
$$;
