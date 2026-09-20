import { Link } from 'react-router-dom'

export default function AmbarLogo() {
  return (
    <Link to="/" className="block bg-white rounded-xl px-4 py-3 hover:opacity-90 transition-opacity">
      <img src="/logo-ambar.jpg" alt="Âmbar Energia" className="w-full max-w-[160px]" />
    </Link>
  )
}
