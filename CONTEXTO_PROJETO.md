# PROMPT DE CONTEXTO — Sistema de Gestão de Metas (Âmbar Energia)

Cole este conteúdo na primeira mensagem de um novo chat com o Claude para retomar o projeto de onde paramos.

---

Você está assumindo a continuação de um projeto já em produção. Leia tudo antes de agir. Responda sempre em português.

## 0. COMO EU QUERO TRABALHAR (regras de colaboração, importantes)
- Eu discuto e valido os pontos com você ANTES de qualquer execução. Só crie/altere algo quando eu der o sinal explícito ("pode criar", "pode recriar", "pode"). Em conversa de levantamento, não construa nada.
- Quando algo parecer estranho, PERGUNTE se é bug ou comportamento intencional antes de "corrigir". Já aconteceu de você "corrigir" algo que era funcionalidade e quebrar (destaque em cascata das faixas — ver §7).
- Ao mexer em algo, não pode quebrar outra coisa: layout, fórmulas e cálculos. Teste antes de entregar (type-check, build e, no banco, simulação com rollback).
- Sempre que possível, proponha o desenho e confirme comigo (perguntas objetivas, uma de cada vez quando for decisão de negócio).
- Registre decisões em DECISIONS.md (ver §8) e seja honesto sobre erros e limitações.

## 1. ESCOPO DO PROJETO
Sistema web de gestão de metas por Área/Regional da Âmbar Energia, substituindo um painel HTML local antigo (painel-metas, lia planilha Excel). Funcionalidades: dashboard por Regional/Área, apuração de resultados, workflow de aprovação com hierarquia, usuários com perfis/escopos, auditoria, notificações, exportação Excel.
Regionais: Centro-Sul, Norte, Rio (a planilha usa "Rio", não "Sudeste"). 31 áreas, 169 metas, 665 faixas, 44 indicadores, ciclo "Ciclo 2026". Metas são COLETIVAS por Área (sem rateio individual por colaborador; casos isolados = áreas separadas tipo "Faturamento SP 1/SP 2").

## 2. STACK E INFRA (tudo em produção)
- Banco/Auth: Supabase, projeto "sistema-metas-ambar", ref vrhifxqovglqytdwjlhn, região sa-east-1, URL https://vrhifxqovglqytdwjlhn.supabase.co, Postgres 17. RLS em tudo.
- Frontend: React 18 + TypeScript + Vite + Tailwind + @supabase/supabase-js + react-router-dom + xlsx. Pasta frontend/.
- Deploy: Vercel (https://pdm2026.vercel.app), conectado ao GitHub rafaelfontoura17-web/sistemametas (branch main, deploy automático no push; Root Directory = frontend; vercel.json com rewrite SPA).
- Edge Function: create-user (Deno), verify_jwt, deploy v2 ativo.
- Scripts: scripts/import_planilha.py (carga inicial da planilha, valida tudo antes de gravar), scripts/provision_users.py.
- Repo: raiz contém frontend/, scripts/, supabase/migrations/, supabase/functions/, README.md, DECISIONS.md, .gitignore.
- Admin atual: rafael.espindola@ambarenergia.com.br (outros 3 admins já cadastrados). Usuários são criados pela tela (Edge Function), nunca com service_role no navegador.

## 3. REGRAS DE NEGÓCIO (cálculo)
- 5 faixas fixas por meta: 80/90/100/110/120% de atingimento. Atingimento é DISCRETO (maior faixa cujo critério o Real satisfaz), SEM interpolação; abaixo da faixa mínima = 0%; teto 120%.
- Resultado ponderado = atingimento × peso. Resultado da Área = soma dos ponderados (peso de cada Área soma 100%; metas não apuradas contam 0, o peso NÃO é redistribuído). Peso soma 100% é validado no fechamento da Área.
- 5 direções de indicador (indicators.direction): maior_melhor, menor_melhor, binario (só faixa 100%, Real ≥ alvo; sim/não), cronologico (mês ordinal 1-12, "quanto antes melhor", comparação como menor_melhor), percentual_por_mes (composta: exige % E mês ao mesmo tempo; usa goal_ranges.target_month e goal_results.real_value_pct; só entra na faixa se mês ≤ mês-alvo E % ≥ alvo).
- Unidade "%" é armazenada como fração (0.85), exibida como 85%.
- Status de meta (cores únicas em src/lib/statusColors.ts, usado também na legenda): verde=atingida/superada, AZUL=atingida parcialmente, vermelho=abaixo do mínimo, AMARELO=aguardando apuração (azul/amarelo trocados de propósito, é o padrão deles).
- Tabela de faixas na tela: destaque em CASCATA — toda faixa com % ≤ atingimento real fica verde (110% acende 80/90/100/110). Usa attainment_percentage do banco (isBandAchieved em goalFormat.ts). NÃO mudar.
- Fechamento de Área: só com todas as metas apuradas e peso 100% (trigger). Reabertura por solicitação ou direta por Admin/Gestor.

## 4. REGRAS DE NEGÓCIO (perfis, escopo, aprovação) — definidas em conversa
Perfis: administrador, gestor, usuario.
- Escopo de VISUALIZAÇÃO (user_access): Admin = global; Gestor = global, regional inteira ou área; USUÁRIO = SEMPRE a Regional inteira (decisão dos coordenadores regionais; nunca área isolada, forçado no banco e na Edge Function).
- Escopo de EDIÇÃO (user_edit_access, só Usuário): lista de Áreas específicas dentro da MESMA Regional que ele vê (trigger valida). Ex.: Erika vê Norte inteira, só solicita em "Apoio Fiscal".
- Fluxo de resultado (RPC submit_goal_result, única porta de escrita em goal_results; não há mais INSERT/UPDATE direto):
  * Administrador: aplica na hora e auto-aprova (único caso de autoaprovação; fica em auditoria como "Auto-aprovado (Administrador)").
  * Gestor: SEMPRE vira solicitação pendente (primeiro lançamento ou correção), sobe pro Admin (hierarquia por escopo: Gestor de escopo maior ou Admin aprovam; Admin sempre aprova).
  * Usuário: SEMPRE solicitação pendente, só se a Área estiver na sua lista de edição; aprovado por Gestor com escopo ou Admin.
  * Autoaprovação é proibida para todos, exceto o caso Admin acima.
- Tipos de solicitação: alteracao_resultado, alteracao_meta (peso), exclusao, reabertura. Criação de meta é direta (Admin/Gestor), sem aprovação (removido o tipo 'inclusao').
- Reprovação exige justificativa. Aprovação em lote só do MESMO tipo; "aprova tudo e avisa no final quais falharam".
- Tela Aprovações/Solicitações: filtro por Regional (chips, abre em "Todas"), cards no formato certo por tipo (resultado: meta/área/regional + Real antes→depois; meta: peso antes→depois; reabertura: área/regional/ciclo), com quem enviou (nome + cargo, sem perfil), justificativa, selo Pendente/Aprovada/Reprovada, e quem aprovou/reprovou (+ motivo da reprovação) em Solicitações.

## 5. BANCO — migrations (supabase/migrations, aplicar em ordem; TODAS já aplicadas em produção)
0001 schema (23 tabelas) | 0002 RLS + funções fn_* + motor fn_calc_attainment + triggers | 0003 workflow aprovação (approve/reject/create_approval_request, fn_can_approve, hierarquia fn_gestor_scope_level) | 0004 binario/cronologico | 0005 percentual_por_mes | 0006 v_area_results | 0007 seed roles/permissions | 0008 v_goal_details | 0009 fix visibilidade do solicitante | 0010/0013/0017 v_user_details (employee_id, edit_areas) | 0011/0012 hardening (search_path, revoke de PUBLIC) | 0014/0016 admin_update_user (atômica, 6 args) | 0015 user_edit_access + submit_goal_result + apply_approval_effect + remove insert direto | 0016 v_approval_details + batch_approve_requests.
Views todas com security_invoker=true. Funções internas revogadas de PUBLIC; só as chamadas por RLS/frontend têm GRANT a authenticated.

## 6. FRONTEND — telas (src/pages)
Login (layout dividido, logo real, esqueci/redefinir senha — funcionando), Dashboard (colunas por Regional × quadrantes Coordenação/Supervisão/Demais, tons lavanda/pêssego/verde-claro, cards com anel de progresso, flex-wrap; filtro por regional reorganiza), AreaDetail (/areas/:id, fluido sem max-width), Metas e Apuração (renomeada; filtros regional → área dependente → status), GoalDetail (formulário único submit_goal_result adaptado às 5 direções), Solicitações, Aprovações, Notificações, Usuários (novo usuário via Edge Function, editar nome/perfil/regional/áreas de edição em card organizado, ativar/desativar), Áreas e Regionais (+vínculo área↔regional), Indicadores, Relatórios (Excel), Auditoria. Itens admin no menu só para Admin.
Identidade: cinza-chumbo #2e3636 (sidebar) e laranja #ff7300 (acento), extraídos da logo real (public/logo-ambar.jpg, link pro Dashboard). Sidebar com "Painel de Metas / Gestão executiva de performance" e legenda de status.
Componentes-chave: ApprovalCard, ProgressRing, PageHeader, StatusLegend, lib/statusColors.ts, lib/goalFormat.ts.

## 7. LIÇÕES E ARMADILHAS CONHECIDAS
- "Bug" do destaque de faixas era funcionalidade intencional (cascata); fui eu que errei. Perguntar antes de corrigir.
- Admin editando o PRÓPRIO perfil quebrava (delete+insert em user_roles perdia permissão no meio) → resolvido com RPC atômica admin_update_user. Evitar operações multi-passo do navegador que dependam da própria permissão.
- Postgres: função nova ganha EXECUTE para PUBLIC por padrão (revogar de PUBLIC, não só de anon); mudar assinatura de função cria sobrecarga (dropar a antiga); CREATE OR REPLACE VIEW não insere coluna no meio (DROP+CREATE); novas views precisam de GRANT SELECT.
- Dados da planilha de origem têm erros pontuais (ex.: meta "Mapeamento dos itens sem Movimentação", Supervisão AC, estava em Qtde 0-4; corrigida no banco para % 80/85/90/95/100, direção maior_melhor). Se a planilha for corrigida, replicar no banco com cuidado (checar se o indicador é compartilhado por várias áreas antes de alterar).
- Ambiente de ferramentas: execute_sql do MCP retorna só o ÚLTIMO result set e não aceita \gset; "No approval received" costuma passar ao repetir; create_file às vezes falha com "path Field required" (repetir); rsync não existe (usar find+cp); para testar RLS/auth.uid() em produção usar transação com `set local role authenticated; set local request.jwt.claim.sub='<uuid>'` e ROLLBACK; testes locais com Postgres 16 (precisa stub de auth.uid e role authenticated).
- Deploy: tenho clone de trabalho e faço git push direto no repo quando você me der um token GitHub fine-grained (Contents: read/write, só este repo). Usar o token só no comando de push, nunca gravar/mostrar; limpar do remote depois. Precisa de token novo a cada conversa.

## 8. DOCUMENTAÇÃO
DECISIONS.md no repo tem ~62 itens numerados de decisões técnicas e de negócio, com motivo e testes. Leia antes de mexer em regras de cálculo ou aprovação. Os documentos de especificação originais (01–10, Prompt Mestre) definiram: fonte de verdade das regras = docs funcionais; lacunas técnicas resolvidas pela alternativa segura e compatível, com decisão documentada; não reinterpretar regras de negócio sem autorização.

## 9. LIMITAÇÕES CONHECIDAS / PENDÊNCIAS
- Duas solicitações pendentes para a mesma meta: aprovar a mais antiga depois da mais nova pode sobrescrever o valor (item 51 do DECISIONS). Possível solução: bloquear 2ª solicitação pendente por meta. Aguardando sua decisão.
- Goal_result_history não guarda antes/depois de real_value_pct separadamente (só 2 metas usam essa direção).
- Gestor/Admin ainda podem editar peso de meta direto via RLS (goals), apesar de existir o tipo 'alteracao_meta' com aprovação — tensão não resolvida, não discutida ainda.
- Exportação PDF não existe (só Excel); Relatórios só no menu de Admin.
- Visão "Por colaborador" do painel antigo não foi recriada.
- Avisos de performance do linter Supabase (auth_rls_initplan, múltiplas policies permissivas, índices em FKs) não tratados; bundle único de ~750KB (sem code splitting).
- Ficou em aberto: rodar a planilha corrigida de novo contra o banco para achar outras divergências além da meta de Mapeamento.
- O usuário mencionou que tinha mais pontos importantes para levantar depois dos ajustes. Comece perguntando quais.

## 10. PRÓXIMOS PASSOS SUGERIDOS
1) Pergunte quais pontos pendentes eu quero levantar. 2) Valide comigo cada um antes de executar. 3) Resolver a limitação das solicitações duplicadas. 4) Decidir sobre edição direta de peso por Gestor/Admin. 5) Opcionais: PDF, Relatórios para Gestor, code splitting, performance do banco.

Confirme que leu e resuma em poucas linhas o que entendeu, sem criar nada, e pergunte por onde quero começar.
