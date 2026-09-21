-- ============================================================================
-- 0015_edit_scope_and_result_workflow.sql
-- Sistema de Gestão de Metas — V1
-- Migration 15/N: duas decisões de negócio novas, fechadas em conversa:
--
-- PONTO 1 — Usuário tem visualização (sempre a Regional inteira) separada
-- de edição (lista de Áreas específicas dentro dela). Gestor/Admin não
-- mudam (visualização = edição).
--
-- PONTO 2 — só o Administrador age direto (e mesmo assim, tecnicamente via
-- uma solicitação que se auto-aprova na hora, pelo rastro em auditoria).
-- Gestor e Usuário SEMPRE passam por aprovação pra qualquer resultado —
-- primeiro lançamento ou correção, não faz diferença mais. Isso substitui
-- o insert direto de goal_results por uma função única (submit_goal_result)
-- que decide sozinha se aplica na hora (Admin) ou cria solicitação
-- pendente (Gestor/Usuário).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. user_edit_access — escopo de EDIÇÃO, só relevante pra perfil usuario.
-- ----------------------------------------------------------------------------

create table user_edit_access (
  id        uuid primary key default gen_random_uuid(),
  user_id   uuid not null references users(id) on delete cascade,
  area_id   uuid not null references areas(id),
  active    boolean not null default true,
  unique (user_id, area_id)
);

-- Trava de segurança: só pode marcar pra edição uma Área que esteja
-- dentro da MESMA Regional que o usuário já vê (user_access com area_id
-- nulo = regional inteira). Nunca de outra Regional.
create or replace function fn_check_edit_access_area()
returns trigger language plpgsql set search_path = public as $$
declare
  v_regional_id uuid;
begin
  select regional_id into v_regional_id
  from user_access where user_id = new.user_id and area_id is null limit 1;

  if v_regional_id is null then
    raise exception 'Usuário não tem uma Regional de visualização definida — configure isso antes de escolher áreas de edição.';
  end if;

  if not exists (
    select 1 from area_regionals ar
    where ar.area_id = new.area_id and ar.regional_id = v_regional_id and ar.active
  ) then
    raise exception 'A Área % não pertence à Regional que este usuário visualiza.', new.area_id;
  end if;
  return new;
end;
$$;

create trigger trg_check_edit_access_area
before insert or update on user_edit_access
for each row execute function fn_check_edit_access_area();

alter table user_edit_access enable row level security;
create policy admin_manage on user_edit_access for all
  using (fn_is_admin(auth.uid())) with check (fn_is_admin(auth.uid()));
create policy self_select on user_edit_access for select using (user_id = auth.uid());

-- ----------------------------------------------------------------------------
-- 2. Quem pode SOLICITAR ação sobre o resultado de uma meta (não confundir
-- com quem pode APROVAR — isso é fn_can_approve/fn_is_eligible_approver).
-- ----------------------------------------------------------------------------

create or replace function fn_can_submit_result(p_user uuid, p_goal_id uuid)
returns boolean language plpgsql stable security definer set search_path = public as $$
declare
  v_goal goals;
begin
  select * into v_goal from goals where id = p_goal_id;
  if v_goal.id is null then return false; end if;

  if fn_is_admin(p_user) then return true; end if;

  if fn_has_role(p_user, 'gestor') then
    return fn_has_scope(p_user, v_goal.regional_id, v_goal.area_id);
  end if;

  if fn_has_role(p_user, 'usuario') then
    return fn_has_scope(p_user, v_goal.regional_id, v_goal.area_id)
       and exists (
         select 1 from user_edit_access uea
         where uea.user_id = p_user and uea.area_id = v_goal.area_id and uea.active
       );
  end if;

  return false;
end;
$$;

-- ----------------------------------------------------------------------------
-- 3. Efetivação da aprovação, extraída de approve_request pra ser
-- reaproveitada também pela auto-aprovação do Admin em submit_goal_result
-- — sem duplicar o "case" de cada tipo de solicitação em dois lugares.
-- Também ganhou o ramo de PRIMEIRO LANÇAMENTO (antes só existia correção;
-- agora lançamento inicial também pode chegar aqui vindo de Gestor/Usuário).
-- ----------------------------------------------------------------------------

create or replace function apply_approval_effect(p_request_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_req approval_requests;
  v_new_real numeric;
  v_new_real_pct numeric;
  v_new_weight numeric;
  v_old_result goal_results;
  v_new_result goal_results;
  v_has_pct_item boolean;
  v_reopened int;
begin
  select * into v_req from approval_requests where id = p_request_id;

  case v_req.request_type
    when 'alteracao_resultado' then
      select requested_value::numeric into v_new_real
      from approval_request_items where request_id = v_req.id and field_name = 'real_value' limit 1;
      select true, requested_value::numeric into v_has_pct_item, v_new_real_pct
      from approval_request_items where request_id = v_req.id and field_name = 'real_value_pct' limit 1;

      select * into v_old_result from goal_results where goal_id = v_req.goal_id;

      if v_old_result.id is null then
        -- primeiro lançamento (não existia antes de agora este ramo — só
        -- correção passava por aqui).
        insert into goal_results (goal_id, real_value, real_value_pct)
        values (v_req.goal_id, v_new_real, case when coalesce(v_has_pct_item, false) then v_new_real_pct else null end)
        returning * into v_new_result;

        insert into goal_result_history (
          goal_result_id, action, previous_value, new_value,
          previous_attainment, new_attainment, previous_weighted_result, new_weighted_result,
          justification, performed_by
        ) values (
          v_new_result.id, 'lancamento_aprovado', null, v_new_result.real_value,
          null, v_new_result.attainment_percentage, null, v_new_result.weighted_result,
          v_req.justification, auth.uid()
        );
      else
        if coalesce(v_has_pct_item, false) then
          update goal_results set real_value = v_new_real, real_value_pct = v_new_real_pct
          where goal_id = v_req.goal_id returning * into v_new_result;
        else
          update goal_results set real_value = v_new_real
          where goal_id = v_req.goal_id returning * into v_new_result;
        end if;

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
      end if;

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
      raise exception 'Criação de meta é direta (Admin/Gestor), não passa por aprovação.';

    else
      raise exception 'Tipo de solicitação desconhecido: %', v_req.request_type;
  end case;
end;
$$;

-- approve_request agora só orquestra (checa permissão, chama a efetivação
-- compartilhada, grava a ação/auditoria/notificação) — o "case" saiu daqui.
create or replace function approve_request(p_request_id uuid, p_justification text default null)
returns approval_requests
language plpgsql security definer set search_path = public as $$
declare
  v_req approval_requests;
begin
  if not fn_can_approve(p_request_id) then
    raise exception 'Sem permissão para aprovar esta solicitação.';
  end if;

  perform apply_approval_effect(p_request_id);

  update approval_requests set status = 'aprovada', resolved_at = now() where id = p_request_id
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
-- 4. submit_goal_result — ÚNICA porta de entrada pra lançar ou corrigir
-- resultado, pra qualquer perfil. Substitui o insert direto que existia
-- antes (removido na seção 5). Decide sozinha: Admin aplica e auto-aprova
-- na hora (com rastro completo); Gestor/Usuário sempre ficam pendentes.
-- ----------------------------------------------------------------------------

create or replace function submit_goal_result(
  p_goal_id uuid,
  p_real_value numeric,
  p_real_pct numeric default null,
  p_justification text default null
) returns approval_requests
language plpgsql security definer set search_path = public as $$
declare
  v_goal goals;
  v_old goal_results;
  v_req approval_requests;
begin
  select * into v_goal from goals where id = p_goal_id;
  if v_goal.id is null then
    raise exception 'Meta não encontrada.';
  end if;

  if not fn_can_submit_result(auth.uid(), p_goal_id) then
    raise exception 'Sem permissão para lançar ou corrigir esta meta.';
  end if;

  select * into v_old from goal_results where goal_id = p_goal_id;

  insert into approval_requests (request_type, goal_id, regional_id, area_id, cycle_id, requester_id, justification)
  values ('alteracao_resultado', p_goal_id, v_goal.regional_id, v_goal.area_id, v_goal.cycle_id, auth.uid(), p_justification)
  returning * into v_req;

  insert into approval_request_items (request_id, field_name, previous_value, requested_value)
  values (
    v_req.id, 'real_value',
    case when v_old.id is not null then v_old.real_value::text else null end,
    p_real_value::text
  );
  if p_real_pct is not null or (v_old.id is not null and v_old.real_value_pct is not null) then
    insert into approval_request_items (request_id, field_name, previous_value, requested_value)
    values (
      v_req.id, 'real_value_pct',
      case when v_old.id is not null then v_old.real_value_pct::text else null end,
      p_real_pct::text
    );
  end if;

  if fn_is_admin(auth.uid()) then
    -- Auto-aprovação: única situação em que autoaprovação é permitida —
    -- decisão de negócio explícita (só pra Admin, só aqui). Fica tudo
    -- registrado como se fosse aprovado por outra pessoa, só que na hora.
    perform apply_approval_effect(v_req.id);

    update approval_requests set status = 'aprovada', resolved_at = now() where id = v_req.id
    returning * into v_req;

    insert into approval_actions (request_id, approver_id, action, justification)
    values (v_req.id, auth.uid(), 'aprovar', 'Auto-aprovado (Administrador)');

    insert into audit_logs (user_id, action, entity, entity_id, new_data)
    values (auth.uid(), 'auto_aprovar_solicitacao', 'approval_requests', v_req.id, to_jsonb(v_req));
  else
    perform fn_notify_eligible_approvers(v_req.id);
  end if;

  return v_req;
end;
$$;

-- ----------------------------------------------------------------------------
-- 5. Bloqueia o caminho antigo — ninguém mais escreve em goal_results
-- direto pela tabela; tudo passa por submit_goal_result (Admin/Gestor/
-- Usuário) ou por approve_request (efetivação de uma solicitação já
-- aprovada). Não existe mais nenhuma policy de INSERT/UPDATE aqui.
-- ----------------------------------------------------------------------------

drop policy if exists scoped_insert on goal_results;

-- ----------------------------------------------------------------------------
-- 6. Grants — mesmo cuidado de sempre: revoga de PUBLIC (senão anon/
-- authenticated herdam por tabela), concede só o que precisa ser
-- chamável direto pelo cliente.
-- ----------------------------------------------------------------------------

revoke execute on function fn_check_edit_access_area() from public;
revoke execute on function fn_can_submit_result(uuid, uuid) from public;
revoke execute on function apply_approval_effect(uuid) from public;

revoke execute on function submit_goal_result(uuid, numeric, numeric, text) from public;
grant execute on function submit_goal_result(uuid, numeric, numeric, text) to authenticated;
