-- 0018 — Gerência Executiva Administrativa (regional "Brasil") + direção escala_letra
--
-- 1. Nova direção de indicador 'escala_letra': resultado lançado como letra
--    (A..E), guardado como ordinal 1..5; comparação igual a maior_melhor.
--    A=80%, B=90%, C=100%, D=110%, E=120% (escala progressiva: E pressupõe A..D).
-- 2. Regional "Brasil" (acima das 3 regionais) e área "Gerência Executiva
--    Administrativa", vinculada a ela.
-- 3. v_area_results ganha a categoria 'gerencia' (nome começando com "Gerência").
-- 4. As 6 metas do Gerente (Rafael Augusto Stedler), textos/faixas/pesos
--    exatamente como na planilha (Planilha3 do formulário dele).

-- 1) direção nova ------------------------------------------------------------
alter table indicators drop constraint indicators_direction_check;
alter table indicators add constraint indicators_direction_check
  check (direction = any (array['maior_melhor','menor_melhor','binario','cronologico','percentual_por_mes','escala_letra']));

create or replace function public.fn_calc_attainment(p_goal_id uuid, p_real numeric, p_real_pct numeric default null::numeric)
 returns numeric
 language plpgsql
 stable
 set search_path to 'public'
as $function$
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
      return null;
    end if;
  elsif p_real is null then
    return null;
  end if;

  for v_band in
    select attainment_percentage, target_value, target_month
    from goal_ranges
    where goal_id = p_goal_id
    order by attainment_percentage desc
  loop
    if v_direction in ('maior_melhor', 'binario', 'escala_letra') and p_real >= v_band.target_value then
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
$function$;

-- 2) regional Brasil + área da Gerência --------------------------------------
insert into regionals (name, code) values ('Brasil', 'BRASIL')
on conflict (code) do nothing;

insert into areas (name, code) values ('Gerência Executiva Administrativa', 'BRASIL_GERENCIA_EXECUTIVA_ADMINISTRATIVA')
on conflict (code) do nothing;

insert into area_regionals (area_id, regional_id)
select a.id, r.id from areas a, regionals r
where a.code = 'BRASIL_GERENCIA_EXECUTIVA_ADMINISTRATIVA' and r.code = 'BRASIL'
on conflict (area_id, regional_id) do nothing;

-- 3) categoria 'gerencia' na view do Dashboard (mesmas colunas, só o CASE muda)
create or replace view v_area_results with (security_invoker = true) as
 select a.id as area_id,
    a.name as area_name,
        case
            when ((a.name ~~* 'gerência%'::text) or (a.name ~~* 'gerencia%'::text)) then 'gerencia'::text
            when ((a.name ~~* 'coordenação%'::text) or (a.name ~~* 'coordenacao%'::text)) then 'coordenacao'::text
            when ((a.name ~~* 'supervisão%'::text) or (a.name ~~* 'supervisao%'::text)) then 'supervisao'::text
            else 'outras'::text
        end as category,
    r.id as regional_id,
    r.name as regional_name,
    g.cycle_id,
    count(g.id) as total_metas,
    count(g.id) filter (where (gr.status = any (array['critico'::text, 'parcial'::text, 'atingido'::text]))) as metas_apuradas,
    count(g.id) filter (where (gr.status = 'critico'::text)) as metas_criticas,
    count(g.id) filter (where (gr.status = 'parcial'::text)) as metas_parciais,
    count(g.id) filter (where (gr.status = 'atingido'::text)) as metas_atingidas,
    count(g.id) filter (where ((gr.status is null) or (gr.status = 'pendente'::text))) as metas_pendentes,
    sum(g.weight) as peso_total,
    sum(coalesce(gr.weighted_result, (0)::numeric)) as resultado_ponderado,
    ac.status as status_fechamento
   from ((((goals g
     join areas a on ((a.id = g.area_id)))
     join regionals r on ((r.id = g.regional_id)))
     left join goal_results gr on ((gr.goal_id = g.id)))
     left join area_closures ac on (((ac.area_id = g.area_id) and (ac.regional_id = g.regional_id) and (ac.cycle_id = g.cycle_id))))
  where (g.status = 'ativa'::text)
  group by a.id, a.name, r.id, r.name, g.cycle_id, ac.status;

-- 4) metas da Gerência --------------------------------------------------------
-- Indicadores próprios (não reaproveita os das Coordenações: os textos são
-- diferentes e indicador é compartilhado entre áreas). Compliance reaproveita
-- o indicador binário que as outras 31 áreas já usam (texto idêntico).
do $$
declare
  v_cycle uuid := (select id from goal_cycles where name = 'Ciclo 2026');
  v_reg   uuid := (select id from regionals where code = 'BRASIL');
  v_area  uuid := (select id from areas where code = 'BRASIL_GERENCIA_EXECUTIVA_ADMINISTRATIVA');
  v_qtde  uuid := (select id from measurement_units where code = 'QTDE');
  v_pct   uuid := (select id from measurement_units where name = '%');
  v_compl uuid := (select id from indicators where name = 'Treinamento de Compliance' and direction = 'binario');
  v_ind uuid;
  v_goal uuid;
  m jsonb;
  b jsonb;
  pcts int[] := array[80,90,100,110,120];
  i int;
begin
  if v_cycle is null or v_reg is null or v_area is null or v_qtde is null or v_pct is null or v_compl is null then
    raise exception 'Referência não encontrada (ciclo/regional/área/unidade/compliance).';
  end if;
  if exists (select 1 from goals where area_id = v_area and regional_id = v_reg and cycle_id = v_cycle) then
    raise exception 'A Gerência já tem metas cadastradas neste ciclo — abortando para não duplicar.';
  end if;

  for m in select * from jsonb_array_elements($j$[
    {"name":"Implantar 5 projetos de automatização de processos até dezembro de 2026",
     "desc":"Proporcionando redução mínima de 20% no tempo de execução dos processos automatizados e garantindo a adoção efetiva pelas áreas usuárias. (Gestão Paytrack, Portal do Parceiro, Portal do Fornecedor, BI ADM, Portal aceite de Serviços, BI do Almoxarifado).",
     "unit":"qtde","dir":"maior_melhor","weight":30,"bands":[2,3,4,5,6]},
    {"name":"Garantir entrega das Metas da area Administrativas / almoxarifado",
     "desc":"Elevar entrega da equipe através de acompanhamento contínuo, garantindo que cada área sob sua gestão atinja um nível mínimo de 90% de cumprimento em sua respectiva carta de metas",
     "unit":"pct","dir":"maior_melhor","weight":20,"bands":[0.9,0.95,1,1.05,1.1]},
    {"name":"Promover a melhoria contínua dos processos administrativos / almoxarifado",
     "desc":"Implementar, no mínimo, 4 iniciativas de melhoria contínua nos processos da área até dezembro de 2026, assegurando que cada iniciativa apresente evidências objetivas dos ganhos obtidos em produtividade, padronização, redução de retrabalho, redução de custos ou eficiência operacional.\n\nMelhoria no Fluxo de atendimento do Service Desk - Atendimento de Alteração de Produtos/Patrimônio\nMelhoria no Fluxo de encaminhamento de Notas Fiscais de Serviço via chamado \nMelhoria no Fluxo de Cadastro de Produtos Via Importação em Lote.\nMelhoria do Fluxo de atendimento dos chamados de cadastro com o Automato (sem necessidade de digitar novamente o chamado).",
     "unit":"qtde","dir":"maior_melhor","weight":20,"bands":[1,2,3,4,5]},
    {"name":"Saneamento e Unificação do Cadastro de Itens",
     "desc":"Indicador: Percentual de itens duplicados identificados, saneados (unificados/inativados) e corrigidos no sistema. Mapear 100% da base e sanar os itens duplicados identificados conforme tabela",
     "unit":"pct","dir":"maior_melhor","weight":15,"bands":[0.8,0.85,0.9,0.95,1]},
    {"name":"Desmobilização e Monetização de Itens Obsoletos",
     "desc":"Percentual de itens obsoletos com destinação final concluída (Venda, Descarte ou Reuso). A - Formalizar o contrato com a empresa parceira de gestão de ativos e disponibilizar 20% do lote mapeado para a venda; B - Formalizar o contrato com a empresa parceira de gestão de ativos e disponibilizar 30% do lote mapeado para a venda; C - Formalizar o contrato com a empresa parceira de gestão de ativos e disponibilizar 40% do lote mapeado para a venda; D -Formalizar o contrato com a empresa parceira de gestão de ativos e disponibilizar 50% do lote mapeado para a venda ; E - Formalizar o contrato com a empresa parceira de gestão de ativos e disponibilizar 60% do lote mapeado para a venda",
     "unit":"qtde","dir":"escala_letra","weight":10,"bands":[1,2,3,4,5]},
    {"name":"Treinamento de Compliance","unit":"compliance","weight":5}
  ]$j$::jsonb)
  loop
    if m->>'unit' = 'compliance' then
      v_ind := v_compl;
    else
      insert into indicators (name, description, measurement_unit_id, direction)
      values (m->>'name', m->>'desc', case when m->>'unit' = 'pct' then v_pct else v_qtde end, m->>'dir')
      returning id into v_ind;
    end if;

    insert into goals (cycle_id, regional_id, area_id, indicator_id, weight, status)
    values (v_cycle, v_reg, v_area, v_ind, (m->>'weight')::numeric, 'ativa')
    returning id into v_goal;

    if m->>'unit' = 'compliance' then
      insert into goal_ranges (goal_id, attainment_percentage, target_value) values (v_goal, 100, 1);
    else
      for i in 1..5 loop
        insert into goal_ranges (goal_id, attainment_percentage, target_value)
        values (v_goal, pcts[i], (m->'bands'->>(i-1))::numeric);
      end loop;
    end if;
  end loop;

  if (select sum(weight) from goals where area_id = v_area and regional_id = v_reg and cycle_id = v_cycle) <> 100 then
    raise exception 'Peso da Gerência não fecha 100%%.';
  end if;
end $$;
