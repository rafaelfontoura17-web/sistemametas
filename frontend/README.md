# Sistema de Gestão de Metas — Frontend

React + TypeScript + Vite + Tailwind + Supabase JS. Decisão técnica (doc.
10 não define stack): esse conjunto é o "moderno, leve e compatível"
mais simples pra um app que só precisa falar com Supabase via RLS, sem
backend próprio no meio.

## Rodando localmente

```bash
npm install
cp .env.example .env.local   # preencha com URL + anon key do seu projeto Supabase
npm run dev
```

## O que já existe nesta etapa

- **Login** (tela 1): autentica via Supabase Auth; se o usuário estiver
  com `status='inativo'` na tabela `users`, desloga na hora e mostra a
  mensagem, em vez de deixar entrar e travar em telas vazias por causa
  da RLS.
- **Layout autenticado**: barra lateral, contador de notificações não
  lidas em tempo real (via Realtime), e-mail e perfis do usuário logado,
  botão de sair.
- **Dashboard** (tela 2): KPIs gerais (total de metas, apuradas, não
  apuradas, críticas, atenção, atingidas), filtro por Regional, cards por
  Área com status e resultado, e ranking — só aparece dentro de uma
  Regional específica, nunca comparando Áreas de Regionais diferentes
  (doc. 08). Os dados vêm da view `v_area_results` (migration 0006) e já
  chegam filtrados pelo escopo do usuário — o frontend não faz nenhum
  filtro de permissão próprio, só usa o que a RLS deixou passar.

## O que ainda falta (doc. 05)

As outras 11 telas: Metas, Detalhe da Meta, Apuração, Solicitações,
Aprovações, Usuários, Áreas e Regionais, Indicadores, Relatórios,
Auditoria, Notificações (central completa — hoje só existe o contador).

## Limitação de teste nesta etapa

Consegui validar: o build de produção (`npm run build`) e o type-check
(`tsc -b`) passam limpos, e a consulta que o Dashboard faz
(`v_area_results`) foi testada direto no Postgres com os dados reais
importados — 31 Áreas, todas com peso 100%, resultado calculado
corretamente.

O que eu **não** consegui testar aqui: o fluxo de login de verdade. Isso
depende do servidor de autenticação do Supabase (GoTrue), que só existe
num projeto Supabase real — não dá pra simular localmente só com Postgres.
Também não existem ainda contas de usuário criadas (a carga inicial trouxe
Áreas/Metas/Indicadores, mas não criou logins) — isso é um passo à parte,
feito pela tela de Usuários (ainda não construída) ou diretamente no
painel do Supabase por enquanto.
