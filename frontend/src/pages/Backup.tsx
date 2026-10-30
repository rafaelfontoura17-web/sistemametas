import { useState, type ChangeEvent } from 'react'
import * as XLSX from 'xlsx'
import { useAuth } from '../context/AuthContext'
import { supabase } from '../lib/supabaseClient'
import PageHeader from '../components/PageHeader'
import {
  TABELAS_BACKUP,
  gerarBackup,
  lerArquivo,
  conferirBackup,
  type ArquivoBackup,
  type ResultadoConferencia,
} from '../lib/backupMetas'

function carimbo(d = new Date()) {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}h${p(d.getMinutes())}`
}

function baixarArquivo(conteudo: BlobPart, nome: string, tipo: string) {
  const url = URL.createObjectURL(new Blob([conteudo], { type: tipo }))
  const a = document.createElement('a')
  a.href = url
  a.download = nome
  a.click()
  URL.revokeObjectURL(url)
}

// Excel não guarda objeto/array numa célula: vira texto JSON.
function paraCelula(v: unknown) {
  return v !== null && typeof v === 'object' ? JSON.stringify(v) : v
}

async function baixarExcel(b: ArquivoBackup, nome: string) {
  const wb = XLSX.utils.book_new()

  const resumo = [
    ['Backup das Metas — pdm2026'],
    ['Gerado em', new Date(b.gerado_em).toLocaleString('pt-BR')],
    ['Gerado por', b.gerado_por],
    ['Código de integridade (SHA-256)', b.hash_sha256],
    [],
    ['Tabela', 'Descrição', 'Linhas'],
    ...TABELAS_BACKUP.map((t) => [t.nome, t.rotulo, b.contagens[t.nome]]),
    [],
    ['Para repor dados use o arquivo .json. Esta planilha é só para conferência.'],
  ]
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(resumo), 'Resumo')

  // Aba legível: as metas como aparecem no sistema (mesma view do Relatórios).
  const { data: legivel } = await supabase
    .from('v_goal_details')
    .select('regional_name, area_name, indicator_name, weight, real_value, real_value_pct, attainment_percentage, weighted_result, result_status')
    .order('regional_name')
    .order('area_name')
  if (legivel) {
    const linhas = legivel.map((r) => ({
      Regional: r.regional_name,
      Área: r.area_name,
      Indicador: r.indicator_name,
      'Peso (%)': r.weight,
      Real: r.real_value,
      'Real %': r.real_value_pct,
      'Atingimento (%)': r.attainment_percentage,
      'Resultado ponderado': r.weighted_result,
      Status: r.result_status ?? 'pendente',
    }))
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(linhas), 'Metas preenchidas')
  }

  for (const t of TABELAS_BACKUP) {
    const linhas = b.tabelas[t.nome].map((l) => Object.fromEntries(Object.entries(l).map(([k, v]) => [k, paraCelula(v)])))
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(linhas.length ? linhas : [{ '(sem registros)': '' }]), t.nome.slice(0, 31))
  }
  XLSX.writeFile(wb, nome)
}

export default function Backup() {
  const { isAdmin, appUser } = useAuth()
  const [progresso, setProgresso] = useState<string | null>(null)
  const [ultimo, setUltimo] = useState<ArquivoBackup | null>(null)
  const [conferencia, setConferencia] = useState<ResultadoConferencia | null>(null)
  const [conferindo, setConferindo] = useState(false)
  const [erro, setErro] = useState<string | null>(null)

  if (!isAdmin) {
    return <p className="text-sm text-red-600">Só o Administrador tem acesso ao Backup das Metas.</p>
  }

  async function exportar() {
    setErro(null)
    setUltimo(null)
    try {
      const b = await gerarBackup(appUser?.email ?? '', (r) => setProgresso(`Lendo ${r}…`))
      setProgresso('Gerando arquivos…')
      const base = `backup-metas_${carimbo()}`
      baixarArquivo(JSON.stringify(b, null, 2), `${base}.json`, 'application/json')
      await baixarExcel(b, `${base}.xlsx`)
      setUltimo(b)
    } catch (e) {
      setErro((e as Error).message)
    } finally {
      setProgresso(null)
    }
  }

  async function conferir(ev: ChangeEvent<HTMLInputElement>) {
    const arquivo = ev.target.files?.[0]
    ev.target.value = ''
    if (!arquivo) return
    setErro(null)
    setConferencia(null)
    setConferindo(true)
    try {
      setConferencia(await conferirBackup(await lerArquivo(arquivo)))
    } catch (e) {
      setErro((e as Error).message)
    } finally {
      setConferindo(false)
    }
  }

  const total = (f: (t: ResultadoConferencia['tabelas'][number]) => number) =>
    conferencia?.tabelas.reduce((s, t) => s + f(t), 0) ?? 0

  return (
    <div className="max-w-4xl">
      <PageHeader title="Backup das Metas" breadcrumb="Administração · Backup" />

      {erro && <p className="text-sm text-red-600 mb-4">{erro}</p>}

      {/* ---------- Exportar ---------- */}
      <section className="bg-white rounded-xl border border-slate-200 p-5 mb-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-sm font-semibold text-slate-800">1. Exportar</h2>
            <p className="text-xs text-slate-500 mt-1 max-w-xl">
              Baixa dois arquivos: o <b>.json</b>, que é a cópia fiel do banco e serve para repor dados,
              e o <b>.xlsx</b>, a mesma coisa em planilha para conferir. Inclui ciclos, regionais, áreas,
              indicadores, metas, faixas, resultados e fechamentos. Não inclui usuários, senhas,
              aprovações nem auditoria.
            </p>
          </div>
          <button
            onClick={exportar}
            disabled={!!progresso}
            className="text-sm rounded-lg bg-ambar-accent text-white px-4 py-2 hover:bg-ambar-dark disabled:opacity-60 whitespace-nowrap"
          >
            {progresso ?? 'Gerar backup'}
          </button>
        </div>

        {ultimo && (
          <div className="mt-4 border-t border-slate-100 pt-4">
            <p className="text-xs text-emerald-700 font-medium mb-2">
              Backup gerado em {new Date(ultimo.gerado_em).toLocaleString('pt-BR')}. Guarde os dois arquivos.
            </p>
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
              {TABELAS_BACKUP.map((t) => (
                <div key={t.nome} className="rounded-lg bg-slate-50 px-3 py-2">
                  <p className="text-[11px] text-slate-500">{t.rotulo}</p>
                  <p className="text-lg font-semibold text-slate-800">{ultimo.contagens[t.nome]}</p>
                </div>
              ))}
            </div>
          </div>
        )}
      </section>

      {/* ---------- Conferir ---------- */}
      <section className="bg-white rounded-xl border border-slate-200 p-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-sm font-semibold text-slate-800">2. Conferir um backup</h2>
            <p className="text-xs text-slate-500 mt-1 max-w-xl">
              Escolha um .json gerado aqui. O sistema confere se o arquivo está íntegro e compara,
              registro a registro, com o que está no banco agora. <b>Só lê, não grava nada.</b>
            </p>
          </div>
          <label className={`text-sm rounded-lg border border-ambar-accent text-ambar-accent px-4 py-2 whitespace-nowrap cursor-pointer hover:bg-orange-50 ${conferindo ? 'opacity-60 pointer-events-none' : ''}`}>
            {conferindo ? 'Conferindo…' : 'Escolher arquivo'}
            <input type="file" accept=".json,application/json" className="hidden" onChange={conferir} />
          </label>
        </div>

        {conferencia && (
          <div className="mt-4 border-t border-slate-100 pt-4 space-y-3">
            <p className={`text-xs font-medium ${conferencia.arquivoIntegro ? 'text-emerald-700' : 'text-red-600'}`}>
              {conferencia.arquivoIntegro
                ? `Arquivo íntegro: backup de ${new Date(conferencia.geradoEm).toLocaleString('pt-BR')}, gerado por ${conferencia.geradoPor}.`
                : 'Atenção: o conteúdo do arquivo não bate com o código de integridade. Ele foi alterado depois de gerado e não deve ser usado para repor dados.'}
            </p>
            <p className="text-xs text-slate-600">
              {total((t) => t.faltandoNoBanco) === 0
                ? 'Nada do backup está faltando no banco.'
                : `${total((t) => t.faltandoNoBanco)} registro(s) do backup não existem mais no banco.`}
              {total((t) => t.diferentes) > 0 && ` ${total((t) => t.diferentes)} registro(s) mudaram depois do backup (ex.: resultado editado ou aprovado).`}
            </p>
            <div className="overflow-hidden rounded-lg border border-slate-200">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-slate-500 text-xs uppercase tracking-wide">
                  <tr>
                    <th className="text-left font-medium px-3 py-2">Tabela</th>
                    <th className="text-right font-medium px-3 py-2">No arquivo</th>
                    <th className="text-right font-medium px-3 py-2">No banco</th>
                    <th className="text-right font-medium px-3 py-2">Iguais</th>
                    <th className="text-right font-medium px-3 py-2">Mudaram</th>
                    <th className="text-right font-medium px-3 py-2">Faltando no banco</th>
                    <th className="text-right font-medium px-3 py-2">Novos no banco</th>
                  </tr>
                </thead>
                <tbody>
                  {conferencia.tabelas.map((t) => (
                    <tr key={t.nome} className="border-t border-slate-100">
                      <td className="px-3 py-2 text-slate-700">{t.rotulo}</td>
                      <td className="px-3 py-2 text-right text-slate-600">{t.noArquivo}</td>
                      <td className="px-3 py-2 text-right text-slate-600">{t.noBanco}</td>
                      <td className="px-3 py-2 text-right text-emerald-700">{t.iguais}</td>
                      <td className={`px-3 py-2 text-right ${t.diferentes ? 'text-amber-600 font-medium' : 'text-slate-400'}`}>{t.diferentes}</td>
                      <td className={`px-3 py-2 text-right ${t.faltandoNoBanco ? 'text-red-600 font-semibold' : 'text-slate-400'}`}>{t.faltandoNoBanco}</td>
                      <td className="px-3 py-2 text-right text-slate-400">{t.novosNoBanco}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="text-[11px] text-slate-400">
              "No arquivo" = Iguais + Mudaram + Faltando no banco. "No banco" = Iguais + Mudaram + Novos no banco.
            </p>
          </div>
        )}
      </section>
    </div>
  )
}
