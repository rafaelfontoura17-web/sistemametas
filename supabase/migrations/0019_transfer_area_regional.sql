-- 0019 — Transferir Área de Regional
--
-- Antes: a tela "Áreas e Regionais" só inseria um vínculo novo em
-- area_regionals, então a área passava a existir nas DUAS regionais (as metas
-- continuavam na antiga e a nova ficava vazia). Agora a operação é de
-- TRANSFERÊNCIA: uma área pertence a uma única regional, e mudar de regional
-- leva junto metas (com resultados), fechamentos e solicitações (decisão do
-- usuário: opção A — o histórico de solicitações acompanha a área).
--
-- Regras:
--   * Só Administrador.
--   * Se a área ainda não tem vínculo ativo, apenas cria o vínculo (área nova).
--   * Bloqueia (sem alterar nada) se houver usuário com escopo específico na
--     área (user_access com area_id, ou user_edit_access) — esses escopos
--     dependem da regional e precisam ser revistos na tela de Usuários antes.
--   * Tudo numa transação só; grava em audit_logs.

create or replace function public.transfer_area_regional(
  p_area_id uuid,
  p_new_regional_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_area_name text;
  v_new_name text;
  v_old_ids uuid[];
  v_old_names text[];
  v_goals int := 0;
  v_closures int := 0;
  v_requests int := 0;
  v_users text;
begin
  if v_uid is null or not fn_is_admin(v_uid) then
    raise exception 'Apenas Administrador pode transferir uma Área de Regional.';
  end if;

  select name into v_area_name from areas where id = p_area_id;
  if v_area_name is null then raise exception 'Área não encontrada.'; end if;
  select name into v_new_name from regionals where id = p_new_regional_id;
  if v_new_name is null then raise exception 'Regional não encontrada.'; end if;

  -- trava a área para evitar duas transferências simultâneas
  perform 1 from areas where id = p_area_id for update;

  select coalesce(array_agg(ar.regional_id), '{}'), coalesce(array_agg(r.name), '{}')
    into v_old_ids, v_old_names
    from area_regionals ar join regionals r on r.id = ar.regional_id
   where ar.area_id = p_area_id and ar.active and ar.regional_id <> p_new_regional_id;

  -- escopos de usuário amarrados à área: não mexer sozinho, pedir revisão
  select string_agg(distinct coalesce(e.name, u.id::text), ', ')
    into v_users
    from (
      select user_id from user_access where area_id = p_area_id and active
      union
      select user_id from user_edit_access where area_id = p_area_id and active
    ) s
    join users u on u.id = s.user_id
    left join employees e on e.id = u.employee_id;
  if v_users is not null and cardinality(v_old_ids) > 0 then
    raise exception 'Antes de transferir, ajuste na tela de Usuários o escopo/área de edição destes usuários ligados a "%": %', v_area_name, v_users;
  end if;

  -- 1) vínculo novo ativo primeiro (o trigger de goals exige o vínculo)
  insert into area_regionals (area_id, regional_id, active)
  values (p_area_id, p_new_regional_id, true)
  on conflict (area_id, regional_id) do update set active = true;

  -- 2) metas (resultados vão junto, pois são por goal_id)
  update goals set regional_id = p_new_regional_id
   where area_id = p_area_id and regional_id <> p_new_regional_id;
  get diagnostics v_goals = row_count;

  -- 3) fechamentos de área
  update area_closures set regional_id = p_new_regional_id
   where area_id = p_area_id and regional_id <> p_new_regional_id;
  get diagnostics v_closures = row_count;

  -- 4) solicitações (todas, inclusive histórico — opção A)
  update approval_requests set regional_id = p_new_regional_id
   where area_id = p_area_id and regional_id is distinct from p_new_regional_id;
  get diagnostics v_requests = row_count;

  -- 5) desativa os vínculos antigos (área fica em uma única regional)
  update area_regionals set active = false
   where area_id = p_area_id and regional_id <> p_new_regional_id and active;

  insert into audit_logs (user_id, action, entity, entity_id, old_data, new_data)
  values (
    v_uid, 'transferir_area_regional', 'areas', p_area_id,
    jsonb_build_object('area', v_area_name, 'regionais', to_jsonb(v_old_names), 'regional_ids', to_jsonb(v_old_ids)),
    jsonb_build_object('area', v_area_name, 'regional', v_new_name, 'regional_id', p_new_regional_id,
                       'metas_movidas', v_goals, 'fechamentos_movidos', v_closures, 'solicitacoes_movidas', v_requests)
  );

  return jsonb_build_object(
    'area', v_area_name, 'de', to_jsonb(v_old_names), 'para', v_new_name,
    'metas', v_goals, 'fechamentos', v_closures, 'solicitacoes', v_requests
  );
end;
$$;

revoke all on function public.transfer_area_regional(uuid, uuid) from public, anon;
grant execute on function public.transfer_area_regional(uuid, uuid) to authenticated;
