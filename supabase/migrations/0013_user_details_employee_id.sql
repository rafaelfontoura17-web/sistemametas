-- ============================================================================
-- 0013_user_details_employee_id.sql
-- Sistema de Gestão de Metas — V1
-- Migration 13/N: a tela de Usuários ganhou edição de nome (item 7 da
-- revisão de UX) — precisa do employee_id pra saber em qual linha de
-- `employees` escrever. v_user_details não expunha isso.
--
-- CREATE OR REPLACE VIEW não permite inserir uma coluna no meio da lista
-- existente (só no final) — por isso é DROP + CREATE aqui, não REPLACE.
-- ============================================================================

drop view if exists v_user_details;

create view v_user_details with (security_invoker = true) as
select
  u.id as user_id,
  u.employee_id,
  u.email,
  u.status,
  e.name as employee_name,
  e.cargo,
  coalesce(
    (select array_agg(r.code order by r.code) from user_roles ur join roles r on r.id = ur.role_id where ur.user_id = u.id),
    '{}'
  ) as roles,
  coalesce(
    (select array_agg(
        case
          when ua.regional_id is null then 'Global'
          when ua.area_id is null then reg.name || ' (regional inteira)'
          else reg.name || ' / ' || ar.name
        end
      )
      from user_access ua
      left join regionals reg on reg.id = ua.regional_id
      left join areas ar on ar.id = ua.area_id
      where ua.user_id = u.id and ua.active),
    '{}'
  ) as escopos
from users u
left join employees e on e.id = u.employee_id;

grant select on v_user_details to authenticated;
