-- ============================================================================
-- 0005_percentual_por_mes_direction.sql
-- Sistema de Gestão de Metas — V1
-- Migration 5/N: meta composta "percentual_por_mes" — algumas metas (ex.:
-- Almoxarifado Rio) só batem a faixa se DUAS condições forem satisfeitas
-- ao mesmo tempo: um percentual mínimo E até um mês-limite. Ex.: 80% até
-- Agosto = faixa de 80%; chegar em 80% só em Setembro não conta pra faixa
-- nenhuma (não é "quase lá", é fora do critério daquela faixa).
--
-- Isso não dá pra calcular com uma entrada só (a "menor_melhor"/
-- "maior_melhor" resolvem sozinhas com 1 real_value) — precisa de duas:
-- percentual executado E mês em que foi executado.
-- ============================================================================

alter table goal_ranges add column target_month integer
  check (target_month is null or target_month between 1 and 12);

alter table goal_results add column real_value_pct numeric;

alter table indicators drop constraint indicators_direction_check;
alter table indicators add constraint indicators_direction_check
  check (direction in ('maior_melhor', 'menor_melhor', 'binario', 'cronologico', 'percentual_por_mes'));

-- Substitui a função anterior (2 parâmetros) por uma de 3, com o terceiro
-- opcional — as direções que não precisam dele simplesmente o ignoram.
drop function if exists fn_calc_attainment(uuid, numeric);

create or replace function fn_calc_attainment(p_goal_id uuid, p_real numeric, p_real_pct numeric default null)
returns numeric
language plpgsql stable as $$
declare
  v_direction text;
  v_result numeric := 0;
  v_band record;
begin
  select i.direction into v_direction
  from goals g join indicators i on i.id = g.indicator_id
  where g.id = p_goal_id;

  if v_direction is null then
    raise exception 'Meta % não encontrada ou sem indicador com direção definida.', p_goal_id;
  end if;

  if v_direction = 'percentual_por_mes' then
    if p_real is null or p_real_pct is null then
      return null; -- precisa das duas partes; só uma não apura nada
    end if;
  elsif p_real is null then
    return null; -- não apurada
  end if;

  for v_band in
    select attainment_percentage, target_value, target_month
    from goal_ranges
    where goal_id = p_goal_id
    order by attainment_percentage desc
  loop
    if v_direction in ('maior_melhor', 'binario') and p_real >= v_band.target_value then
      v_result := v_band.attainment_percentage;
      exit;
    elsif v_direction in ('menor_melhor', 'cronologico') and p_real <= v_band.target_value then
      v_result := v_band.attainment_percentage;
      exit;
    elsif v_direction = 'percentual_por_mes'
      and p_real <= v_band.target_month and p_real_pct >= v_band.target_value then
      v_result := v_band.attainment_percentage;
      exit;
    end if;
  end loop;

  return least(greatest(v_result, 0), 120);
end;
$$;

-- fn_apply_goal_result (migration 3) recalcula em toda escrita de
-- real_value/real_value_pct — passa a considerar as duas colunas e a
-- exigir as duas preenchidas quando a direção é percentual_por_mes.
create or replace function fn_apply_goal_result()
returns trigger language plpgsql as $$
declare
  v_weight numeric;
  v_direction text;
  v_attainment numeric;
begin
  select g.weight, i.direction into v_weight, v_direction
  from goals g join indicators i on i.id = g.indicator_id
  where g.id = new.goal_id;

  v_attainment := fn_calc_attainment(new.goal_id, new.real_value, new.real_value_pct);

  if v_attainment is null then
    new.attainment_percentage := null;
    new.weighted_result := null;
    new.status := 'pendente';
    return new;
  end if;

  new.attainment_percentage := v_attainment;
  new.weighted_result := round((v_attainment / 100.0) * v_weight, 2);
  new.status := case
    when v_attainment = 0 then 'critico'
    when v_attainment < 100 then 'parcial'
    else 'atingido'
  end;
  return new;
end;
$$;

create or replace trigger trg_apply_goal_result
  before insert or update of real_value, real_value_pct on goal_results
  for each row execute function fn_apply_goal_result();

-- approve_request (migration 3) — a efetivação de 'alteracao_resultado'
-- passa a também atualizar real_value_pct quando a solicitação trouxer
-- esse campo (metas percentual_por_mes precisam mandar os dois itens:
-- field_name 'real_value' e 'real_value_pct').
create or replace function approve_request(p_request_id uuid, p_justification text default null)
returns approval_requests
language plpgsql security definer set search_path = public as $$
declare
  v_req approval_requests;
  v_new_real numeric;
  v_new_real_pct numeric;
  v_new_weight numeric;
  v_old_result goal_results;
  v_new_result goal_results;
  v_reopened int;
  v_has_pct_item boolean;
begin
  if not fn_can_approve(p_request_id) then
    raise exception 'Sem permissão para aprovar esta solicitação.';
  end if;

  select * into v_req from approval_requests where id = p_request_id;

  case v_req.request_type
    when 'alteracao_resultado' then
      select requested_value::numeric into v_new_real
      from approval_request_items where request_id = v_req.id and field_name = 'real_value' limit 1;

      select true, requested_value::numeric into v_has_pct_item, v_new_real_pct
      from approval_request_items where request_id = v_req.id and field_name = 'real_value_pct' limit 1;

      select * into v_old_result from goal_results where goal_id = v_req.goal_id;

      if coalesce(v_has_pct_item, false) then
        update goal_results set real_value = v_new_real, real_value_pct = v_new_real_pct
        where goal_id = v_req.goal_id
        returning * into v_new_result;
      else
        update goal_results set real_value = v_new_real
        where goal_id = v_req.goal_id
        returning * into v_new_result;
      end if;
      -- dispara trg_apply_goal_result e recalcula tudo

      -- histórico registra a mudança do valor principal (real_value); a
      -- mudança de real_value_pct, quando houver, não tem coluna própria
      -- em goal_result_history — fica só no antes/depois do atingimento.
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
