import { useState } from 'react'
import * as XLSX from 'xlsx'
import { supabase } from '../lib/supabaseClient'

export default function Relatorios() {
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function exportarMetas() {
    setBusy('metas')
    setError(null)
    const { data, error: qError } = await supabase
      .from('v_goal_details')
      .select('regional_name, area_name, indicator_name, direction, weight, real_value, real_value_pct, attainment_percentage, weighted_result, result_status')
      .order('regional_name')
      .order('area_name')
    setBusy(null)
    if (qError) { setError(qError.message); return }

    const linhas = (data ?? []).map((r) => ({
      Regional: r.regional_name,
      Área: r.area_name,
      Indicador: r.indicator_name,
      Direção: r.direction,
      'Peso (%)': r.weight,
      Real: r.real_value,
      'Real %': r.real_value_pct,
      'Atingimento (%)': r.attainment_percentage,
      'Resultado ponderado': r.weighted_result,
      Status: r.result_status ?? 'pendente',
    }))
    baixarExcel(linhas, 'metas.xlsx', 'Metas')
  }

  async function exportarResultadoPorArea() {
    setBusy('areas')
    setError(null)
    const { data, error: qError } = await supabase
      .from('v_area_results')
      .select('regional_name, area_name, total_metas, metas_apuradas, metas_criticas, metas_parciais, metas_atingidas, metas_pendentes, peso_total, resultado_ponderado, status_fechamento')
      .order('regional_name')
      .order('area_name')
    setBusy(null)
    if (qError) { setError(qError.message); return }

    const linhas = (data ?? []).map((r) => ({
      Regional: r.regional_name,
      Área: r.area_name,
      'Total de metas': r.total_metas,
      Apuradas: r.metas_apuradas,
      Críticas: r.metas_criticas,
      Parciais: r.metas_parciais,
      Atingidas: r.metas_atingidas,
      'Não apuradas': r.metas_pendentes,
      'Peso total (%)': r.peso_total,
      'Resultado ponderado (%)': r.resultado_ponderado,
      Fechamento: r.status_fechamento ?? 'aberta',
    }))
    baixarExcel(linhas, 'resultado-por-area.xlsx', 'Resultado por Área')
  }

  return (
    <div className="space-y-4 max-w-xl">
      <div>
        <h1 className="text-xl font-semibold text-slate-800">Relatórios</h1>
        <p className="text-sm text-slate-500 mt-0.5">
          Exporta exatamente o que está no seu escopo (a mesma RLS do resto do sistema
          filtra os dados aqui também).
        </p>
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}

      <div className="bg-white rounded-xl border border-slate-200 divide-y divide-slate-100">
        <BotaoRelatorio
          titulo="Metas detalhadas"
          descricao="Uma linha por meta: indicador, peso, real, atingimento e status."
          onClick={exportarMetas}
          loading={busy === 'metas'}
        />
        <BotaoRelatorio
          titulo="Resultado por Área"
          descricao="Uma linha por Área: totais de metas por status e resultado ponderado."
          onClick={exportarResultadoPorArea}
          loading={busy === 'areas'}
        />
      </div>

      <p className="text-xs text-slate-400">
        Exportação em PDF ainda não construída nesta etapa — só Excel por enquanto.
      </p>
    </div>
  )
}

function BotaoRelatorio({ titulo, descricao, onClick, loading }: { titulo: string; descricao: string; onClick: () => void; loading: boolean }) {
  return (
    <div className="flex items-center justify-between p-4">
      <div>
        <p className="text-sm font-medium text-slate-800">{titulo}</p>
        <p className="text-xs text-slate-500 mt-0.5">{descricao}</p>
      </div>
      <button
        onClick={onClick} disabled={loading}
        className="text-sm rounded-lg bg-ambar-accent text-white px-3 py-1.5 hover:bg-ambar-dark disabled:opacity-60 whitespace-nowrap"
      >
        {loading ? 'Gerando…' : 'Baixar Excel'}
      </button>
    </div>
  )
}

function baixarExcel(linhas: Record<string, unknown>[], nomeArquivo: string, nomeAba: string) {
  const ws = XLSX.utils.json_to_sheet(linhas)
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, nomeAba)
  XLSX.writeFile(wb, nomeArquivo)
}
