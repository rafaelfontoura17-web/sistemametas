-- ============================================================================
-- 0014_admin_update_user.sql
-- Sistema de Gestão de Metas — V1
-- Migration 14/N: corrige um bug real encontrado em produção — editar o
-- PRÓPRIO perfil (Admin editando a si mesmo) fazia "apagar user_roles,
-- depois inserir de novo" em duas chamadas separadas do frontend. No
-- instante entre as duas, fn_is_admin(auth.uid()) já dava falso (a linha
-- de Admin tinha acabado de ser apagada), e a RLS bloqueava a reinserção
-- com "new row violates row-level security policy".
--
-- Corrigido com uma função SECURITY DEFINER que faz a checagem de Admin
-- UMA VEZ no início e depois executa tudo internamente, sem passar pela
-- RLS de novo a cada instrução — o mesmo padrão já usado em
-- create_approval_request/approve_request/reject_request.
-- ============================================================================

create or replace function admin_update_user(
  p_user_id uuid,
  p_nome text,
  p_perfil text,
  p_regional_id uuid,
  p_area_id uuid
) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_employee_id uuid;
  v_role_id uuid;
begin
  if not fn_is_admin(auth.uid()) then
    raise exception 'Só o Administrador pode editar usuários.';
  end if;

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
  -- Administrador sem regional selecionada = acesso Global, não precisa
  -- de linha em user_access.
  if not (p_perfil = 'administrador' and p_regional_id is null) then
    insert into user_access (user_id, regional_id, area_id) values (p_user_id, p_regional_id, p_area_id);
  end if;
end;
$$;

revoke execute on function admin_update_user(uuid, text, text, uuid, uuid) from public;
grant execute on function admin_update_user(uuid, text, text, uuid, uuid) to authenticated;
