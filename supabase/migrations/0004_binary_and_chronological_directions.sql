-- ============================================================================
-- 0004_binary_and_chronological_directions.sql
-- Sistema de Gestão de Metas — V1
-- Migration 4/N: dois tipos de meta que a planilha real tem e o modelo
-- original (doc. 01: só maior_melhor/menor_melhor) não cobria:
--
--   'binario'     — meta sim/não (ex.: "Treinamento Compliance"). Só existe
--                   a faixa de 100%; Real >= alvo (normalmente 1) = 100%,
--                   senão 0%. Sem gradação 80/90/110/120 — não faz sentido
--                   pra esse tipo de meta.
--   'cronologico' — meta "quanto antes, melhor" por mês (ex.: "Governança
--                   da Área Administrativa": entregar até Agosto = 120%,
--                   até Dezembro = 80%). Mês guardado como número ordinal
--                   (1-12) em goal_ranges.target_value e em
--                   goal_results.real_value — a comparação é idêntica à de
--                   menor_melhor (mês menor = mais cedo = melhor), só o
--                   rótulo é diferente pra a tela saber que deve mostrar/
--                   coletar nome de mês em vez de número cru.
-- ============================================================================

alter table indicators drop constraint indicators_direction_check;
alter table indicators add constraint indicators_direction_check
  check (direction in ('maior_melhor', 'menor_melhor', 'binario', 'cronologico'));

create or replace function fn_calc_attainment(p_goal_id uuid, p_real numeric)
returns numeric
language plpgsql stable as $$
declare
  v_direction text;
  v_result numeric := 0;
  v_band record;
begin
  if p_real is null then
    return null; -- não apurada
  end if;

  select i.direction into v_direction
  from goals g join indicators i on i.id = g.indicator_id
  where g.id = p_goal_id;

  if v_direction is null then
    raise exception 'Meta % não encontrada ou sem indicador com direção definida.', p_goal_id;
  end if;

  for v_band in
    select attainment_percentage, target_value
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
    end if;
  end loop;

  return least(greatest(v_result, 0), 120);
end;
$$;
