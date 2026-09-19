-- ============================================================================
-- 0010_user_details_view.sql
-- Sistema de Gestão de Metas — V1
-- Migration 10/N: view pra tela de Usuários (doc. 05) — junta users +
-- employees + roles + escopo (user_access) numa consulta só. Segue o
-- mesmo escopo que users/employees já tinham via RLS (admin vê tudo,
-- gestor vê dentro do escopo, usuário comum só a própria linha).
-- ============================================================================

create view v_user_details with (security_invoker = true) as
select
  u.id as user_id,
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

comment on view v_user_details is
  'Uma linha por usuário do sistema, com perfil(is) e escopo(s) resumidos '
  'em array de texto — pra tela de Usuários. security_invoker: mesma RLS '
  'de users/employees.';
