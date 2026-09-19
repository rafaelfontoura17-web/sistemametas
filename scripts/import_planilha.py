#!/usr/bin/env python3
"""
Carga inicial (doc. 07) — importa a "Matriz de Metas" da planilha de
referência para o schema novo (migrations 0001-0003).

Fluxo, seguindo o doc. 07 à risca:
  Excel → leitura → validação estrutural → validação de regras →
  relatório de inconsistências → confirmação → transformação →
  gravação transacional.

Regra inegociável: NENHUMA carga parcial. Se qualquer erro bloqueante
for encontrado, o script imprime o relatório completo e sai sem tocar
no banco. Só grava (e tudo numa única transação) quando a planilha
inteira passa limpa, ou quando --skip-rows é usado explicitamente para
excluir linhas específicas já identificadas e aceitas como fora do
escopo desta carga (ver --help).

Uso:
  python3 import_planilha.py caminho/planilha.xlsx --dry-run
  python3 import_planilha.py caminho/planilha.xlsx --commit
  python3 import_planilha.py caminho/planilha.xlsx --commit --skip-rows 12,45
  (a segunda forma grava de verdade; requer a variável de ambiente
  DATABASE_URL apontando para o Postgres/Supabase de destino)
"""
import argparse
import os
import re
import sys
import unicodedata
from collections import defaultdict

from openpyxl import load_workbook

BANDAS_ESPERADAS = [0.8, 0.9, 1.0, 1.1, 1.2]
MESES_ORDINAL = {
    'janeiro': 1, 'fevereiro': 2, 'março': 3, 'abril': 4, 'maio': 5, 'junho': 6,
    'julho': 7, 'agosto': 8, 'setembro': 9, 'outubro': 10, 'novembro': 11, 'dezembro': 12,
}
CICLO_NOME = 'Ciclo 2026'
CICLO_ANO = 2026


def slugify(s):
    s = unicodedata.normalize('NFD', s).encode('ascii', 'ignore').decode('ascii')
    s = re.sub(r'[^A-Za-z0-9]+', '_', s.strip()).strip('_').upper()
    return s or 'X'


def parse_band_cell(raw):
    """Interpreta UMA célula de faixa, célula a célula (uma linha pode
    misturar números soltos com texto operador, ex.: (1, 3, 5, 6, '>6')).
    Retorna (kind, direction_ou_None, valor_ou_texto). Nome de mês vira
    'mes' com o ordinal 1-12 já convertido (cronológico: mês menor = mais
    cedo = melhor, mesma comparação de menor_melhor)."""
    if raw is None:
        return 'ausente', None, None
    if isinstance(raw, (int, float)):
        return 'numero', None, float(raw)
    if isinstance(raw, str):
        s = raw.strip()
        if s.lower() in MESES_ORDINAL:
            return 'mes', 'cronologico', float(MESES_ORDINAL[s.lower()])
        m = re.match(r'\s*([≤≥<>])\s*([\d.,]+)\s*(%?)\s*$', s)
        if m:
            op, num, pct_sign = m.groups()
            direction = 'menor_melhor' if op in ('≤', '<') else 'maior_melhor'
            value = float(num.replace(',', '.'))
            if pct_sign == '%':
                value = value / 100.0
            return 'operador', direction, value
        m = re.match(r'\s*([\d.,]+)\s*%.*?m[êe]s\s+(\d{1,2})\s*/', s, re.IGNORECASE)
        if m:
            pct, mes = m.groups()
            return 'pct_mes', 'percentual_por_mes', (float(pct.replace(',', '.')) / 100.0, int(mes))
        try:
            return 'numero', None, float(s.replace(',', '.'))
        except ValueError:
            return 'texto_livre', None, s
    return 'ausente', None, None


def band_kind(cells):
    # mantido só para a mensagem-resumo do relatório inicial; a validação
    # de verdade agora é célula a célula (parse_band_cell), não por linha.
    parsed = [parse_band_cell(c) for c in cells]
    if any(k == 'mes' for k, _, _ in parsed):
        return 'mes'
    if any(k == 'operador' for k, _, _ in parsed):
        return 'operador'
    return 'numerico'


def read_rows(xlsx_path):
    wb = load_workbook(xlsx_path, read_only=True, data_only=True)
    if 'Matriz de Metas' not in wb.sheetnames:
        raise SystemExit(f"Aba 'Matriz de Metas' não encontrada. Abas disponíveis: {wb.sheetnames}")
    ws = wb['Matriz de Metas']
    header = next(ws.iter_rows(min_row=1, max_row=1, values_only=True))
    employee_cols = [(i, h) for i, h in enumerate(header) if i >= 12 and h]
    raw_rows = []
    for excel_row_num, row in enumerate(ws.iter_rows(min_row=2, values_only=True), start=2):
        if row[0] in (None, ''):
            continue
        raw_rows.append((excel_row_num, row))
    return raw_rows, employee_cols


def compute_peso_por_area(raw_rows):
    """Soma de peso por (Regional, Área) usando TODA linha com peso válido,
    independente de a linha ter ou não outros problemas de banda — senão
    uma linha excluída por outro motivo derruba artificialmente a soma da
    área inteira, misturando dois problemas diferentes no relatório."""
    soma = defaultdict(float)
    for _, row in raw_rows:
        regional, area, peso = (row[0] or '').strip(), (row[1] or '').strip(), row[11]
        if regional and area and isinstance(peso, (int, float)):
            soma[(regional, area)] += float(peso)
    return soma


def parse_and_validate(raw_rows, employee_cols):
    """Retorna (records, errors, warnings). records só é útil se errors estiver vazio."""
    errors = []
    warnings = []
    records = []
    indicator_direction = {}  # nome do indicador -> direção já vista (checa consistência)
    seen_goal_keys = set()  # (regional, area, indicador) -> duplicidade

    peso_por_area = compute_peso_por_area(raw_rows)
    for (regional, area), soma in peso_por_area.items():
        if round(soma, 4) != 1.0:
            errors.append(f"soma de peso de '{regional}/{area}' é {soma*100:.1f}% (precisa ser 100%).")

    for excel_row_num, row in raw_rows:
        regional = (row[0] or '').strip()
        area = (row[1] or '').strip()
        nome_indicador = (row[2] or '').strip()
        descricao = (row[3] or '').strip() if row[3] else None
        unidade_raw = (row[4] or '').strip() if row[4] else ''
        bandas_raw = row[5:10]
        real = row[10]
        peso = row[11]

        prefix = f"linha {excel_row_num} ({regional}/{area}/{nome_indicador!r})"

        if not regional or not area or not nome_indicador or not unidade_raw:
            errors.append(f"{prefix}: Regional, Área, Indicador ou Unidade em branco.")
            continue
        if peso is None or not isinstance(peso, (int, float)) or peso <= 0:
            errors.append(f"{prefix}: PESO ausente ou inválido ({peso!r}).")
            continue

        goal_key = (regional, area, nome_indicador)
        if goal_key in seen_goal_keys:
            errors.append(f"{prefix}: combinação Regional+Área+Indicador duplicada.")
            continue
        seen_goal_keys.add(goal_key)

        cells = [parse_band_cell(c) for c in bandas_raw]

        if any(k == 'texto_livre' for k, _, _ in cells):
            ilegiveis = [v for k, _, v in cells if k == 'texto_livre']
            errors.append(f"{prefix}: faixa com texto livre não numérico: {ilegiveis}.")
            continue

        n_presentes = sum(1 for k, _, _ in cells if k != 'ausente')
        n_meses = sum(1 for k, _, _ in cells if k == 'mes')
        n_pct_mes = sum(1 for k, _, _ in cells if k == 'pct_mes')

        if n_meses > 0 and n_meses < 5:
            errors.append(f"{prefix}: só {n_meses} de 5 faixas são nome de mês — faixa cronológica incompleta.")
            continue
        if n_pct_mes > 0 and n_pct_mes < 5:
            errors.append(f"{prefix}: só {n_pct_mes} de 5 faixas são do padrão 'X% até mês N' — faixa incompleta.")
            continue

        if n_presentes == 0:
            errors.append(f"{prefix}: nenhuma das 5 faixas está preenchida.")
            continue

        if n_pct_mes == 5:
            # meta composta: precisa bater percentual E mês simultaneamente
            # (ex.: 80% até agosto = 80%; 80% só em setembro não conta).
            direction = 'percentual_por_mes'
            parsed_bands = [(pct, v[0], v[1]) for pct, (_, _, v) in zip(BANDAS_ESPERADAS, cells)]

        elif n_meses == 5:
            direction = 'cronologico'
            parsed_bands = [(pct, v, None) for pct, (_, _, v) in zip(BANDAS_ESPERADAS, cells)]

        elif n_presentes == 1 and cells[2][0] == 'numero':
            # só a faixa de 100% existe: meta binária (fez/não fez).
            direction = 'binario'
            parsed_bands = [(1.0, cells[2][2], None)]

        elif n_presentes < 5:
            errors.append(
                f"{prefix}: só {n_presentes} de 5 faixas preenchidas (bandas: {bandas_raw}) — "
                f"não é o padrão binário reconhecido (só a faixa de 100%) nem as 5 faixas completas."
            )
            continue

        else:
            dirs_found = {d for _, d, _ in cells if d is not None}
            if len(dirs_found) > 1:
                errors.append(f"{prefix}: operadores de faixa inconsistentes entre si ({dirs_found}).")
                continue

            parsed_bands = [(pct, v, None) for pct, (_, _, v) in zip(BANDAS_ESPERADAS, cells)]

            if dirs_found:
                direction = dirs_found.pop()
            else:
                v80, v120 = parsed_bands[0][1], parsed_bands[-1][1]
                if v120 > v80:
                    direction = 'maior_melhor'
                elif v120 < v80:
                    direction = 'menor_melhor'
                else:
                    errors.append(f"{prefix}: faixas 80% e 120% são iguais ({v80}) — não dá pra inferir direção.")
                    continue

        prev_dir = indicator_direction.get(nome_indicador)
        if prev_dir is None:
            indicator_direction[nome_indicador] = direction
        elif prev_dir != direction:
            errors.append(
                f"{prefix}: indicador '{nome_indicador}' já apareceu com direção '{prev_dir}' "
                f"em outra área, e aqui saiu '{direction}' — inconsistente."
            )
            continue

        empregados = {}
        for idx, nome in employee_cols:
            w = row[idx]
            if w:
                empregados[nome] = float(w)

        real_parsed = None
        real_pct_parsed = None
        if direction == 'cronologico' and isinstance(real, str):
            real_parsed = float(MESES_ORDINAL[real.strip().lower()]) if real.strip().lower() in MESES_ORDINAL else None
        elif direction == 'percentual_por_mes':
            # esta direção precisa de DUAS entradas (mês + percentual); a
            # planilha de origem só tem uma coluna "Real", então por
            # enquanto isso só pode vir preenchido pela tela de Apuração
            # do sistema depois da carga — a carga inicial não tenta
            # adivinhar as duas partes a partir de uma célula só.
            if real is not None:
                warnings.append(
                    f"{prefix}: 'Real' preenchido ({real!r}) mas esta meta precisa de mês + percentual "
                    f"separados — a planilha só tem uma coluna. Real NÃO foi importado; lance pela tela "
                    f"de Apuração depois."
                )
        elif isinstance(real, (int, float)):
            real_parsed = float(real)
        elif real is not None:
            warnings.append(f"{prefix}: Real preenchido com valor não numérico ({real!r}) — tratado como não apurado.")

        records.append({
            'excel_row': excel_row_num,
            'regional': regional,
            'area': area,
            'indicador': nome_indicador,
            'descricao': descricao,
            'unidade_raw': unidade_raw,
            'unidade_norm': slugify(unidade_raw),
            'direction': direction,
            'bandas': parsed_bands,
            'real': real_parsed,
            'real_pct': real_pct_parsed,
            'peso_pct': round(float(peso) * 100, 2),
            'empregados': empregados,
        })

    return records, errors, warnings


def print_report(raw_rows, records, errors, warnings):
    print(f"Linhas de dados lidas:        {len(raw_rows)}")
    print(f"Linhas válidas (prontas):     {len(records)}")
    print(f"Erros bloqueantes:            {len(errors)}")
    print(f"Avisos (não bloqueiam):       {len(warnings)}")
    if records:
        regionais = sorted(set(r['regional'] for r in records))
        areas = sorted(set((r['regional'], r['area']) for r in records))
        indicadores = sorted(set(r['indicador'] for r in records))
        print(f"\nRegionais distintas:          {regionais}")
        print(f"Pares Regional+Área:          {len(areas)}")
        print(f"Indicadores distintos:        {len(indicadores)}")
        empregados = set()
        for r in records:
            empregados.update(r['empregados'].keys())
        print(f"Colaboradores citados:        {len(empregados)} "
              f"(carregados só como referência — pesos individuais não são usados neste V1)")
        com_real = sum(1 for r in records if r['real'] is not None)
        print(f"Metas com Real já preenchido: {com_real}")
    if errors:
        print("\n=== ERROS (nada será gravado enquanto existirem) ===")
        for e in errors:
            print(" -", e)
    if warnings:
        print("\n=== AVISOS ===")
        for w in warnings:
            print(" -", w)


def commit_to_db(records, database_url):
    import psycopg2
    conn = psycopg2.connect(database_url)
    try:
        with conn:
            with conn.cursor() as cur:
                regional_ids = {}
                area_ids = {}
                unit_ids = {}
                indicator_ids = {}
                indicator_directions = {}

                for r in records:
                    if r['regional'] not in regional_ids:
                        code = slugify(r['regional'])
                        cur.execute(
                            "insert into regionals (name, code) values (%s,%s) "
                            "on conflict (code) do update set name=excluded.name returning id",
                            (r['regional'], code))
                        regional_ids[r['regional']] = cur.fetchone()[0]

                    area_key = (r['regional'], r['area'])
                    if area_key not in area_ids:
                        code = slugify(f"{r['regional']}_{r['area']}")
                        cur.execute(
                            "insert into areas (name, code) values (%s,%s) "
                            "on conflict (code) do update set name=excluded.name returning id",
                            (r['area'], code))
                        area_id = cur.fetchone()[0]
                        area_ids[area_key] = area_id
                        cur.execute(
                            "insert into area_regionals (area_id, regional_id) values (%s,%s) "
                            "on conflict (area_id, regional_id) do nothing",
                            (area_id, regional_ids[r['regional']]))

                    if r['unidade_norm'] not in unit_ids:
                        cur.execute(
                            "insert into measurement_units (name, code) values (%s,%s) "
                            "on conflict (code) do update set name=excluded.name returning id",
                            (r['unidade_raw'], r['unidade_norm']))
                        unit_ids[r['unidade_norm']] = cur.fetchone()[0]

                    if r['indicador'] not in indicator_ids:
                        cur.execute(
                            "insert into indicators (name, description, measurement_unit_id, direction) "
                            "values (%s,%s,%s,%s) returning id",
                            (r['indicador'], r['descricao'], unit_ids[r['unidade_norm']], r['direction']))
                        indicator_ids[r['indicador']] = cur.fetchone()[0]
                        indicator_directions[r['indicador']] = r['direction']

                cur.execute(
                    "insert into goal_cycles (name, year) values (%s,%s) returning id",
                    (CICLO_NOME, CICLO_ANO))
                cycle_id = cur.fetchone()[0]

                for r in records:
                    area_key = (r['regional'], r['area'])
                    cur.execute(
                        "insert into goals (cycle_id, regional_id, area_id, indicator_id, weight) "
                        "values (%s,%s,%s,%s,%s) returning id",
                        (cycle_id, regional_ids[r['regional']], area_ids[area_key],
                         indicator_ids[r['indicador']], r['peso_pct']))
                    goal_id = cur.fetchone()[0]

                    for pct, target, target_mes in r['bandas']:
                        cur.execute(
                            "insert into goal_ranges (goal_id, attainment_percentage, target_value, target_month) "
                            "values (%s,%s,%s,%s)",
                            (goal_id, pct * 100, target, target_mes))

                    if r['real'] is not None or r.get('real_pct') is not None:
                        cur.execute(
                            "insert into goal_results (goal_id, real_value, real_value_pct) values (%s,%s,%s)",
                            (goal_id, r['real'], r.get('real_pct')))
        print(f"\nOK — gravado em transação única: {len(records)} metas, ciclo '{CICLO_NOME}'.")
    finally:
        conn.close()


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('xlsx_path')
    ap.add_argument('--commit', action='store_true', help='Grava de verdade (requer DATABASE_URL). Sem isso, é sempre dry-run.')
    ap.add_argument('--skip-rows', default='', help='Números de linha do Excel a ignorar (separados por vírgula), já identificados e aceitos como fora do escopo desta carga.')
    args = ap.parse_args()

    skip = {int(x) for x in args.skip_rows.split(',') if x.strip()}

    raw_rows, employee_cols = read_rows(args.xlsx_path)
    if skip:
        before = len(raw_rows)
        raw_rows = [(n, row) for n, row in raw_rows if n not in skip]
        print(f"(ignorando {before - len(raw_rows)} linha(s) via --skip-rows: {sorted(skip)})\n")

    records, errors, warnings = parse_and_validate(raw_rows, employee_cols)
    print_report(raw_rows, records, errors, warnings)

    if errors:
        print("\nNada foi gravado (há erros bloqueantes).")
        sys.exit(1)

    if not args.commit:
        print("\nDry-run — nada foi gravado. Rode com --commit para gravar de verdade.")
        return

    database_url = os.environ.get('DATABASE_URL')
    if not database_url:
        raise SystemExit('DATABASE_URL não definida — não sei em qual banco gravar.')
    commit_to_db(records, database_url)


if __name__ == '__main__':
    main()
