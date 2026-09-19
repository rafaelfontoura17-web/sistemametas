/**
 * Reconstrução em texto/CSS da marca "Âmbar Energia" — o arquivo de logo
 * original (usado no painel-metas antigo) não está disponível neste
 * projeto. Se você tiver o arquivo de imagem, é só trocar este componente
 * por um <img src="/logo-ambar.png" /> apontando pra ele.
 */
export default function AmbarLogo() {
  return (
    <div className="bg-white rounded-xl px-4 py-3 leading-none">
      <p className="text-2xl font-bold text-slate-900 tracking-tight">Âmbar</p>
      <p className="text-sm font-bold text-orange-500 tracking-widest mt-0.5">ENERGIA</p>
    </div>
  )
}
