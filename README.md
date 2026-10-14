# Sistema de Gestão de Metas — Âmbar Energia

Sistema de gestão de metas por Área/Regional, com apuração, workflow de
aprovação (com hierarquia de Gestor por escopo) e RLS de ponta a ponta no
Postgres do Supabase.

## Estrutura do repositório

```
supabase/migrations/   11 migrations SQL, na ordem (0001 a 0011 + hardening)
scripts/                import_planilha.py, provision_users.py
frontend/               React + TypeScript + Vite + Tailwind + Supabase JS
DECISIONS.md            registro de todas as decisões técnicas e de negócio tomadas
```

## Projeto Supabase já provisionado

Projeto **sistema-metas-ambar** (`sa-east-1`), com:
- Schema completo (regionais, áreas, indicadores, metas, faixas, resultados,
  aprovação, auditoria, notificações) — RLS habilitada em tudo.
- Motor de cálculo com 5 direções: `maior_melhor`, `menor_melhor`, `binario`,
  `cronologico`, `percentual_por_mes`.
- Workflow de aprovação com hierarquia por escopo (Gestor de Regional
  inteira > Gestor de Área específica; Administrador sempre aprova).
- **Dados reais carregados**: 169 metas, 665 faixas, 85 resultados, 31 áreas,
  3 regionais, 44 indicadores — todas as áreas fechando em 100% de peso.
- Hardening de segurança aplicado (função `search_path` fixo, `EXECUTE`
  revogado de `anon`/funções internas — ver DECISIONS.md migration 11/12).

Se precisar recriar isso do zero em outro projeto Supabase, aplique as
migrations em `supabase/migrations/` nessa ordem exata (via Dashboard SQL
Editor, `supabase db push`, ou uma a uma).

## Rodando o frontend localmente

```bash
cd frontend
npm install
cp .env.example .env.local   # já vem preenchido neste pacote com os dados do projeto real
npm run dev
```

## Deploy no Vercel

1. Suba este repositório no GitHub.
2. No Vercel: **New Project** → importe o repositório.
3. **Root Directory**: `frontend` (o projeto React fica dentro dessa pasta,
   não na raiz do repo).
4. Framework preset: **Vite** (o Vercel detecta automaticamente).
5. Em **Environment Variables**, adicione:
   - `VITE_SUPABASE_URL` = `https://vrhifxqovglqytdwjlhn.supabase.co`
   - `VITE_SUPABASE_ANON_KEY` = (a mesma chave que está em `frontend/.env.local`)
6. Deploy.

O `frontend/vercel.json` já está configurado para redirecionar todas as
rotas para `index.html` (necessário porque é uma SPA com React Router —
sem isso, dar F5 em `/metas/123` daria 404).

## Criar o usuário administrador

A criação de contas de login **não é feita pela tela nem pelo navegador**
(a Admin API do Supabase exige a `service_role key`, que nunca pode ir
para o frontend). Duas formas:

1. **Painel do Supabase**: Authentication → Add user (cria só o login).
   Depois é preciso vincular perfil Administrador manualmente no banco
   (`users` + `user_roles`) — peça ajuda ou rode o SQL equivalente ao que
   `provision_users.py` faz.
2. **Script** (`scripts/provision_users.py`): cria o login **e** já
   vincula perfil/escopo, a partir de um CSV. Requer
   `SUPABASE_SERVICE_ROLE_KEY` (nunca rode isso no navegador).

## Carga inicial de dados (se for repetir em outro ambiente)

```bash
export DATABASE_URL="postgresql://..."
python3 scripts/import_planilha.py "planilha.xlsx" --commit
```

Veja `DECISIONS.md` para o histórico completo de decisões técnicas e de
negócio tomadas ao longo do projeto — vale ler antes de mexer em regras
de cálculo ou de aprovação.
