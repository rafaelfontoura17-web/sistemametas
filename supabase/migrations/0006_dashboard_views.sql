-- ============================================================================
-- 0006_dashboard_views.sql
-- Sistema de Gestão de Metas — V1
-- Migration 6/N: agregações que o Dashboard (doc. 05/08) precisa e que
-- ainda não existiam — o motor de cálculo resolve por META, mas
-- "resultado da Área" (soma dos resultados ponderados) precisa somar
-- várias metas juntas.
--
-- security_invoker = true é essencial aqui: sem isso, a view rodaria com
-- o privilégio de quem a criou (o dono/postgres, que ignora RLS) e
-- vazaria dados fora do escopo de quem consulta. Com security_invoker, a
-- view aplica a RLS de goals/areas/regionals/goal_results de quem está
-- logado — o mesmo escopo que já vale pro resto do sistema.
-- ============================================================================

create view v_area_results with (security_invoker = true) as
select
  a.id as area_id,
  a.name as area_name,
  -- não existe coluna própria pra categoria em "areas" — inferida pelo
  -- prefixo do nome, mesmo critério do painel de referência (doc. 10:
  -- preservar lógica existente onde o modelo novo não substitui).
  case
    when a.name ilike 'coordenação%' or a.name ilike 'coordenacao%' then 'coordenacao'
    when a.name ilike 'supervisão%' or a.name ilike 'supervisao%' then 'supervisao'
    else 'outras'
  end as category,
  r.id as regional_id,
  r.name as regional_name,
  g.cycle_id,
  count(g.id) as total_metas,
  count(g.id) filter (where gr.status in ('critico', 'parcial', 'atingido')) as metas_apuradas,
  count(g.id) filter (where gr.status = 'critico') as metas_criticas,
  count(g.id) filter (where gr.status = 'parcial') as metas_parciais,
  count(g.id) filter (where gr.status = 'atingido') as metas_atingidas,
  count(g.id) filter (where gr.status is null or gr.status = 'pendente') as metas_pendentes,
  sum(g.weight) as peso_total,
  sum(coalesce(gr.weighted_result, 0)) as resultado_ponderado,
  ac.status as status_fechamento
from goals g
join areas a on a.id = g.area_id
join regionals r on r.id = g.regional_id
left join goal_results gr on gr.goal_id = g.id
left join area_closures ac on ac.area_id = g.area_id and ac.regional_id = g.regional_id and ac.cycle_id = g.cycle_id
where g.status = 'ativa'
group by a.id, a.name, r.id, r.name, g.cycle_id, ac.status;

comment on view v_area_results is
  'Resultado agregado por Área+Regional+Ciclo (doc. 08): totais de metas, '
  'status, peso e resultado ponderado somado. security_invoker garante que '
  'aplica a RLS de quem consulta, não do dono da view.';
