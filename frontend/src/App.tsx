import { BrowserRouter, Routes, Route } from 'react-router-dom'
import { AuthProvider } from './context/AuthContext'
import ProtectedRoute from './components/ProtectedRoute'
import Layout from './components/Layout'
import Login from './pages/Login'
import Dashboard from './pages/Dashboard'
import Metas from './pages/Metas'
import GoalDetail from './pages/GoalDetail'
import Solicitacoes from './pages/Solicitacoes'
import Aprovacoes from './pages/Aprovacoes'
import Notificacoes from './pages/Notificacoes'
import Usuarios from './pages/Usuarios'
import AreasRegionais from './pages/AreasRegionais'
import Indicadores from './pages/Indicadores'
import Auditoria from './pages/Auditoria'
import Relatorios from './pages/Relatorios'

function page(el: JSX.Element) {
  return (
    <ProtectedRoute>
      <Layout>{el}</Layout>
    </ProtectedRoute>
  )
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/" element={page(<Dashboard />)} />
          <Route path="/metas" element={page(<Metas />)} />
          <Route path="/metas/:goalId" element={page(<GoalDetail />)} />
          <Route path="/solicitacoes" element={page(<Solicitacoes />)} />
          <Route path="/aprovacoes" element={page(<Aprovacoes />)} />
          <Route path="/notificacoes" element={page(<Notificacoes />)} />
          <Route path="/usuarios" element={page(<Usuarios />)} />
          <Route path="/areas-regionais" element={page(<AreasRegionais />)} />
          <Route path="/indicadores" element={page(<Indicadores />)} />
          <Route path="/auditoria" element={page(<Auditoria />)} />
          <Route path="/relatorios" element={page(<Relatorios />)} />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  )
}
