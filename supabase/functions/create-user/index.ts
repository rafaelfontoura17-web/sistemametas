// Edge Function: create-user
//
// Cria uma conta de login (Supabase Auth) e já vincula employee/users/
// user_roles/user_access — a mesma lógica de scripts/provision_users.py,
// só que rodando no servidor em vez de na máquina do Admin. A service_role
// key fica só aqui dentro (variável de ambiente do runtime da função) e
// NUNCA é exposta ao navegador.
//
// Segurança: a primeira coisa que a função faz é confirmar que quem está
// chamando é um Administrador logado — sem isso, qualquer pessoa
// autenticada poderia criar contas com qualquer perfil.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

interface CreateUserPayload {
  nome: string
  email: string
  senha: string
  cargo?: string | null
  perfil: 'administrador' | 'gestor' | 'usuario'
  regionalId?: string | null // null = Global (só válido pra perfil 'administrador')
  areaId?: string | null // null = Regional inteira
}

Deno.serve(async (req: Request) => {
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  }
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) {
      return json({ error: 'Não autenticado.' }, 401, corsHeaders)
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

    // Cliente "como o chamador" — só pra confirmar quem é e se é Admin.
    const callerClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    })
    const { data: userData, error: userError } = await callerClient.auth.getUser()
    if (userError || !userData.user) {
      return json({ error: 'Sessão inválida.' }, 401, corsHeaders)
    }

    // Cliente com service_role — só usado DEPOIS de confirmar que quem
    // pediu é Admin. Nunca chega no navegador.
    const adminClient = createClient(supabaseUrl, serviceRoleKey)

    const { data: isAdmin, error: adminCheckError } = await adminClient.rpc('fn_is_admin', {
      p_user: userData.user.id,
    })
    if (adminCheckError || !isAdmin) {
      return json({ error: 'Só o Administrador pode criar usuários.' }, 403, corsHeaders)
    }

    const payload = (await req.json()) as CreateUserPayload
    if (!payload.nome || !payload.email || !payload.senha || !payload.perfil) {
      return json({ error: 'nome, email, senha e perfil são obrigatórios.' }, 400, corsHeaders)
    }
    if (payload.areaId && !payload.regionalId) {
      return json({ error: 'areaId não faz sentido sem regionalId.' }, 400, corsHeaders)
    }

    // 1. Cria a conta no Auth.
    const { data: created, error: createError } = await adminClient.auth.admin.createUser({
      email: payload.email,
      password: payload.senha,
      email_confirm: true,
    })
    if (createError || !created.user) {
      return json({ error: `Falha ao criar conta: ${createError?.message}` }, 400, corsHeaders)
    }
    const newUserId = created.user.id

    // 2. Provisiona os dados de aplicação. Se algo falhar aqui, a conta de
    // Auth já foi criada — reportamos o id pra permitir limpeza manual.
    try {
      const { data: employee, error: employeeError } = await adminClient
        .from('employees')
        .insert({
          name: payload.nome,
          email: payload.email,
          cargo: payload.cargo ?? null,
          area_id: payload.areaId ?? null,
          regional_id: payload.regionalId ?? null,
        })
        .select('id')
        .single()
      if (employeeError) throw employeeError

      const { error: usersError } = await adminClient.from('users').insert({
        id: newUserId,
        employee_id: employee.id,
        email: payload.email,
        status: 'ativo',
      })
      if (usersError) throw usersError

      const { data: role, error: roleError } = await adminClient
        .from('roles')
        .select('id')
        .eq('code', payload.perfil)
        .single()
      if (roleError || !role) throw roleError ?? new Error('Perfil não encontrado.')

      const { error: userRoleError } = await adminClient
        .from('user_roles')
        .insert({ user_id: newUserId, role_id: role.id })
      if (userRoleError) throw userRoleError

      if (payload.perfil !== 'administrador' || payload.regionalId) {
        const { error: accessError } = await adminClient.from('user_access').insert({
          user_id: newUserId,
          regional_id: payload.regionalId ?? null,
          area_id: payload.areaId ?? null,
        })
        if (accessError) throw accessError
      }
    } catch (provisionError) {
      return json(
        {
          error: `Conta criada no Auth (id ${newUserId}), mas falhou ao vincular perfil/escopo: ${
            (provisionError as Error).message
          }. Pode ser necessário remover a conta manualmente e tentar de novo.`,
        },
        500,
        corsHeaders
      )
    }

    return json({ id: newUserId, email: payload.email }, 200, corsHeaders)
  } catch (err) {
    return json({ error: (err as Error).message }, 500, corsHeaders)
  }
})

function json(body: unknown, status: number, corsHeaders: Record<string, string>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}
