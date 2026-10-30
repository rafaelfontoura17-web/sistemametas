// Backup das Metas — exportação e conferência.
//
// Regras:
// - Só lê o banco (select). Nada aqui grava, altera ou apaga dados.
// - Lê com o login do administrador, então a mesma RLS do sistema vale aqui;
//   para o administrador, fn_has_scope libera todas as regionais e áreas.
// - O arquivo .json é a cópia fiel do banco (o que permite repor dados depois).
//   O .xlsx é a mesma coisa em formato de planilha, para conferir e mostrar.

import { supabase } from './supabaseClient'

// Ordem de dependência: cada tabela só depende das que vêm antes dela.
// É a mesma ordem que uma reposição precisa seguir.
export const TABELAS_BACKUP = [
  { nome: 'goal_cycles', rotulo: 'Ciclos' },
  { nome: 'regionals', rotulo: 'Regionais' },
  { nome: 'areas', rotulo: 'Áreas' },
  { nome: 'area_regionals', rotulo: 'Vínculo Área × Regional' },
  { nome: 'measurement_units', rotulo: 'Unidades de medida' },
  { nome: 'indicators', rotulo: 'Indicadores' },
  { nome: 'goals', rotulo: 'Metas' },
  { nome: 'goal_ranges', rotulo: 'Faixas de atingimento' },
  { nome: 'goal_results', rotulo: 'Resultados lançados' },
  { nome: 'area_closures', rotulo: 'Fechamentos de área' },
] as const

export type NomeTabela = (typeof TABELAS_BACKUP)[number]['nome']
type Linha = Record<string, unknown> & { id: string }

export interface ArquivoBackup {
  formato: 'backup-metas-pdm2026'
  versao: 1
  gerado_em: string
  gerado_por: string
  contagens: Record<NomeTabela, number>
  hash_sha256: string
  tabelas: Record<NomeTabela, Linha[]>
}

const PAGINA = 1000 // limite padrão de linhas por consulta no Supabase

async function lerTabelaInteira(tabela: NomeTabela): Promise<Linha[]> {
  const todas: Linha[] = []
  for (let inicio = 0; ; inicio += PAGINA) {
    const { data, error } = await supabase
      .from(tabela)
      .select('*')
      .order('id')
      .range(inicio, inicio + PAGINA - 1)
    if (error) throw new Error(`Falha ao ler "${tabela}": ${error.message}`)
    todas.push(...((data ?? []) as Linha[]))
    if (!data || data.length < PAGINA) break
  }
  return todas
}

// JSON com as chaves sempre na mesma ordem: assim o mesmo conteúdo gera
// sempre o mesmo texto (e o mesmo hash), independente da ordem das colunas.
export function jsonEstavel(valor: unknown): string {
  if (valor === null || typeof valor !== 'object') return JSON.stringify(valor)
  if (Array.isArray(valor)) return '[' + valor.map(jsonEstavel).join(',') + ']'
  const obj = valor as Record<string, unknown>
  return '{' + Object.keys(obj).sort().map((k) => JSON.stringify(k) + ':' + jsonEstavel(obj[k])).join(',') + '}'
}

async function sha256(texto: string): Promise<string> {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(texto))
  return Array.from(new Uint8Array(bytes)).map((b) => b.toString(16).padStart(2, '0')).join('')
}

export async function gerarBackup(email: string, aoProgredir?: (rotulo: string) => void): Promise<ArquivoBackup> {
  const tabelas = {} as Record<NomeTabela, Linha[]>
  const contagens = {} as Record<NomeTabela, number>
  for (const t of TABELAS_BACKUP) {
    aoProgredir?.(t.rotulo)
    tabelas[t.nome] = await lerTabelaInteira(t.nome)
    contagens[t.nome] = tabelas[t.nome].length
  }
  return {
    formato: 'backup-metas-pdm2026',
    versao: 1,
    gerado_em: new Date().toISOString(),
    gerado_por: email,
    contagens,
    hash_sha256: await sha256(jsonEstavel(tabelas)),
    tabelas,
  }
}

// ---------- Conferência de um arquivo contra o banco atual (só leitura) ----------

export interface ConferenciaTabela {
  nome: NomeTabela
  rotulo: string
  noArquivo: number
  noBanco: number
  iguais: number
  diferentes: number      // mesmo id, conteúdo mudou desde o backup (ex.: resultado editado)
  faltandoNoBanco: number // existem no arquivo e sumiram do banco
  novosNoBanco: number    // criados depois do backup
}

export interface ResultadoConferencia {
  arquivoIntegro: boolean
  geradoEm: string
  geradoPor: string
  tabelas: ConferenciaTabela[]
}

export async function lerArquivo(arquivo: File): Promise<ArquivoBackup> {
  let dados: ArquivoBackup
  try {
    dados = JSON.parse(await arquivo.text())
  } catch {
    throw new Error('O arquivo não é um JSON válido. Use o .json gerado por esta tela (o Excel serve só para leitura).')
  }
  if (dados?.formato !== 'backup-metas-pdm2026' || !dados.tabelas) {
    throw new Error('Este arquivo não é um backup das Metas gerado pelo pdm2026.')
  }
  return dados
}

export async function conferirBackup(dados: ArquivoBackup): Promise<ResultadoConferencia> {
  const arquivoIntegro = (await sha256(jsonEstavel(dados.tabelas))) === dados.hash_sha256
  const tabelas: ConferenciaTabela[] = []
  for (const t of TABELAS_BACKUP) {
    const doArquivo = dados.tabelas[t.nome] ?? []
    const doBanco = await lerTabelaInteira(t.nome)
    const bancoPorId = new Map(doBanco.map((l) => [l.id, jsonEstavel(l)]))
    const idsArquivo = new Set(doArquivo.map((l) => l.id))
    let iguais = 0, diferentes = 0, faltando = 0
    for (const linha of doArquivo) {
      const noBanco = bancoPorId.get(linha.id)
      if (noBanco === undefined) faltando++
      else if (noBanco === jsonEstavel(linha)) iguais++
      else diferentes++
    }
    tabelas.push({
      nome: t.nome,
      rotulo: t.rotulo,
      noArquivo: doArquivo.length,
      noBanco: doBanco.length,
      iguais,
      diferentes,
      faltandoNoBanco: faltando,
      novosNoBanco: doBanco.filter((l) => !idsArquivo.has(l.id)).length,
    })
  }
  return { arquivoIntegro, geradoEm: dados.gerado_em, geradoPor: dados.gerado_por, tabelas }
}
