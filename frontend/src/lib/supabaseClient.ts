import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string

if (!supabaseUrl || !supabaseAnonKey) {
  // Falha alto e cedo: sem essas duas variáveis o app não tem como falar
  // com o Supabase, e um erro genérico de rede mais tarde seria mais
  // difícil de diagnosticar do que isso aqui.
  throw new Error(
    'VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY precisam estar definidas ' +
      '(veja .env.example). Sem elas o app não consegue se conectar ao Supabase.'
  )
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey)
