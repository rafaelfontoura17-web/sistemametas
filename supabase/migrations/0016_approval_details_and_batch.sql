-- ============================================================================
-- 0016_approval_details_and_batch.sql
-- Sistema de Gestão de Metas — V1
-- Migration 16/N: pontos 1, 3 e 4 da revisão de UX —
--   - view rica de solicitação (meta/área/regional/valores/quem enviou/
--     quem aprovou-reprovou), usada pelas telas de Aprovações e
--     Solicitações;
--   - aprovação em lote (uma chamada só, "aprova tudo e avisa quem falhou");
--   - admin_update_user ganha o escopo de edição (lista de Áreas) do
--     ponto 1, e passa a forçar Usuário = sempre Regional inteira, nunca
--     Área isolada.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. v_approval_details — uma linha por solicitação, com tudo que as telas
-- de Aprovações/Solicitações precisam pra mostrar o formato certo por tipo.
-- ----------------------------------------------------------------------------

create view v_approval_details with (security_invoker = true) as
select
  ar.id as request_id,
  ar.request_type,
  ar.status,
  ar.justification,
  ar.created_at,
  ar.resolved_at,
  ar.requester_id,
  req_e.name as requester_name,
  req_e.cargo as requester_cargo,
  ar.regional_id,
  reg.name as regional_name,
  ar.area_id,
  a.name as area_name,
  ar.cycle_id,
  gc.name as cycle_name,
  ar.goal_id,
  i.name as indicator_name,
  i.direction as indicator_direction,
  mu.name as unidade,
  (
    select jsonb_object_agg(
      field_name, jsonb_build_object('previous', previous_value, 'requested', requested_value)
    )
    from approval_request_items where request_id = ar.id
  ) as items,
  act.action as last_action,
  act.justification as action_justification,
  act.created_at as action_at,
  act.approver_id,
  act_e.name as approver_name,
  act_e.cargo as approver_cargo
from approval_requests ar
left join regionals reg on reg.id = ar.regional_id
left join areas a on a.id = ar.area_id
left join goal_cycles gc on gc.id = ar.cycle_id
left join goals g on g.id = ar.goal_id
left join indicators i on i.id = g.indicator_id
left join measurement_units mu on mu.id = i.measurement_unit_id
left join users req_u on req_u.id = ar.requester_id
left join employees req_e on req_e.id = req_u.employee_id
left join lateral (
  select * from approval_actions aa where aa.request_id = ar.id order by aa.created_at desc limit 1
) act on true
left join users act_u on act_u.id = act.approver_id
left join employees act_e on act_e.id = act_u.employee_id;

comment on view v_approval_details is
  'Uma linha por solicitação de aprovação, já com nome/cargo de quem '
  'pediu e de quem aprovou/reprovou, e os valores antes/depois em '
  '"items" (jsonb) — usada pelas telas de Aprovações e Solicitações. '
  'security_invoker: RLS de approval_requests já filtra certo (própria '
  'solicitação, ou Admin/Gestor com escopo).';

-- ----------------------------------------------------------------------------
-- 2. Aprovação em lote — "aprova tudo, avisa no final quais falharam"
-- (decisão de negócio: nunca para o lote inteiro por causa de uma falha).
-- A tela garante que o lote é sempre do mesmo request_type; a função não
-- precisa validar isso de novo — cada item já passa pela mesma checagem
-- de permissão de sempre (fn_can_approve), individualmente.
-- ----------------------------------------------------------------------------

create or replace function batch_approve_requests(p_ids uuid[], p_justification text default null)
returns table(request_id uuid, success boolean, error_message text)
language plpgsql security definer set search_path = public as $$
declare
  v_id uuid;
begin
  foreach v_id in array p_ids loop
    begin
      perform approve_request(v_id, p_justification);
      request_id := v_id;
      success := true;
      error_message := null;
      return next;
    exception when others then
      request_id := v_id;
      success := false;
      error_message := sqlerrm;
      return next;
    end;
  end loop;
end;
$$;

revoke execute on function batch_approve_requests(uuid[], text) from public;
grant execute on function batch_approve_requests(uuid[], text) to authenticated;

-- ----------------------------------------------------------------------------
-- 3. admin_update_user — ganha o escopo de edição (ponto 1) e passa a
-- forçar Usuário = sempre Regional inteira (área de visualização nula).
-- ----------------------------------------------------------------------------

-- Mudar a assinatura (novo parâmetro) cria uma função NOVA pro Postgres,
-- não substitui — precisa apagar a de 5 parâmetros pra não ficar duplicada.
drop function if exists admin_update_user(uuid, text, text, uuid, uuid);

create or replace function admin_update_user(
  p_user_id uuid,
  p_nome text,
  p_perfil text,
  p_regional_id uuid,
  p_area_id uuid,
  p_edit_area_ids uuid[] default null
) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_employee_id uuid;
  v_role_id uuid;
  v_area_id uuid;
  v_effective_area_id uuid;
begin
  if not fn_is_admin(auth.uid()) then
    raise exception 'Só o Administrador pode editar usuários.';
  end if;

  if p_perfil = 'usuario' and p_regional_id is null then
    raise exception 'Usuário precisa de uma Regional de visualização definida.';
  end if;

  -- Usuário sempre vê a Regional inteira — decisão de negócio (reunião com
  -- os coordenadores regionais): ninguém fica restrito a só uma Área.
  v_effective_area_id := case when p_perfil = 'usuario' then null else p_area_id end;

  if p_nome is not null and length(trim(p_nome)) > 0 then
    select employee_id into v_employee_id from users where id = p_user_id;
    if v_employee_id is null then
      insert into employees (name, email)
      select trim(p_nome), email from users where id = p_user_id
      returning id into v_employee_id;
      update users set employee_id = v_employee_id where id = p_user_id;
    else
      update employees set name = trim(p_nome) where id = v_employee_id;
    end if;
  end if;

  select id into v_role_id from roles where code = p_perfil;
  if v_role_id is null then
    raise exception 'Perfil % não existe.', p_perfil;
  end if;

  delete from user_roles where user_id = p_user_id;
  insert into user_roles (user_id, role_id) values (p_user_id, v_role_id);

  delete from user_access where user_id = p_user_id;
  if not (p_perfil = 'administrador' and p_regional_id is null) then
    insert into user_access (user_id, regional_id, area_id) values (p_user_id, p_regional_id, v_effective_area_id);
  end if;

  -- Escopo de edição só existe pra Usuário — Gestor/Admin não têm linha
  -- aqui (visualização = edição pra eles, não precisa de tabela própria).
  delete from user_edit_access where user_id = p_user_id;
  if p_perfil = 'usuario' and p_edit_area_ids is not null then
    foreach v_area_id in array p_edit_area_ids loop
      insert into user_edit_access (user_id, area_id) values (p_user_id, v_area_id);
    end loop;
  end if;
end;
$$;

revoke execute on function admin_update_user(uuid, text, text, uuid, uuid, uuid[]) from public;
grant execute on function admin_update_user(uuid, text, text, uuid, uuid, uuid[]) to authenticated;
