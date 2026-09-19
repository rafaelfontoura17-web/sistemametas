-- ============================================================================
-- 0008_goal_details_view.sql
-- Sistema de Gestão de Metas — V1
-- Migration 8/N: view detalhada por meta (doc. 05, telas "Metas",
-- "Detalhe da Meta" e "Apuração") — junta meta, indicador, área/regional
-- e o resultado (quando existe) numa consulta só.
-- ============================================================================

create view v_goal_details with (security_invoker = true) as
select
  g.id as goal_id,
  g.cycle_id,
  g.weight,
  g.status as goal_status,
  a.id as area_id,
  a.name as area_name,
  r.id as regional_id,
  r.name as regional_name,
  i.id as indicator_id,
  i.name as indicator_name,
  i.description as indicator_description,
  i.direction,
  mu.name as unidade,
  gr.id as result_id,
  gr.real_value,
  gr.real_value_pct,
  gr.attainment_percentage,
  gr.weighted_result,
  gr.status as result_status,
  gr.realization_month,
  gr.created_at as result_created_at
from goals g
join areas a on a.id = g.area_id
join regionals r on r.id = g.regional_id
join indicators i on i.id = g.indicator_id
left join measurement_units mu on mu.id = i.measurement_unit_id
left join goal_results gr on gr.goal_id = g.id
where g.status = 'ativa';

comment on view v_goal_details is
  'Uma linha por meta ativa, com indicador/área/regional e o resultado '
  'quando já existe (gr.* fica tudo null se ainda não foi apurada). '
  'security_invoker: aplica a RLS de quem consulta.';
