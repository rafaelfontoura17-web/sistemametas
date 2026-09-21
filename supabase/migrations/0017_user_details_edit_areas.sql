-- ============================================================================
-- 0017_user_details_edit_areas.sql
-- Sistema de Gestão de Metas — V1
-- Migration 17/N: v_user_details precisa mostrar quais Áreas um Usuário
-- pode editar (ponto 1) — tanto pra exibir na lista quanto pra pré-marcar
-- os checkboxes ao abrir a edição. DROP + CREATE de novo (mesma limitação
-- de sempre: não dá pra inserir coluna no meio via CREATE OR REPLACE).
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
  ) as escopos,
  (select ua.regional_id from user_access ua where ua.user_id = u.id and ua.active limit 1) as view_regional_id,
  coalesce(
    (select jsonb_agg(jsonb_build_object('area_id', uea.area_id, 'area_name', ea.name))
     from user_edit_access uea join areas ea on ea.id = uea.area_id
     where uea.user_id = u.id and uea.active),
    '[]'
  ) as edit_areas
from users u
left join employees e on e.id = u.employee_id;

grant select on v_user_details to authenticated;
