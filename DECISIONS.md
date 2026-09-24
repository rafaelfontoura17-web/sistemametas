# Decisões técnicas — Migration 0001 (schema)

Registro exigido pelo doc. 10: lacunas técnicas resolvidas pela alternativa
segura e compatível. Não é exaustivo de todo o projeto — só as decisões
que apareceram nesta migration.

1. **Chaves primárias em UUID (`gen_random_uuid()`)**, não serial/bigint.
   Motivo: `users.id` precisa casar 1:1 com `auth.users.id` do Supabase Auth,
   que é UUID — manter tudo em UUID evita tipos mistos e facilita RLS
   (`auth.uid()` compara direto).

2. **`users.id` é FK direta para `auth.users(id)`**, sem senha na tabela
   local — confirma o doc. 02 ("Senha não armazenada nesta tabela").
   `on delete cascade`: se o usuário for removido do Auth, o vínculo local
   cai junto (dado que o histórico de ações referencia `users.id`, não
   apaga o rastro nas tabelas de auditoria/histórico, só a linha em `users`).

3. **Status como `text` + `CHECK`, não `ENUM` nativo do Postgres.**
   Motivo: os docs não fecham a lista completa de estados para cada
   entidade (ex.: `goal_cycles.status`), e alterar um ENUM depois exige
   `ALTER TYPE` fora de transação em versões antigas do Postgres. `CHECK`
   é mais barato de evoluir numa V1 que ainda vai mudar.

4. **`employees` não carrega peso individual em metas.** O doc. 01 é
   explícito: "Meta pertence à Área. As metas são coletivas para os
   colaboradores daquela Área." Isso é diferente do painel HTML de
   referência (que ratejava peso por colaborador) — decisão consciente de
   seguir o documento funcional, não o painel, conforme instrução do
   doc. 10 ("não reinterpretar regras de negócio sem autorização"). Se a
   intenção real era manter rateio individual, isso precisa ser confirmado
   antes de eu prosseguir para a camada de cálculo.

5. **Validação "peso soma 100% por Área/Ciclo" e "Área+Regional de uma meta
   precisa existir em `area_regionals`" NÃO estão nesta migration.**
   Constraints cruzadas entre linhas não dá pra expressar em `CHECK` de
   coluna — isso vai para a próxima migration, como função/trigger
   (ou validação na camada de aplicação/RPC), junto com o restante das
   regras de fechamento e aprovação.

6. **RLS não foi habilitado nesta migration.** Proposital — schema puro
   primeiro, como etapa isoladamente verificável; RLS + policies por
   perfil/escopo entram na migration seguinte.

7. **`goal_results.attainment_percentage` tem `CHECK` entre 0 e 120** —
   reforço em banco do teto/piso já confirmado com você, redundante com a
   validação de aplicação (defesa em profundidade, coerente com "não
   confiar somente na interface" do doc. 06).

8. **`indicators.value_type` ficou livre (`text`, sem `CHECK`)** — os docs
   não enumeram os tipos de valor possíveis (número, percentual, moeda,
   tempo), então não fechei uma lista para não inventar regra de negócio.

## Decisão confirmada (item 4)

- Metas só por Área, sem rateio individual formal — confirmado. Casos
  isolados de pessoas com metas diferentes dentro da "mesma" área lógica
  são resolvidos criando sub-áreas nomeadas (ex.: "Coordenação
  Suprimentos — João" / "— Maria"), cada uma com seu próprio `area_id` e
  conjunto de metas fechando em 100%. Rateio individual formal (com
  aprovação/auditoria) fica para o V2, como o roadmap já previa.

---

## Migration 0002 (RLS + validações + motor de cálculo)

Funções de apoio usam nomenclatura `fn_<nome>(p_user uuid, ...)` — com o
usuário como parâmetro explícito, não `auth.uid()` implícito — porque a
migration 3 precisa checar elegibilidade de aprovação para um usuário
que **não** é quem está logado no momento (ex.: "esse Gestor específico
pode aprovar esta solicitação?"). `fn_has_role`, `fn_is_admin`,
`fn_has_scope`, `fn_has_permission`, `fn_calc_attainment`.

9. **`user_access.regional_id` virou opcional.** O doc. 01/03 fala em
   Gestor "Global", mas o doc. 02 não modelava isso (regional_id era
   obrigatório). Generalizado: `(regional, área) ambos nulos` = acesso
   global; `(regional preenchido, área nula)` = toda a Regional;
   `(ambos preenchidos)` = uma Área específica. Combinação inválida
   (área sem regional) é bloqueada por CHECK.

10. **`goal_results` ganhou `UNIQUE(goal_id)`** — não estava na migration 1.
    O doc. 01 diz "uma meta já apurada não é relançada nos meses
    seguintes", ou seja, é um resultado por meta no ciclo, não uma série
    mensal. `goal_result_history` é quem guarda a evolução/alterações.

11. **`goal_results` não tem NENHUMA policy de UPDATE para o cliente.**
    Mais estrito do que só bloquear reapuração: mesmo a primeira correção
    de um valor recém-lançado precisa passar pela função de aprovação
    (migration 3), que roda como `security definer` e contorna a RLS só
    quando a alteração foi de fato aprovada. Isso torna "alteração de
    resultado sempre exige aprovação" (doc. 01) garantido pelo banco, sem
    exceção — nem para o próprio Administrador.

12. **Fechar Área é permitido direto pra Admin/Gestor no escopo (via RLS
    normal)** — mas um trigger (`fn_check_area_closure`) valida peso=100%
    e "nenhuma meta pendente" toda vez que `status` vira `'fechada'`,
    **não importa por qual caminho** a escrita chegou lá. Reabrir também é
    permitido direto pra Admin/Gestor; reabertura solicitada por quem não
    tem essa permissão passa pela função de aprovação (migration 3), que
    grava direto (bypassa RLS) — o trigger não valida nada ao reabrir
    (só dispara quando o novo status é `'fechada'`).

## Migration 0003 (workflow de aprovação)

Hierarquia de Gestor definida por você: **Gestor de Regional inteira é
superior ao Gestor de uma Área específica dentro dela; Gestor Global é
superior a qualquer um dos dois.** Implementado como "amplitude de
escopo" (`fn_gestor_scope_level`: 3=global, 2=regional inteira, 1=área
específica) — um Gestor só aprova solicitação de outro Gestor se tiver
nível estritamente maior no mesmo par Regional+Área. Se o solicitante for
um Usuário comum (não Gestor), qualquer Gestor com acesso àquele escopo
pode aprovar — a hierarquia só entra em jogo Gestor-contra-Gestor.
Administrador sempre pode aprovar, em qualquer caso.

14. **`approval_requests` ganhou `regional_id`/`area_id`/`cycle_id`
    diretos**, além do `goal_id` que já existia. Necessário porque
    "reabertura" é sobre o fechamento de uma Área inteira, não sobre uma
    meta específica — não tem `goal_id`. Sem essas colunas não dava pra
    saber quem pode aprovar nem achar a solicitação certa por esse tipo.

15. **`request_type` ganhou `CHECK`** — inicialmente fechado nos 5 tipos
    que os documentos descrevem, depois reduzido para 4 (`alteracao_meta`,
    `alteracao_resultado`, `exclusao`, `reabertura`) quando você confirmou
    que criação de meta não passa por aprovação — ver "Decisão registrada"
    logo abaixo.

16. **Duas policies da migration 2 (`scoped_insert`/`scoped_select` em
    `approval_requests`, e `no_self_approval` em `approval_actions`)
    validavam escopo só através de `goals.goal_id`** — quebrava pra
    reabertura, que não tem meta. Refeitas usando as colunas de escopo
    direto da própria `approval_requests`. A de `approval_actions` também
    ganhou a checagem de hierarquia (antes só bloqueava autoaprovação e
    conferia escopo, sem comparar nível) — assim um insert direto na
    tabela (contornando a função) fica sujeito à mesma regra de hierarquia
    que a função aplica, não só a uma versão mais fraca dela.

17. **Efetivação de `'inclusao'` nunca foi implementada de fato** —
    havia uma contradição não resolvida nos documentos sobre se criação de
    meta passava por aprovação. Resolvida (ver "Decisão registrada"
    abaixo): não passa. O branch ficou no código só como salvaguarda morta
    (o `CHECK` da seção 0 já impede esse tipo de existir).

## Decisão registrada

- **Criação de meta é direta (Admin/Gestor), sem aprovação** — confirmado
  por você. `'inclusao'` foi removido da lista de `request_type` válidos
  em `approval_requests` (era a única pendência em aberto desta migration).
  A criação continua coberta pela policy de `INSERT` em `goals` da
  migration 2 (`scoped_write`/`scoped_insert`, conforme o nome usado ali),
  que já permitia Admin/Gestor criar direto dentro do escopo — nada
  precisou mudar nessa parte, só a solicitação de aprovação é que não
  existe mais para este caso.

## Migration 0004 (direções binário e cronológico)

Confirmado por você: estender o sistema em vez de pedir pra reescrever a
planilha.

18. **`indicators.direction` ganhou dois valores novos**: `'binario'`
    (meta sim/não — só existe a faixa de 100%; Real ≥ alvo = 100%, senão
    0%) e `'cronologico'` (meta "quanto antes, melhor" por mês — mês
    guardado como ordinal 1-12, comparação idêntica a `menor_melhor`, só
    o rótulo é diferente pra a tela saber que deve mostrar/coletar nome de
    mês em vez de número cru). `fn_calc_attainment()` atualizada pra tratar
    os dois: `binario` reaproveita a comparação de `maior_melhor` (só tem
    uma faixa, então funciona igual), `cronologico` reaproveita a de
    `menor_melhor`.

## Migration 0005 (direção composta: percentual + mês)

Você identificou que a meta do Almoxarifado (Rio) — "Classificação e
Parametrização de itens" e "Classificação de itens Críticos" — não dá
pra calcular com uma entrada só: precisa bater **percentual mínimo E até
um mês-limite ao mesmo tempo** (80% até Agosto = 80%; 80% só em Setembro
fica fora da meta, mesmo o percentual estando certo).

19. **Nova direção `'percentual_por_mes'`.** `goal_ranges` ganhou a coluna
    `target_month` (1-12, nula pras outras direções) e `goal_results`
    ganhou `real_value_pct` — agora `real_value` guarda o mês alcançado e
    `real_value_pct` guarda o percentual, os dois exigidos juntos (se só
    um estiver preenchido, a meta fica "pendente", não calcula parcial).
    `fn_calc_attainment()` ganhou um terceiro parâmetro opcional
    (`p_real_pct`) e uma checagem simultânea: a faixa só é satisfeita se
    mês ≤ mês-alvo **e** percentual ≥ percentual-alvo ao mesmo tempo.
    `approve_request()` também foi atualizado para poder alterar as duas
    colunas juntas numa correção aprovada.

20. **Limitação aceita**: `goal_result_history` não tem uma coluna própria
    pra `real_value_pct` — o histórico de uma correção aprovada nessa
    direção registra a mudança do mês (`real_value`), mas não guarda o
    antes/depois do percentual separadamente. Só 2 metas no V1 usam essa
    direção; se isso crescer, vale revisitar o histórico com um campo
    genérico (JSON) em vez de colunas fixas.

Testado com 3 cenários sintéticos, batendo exatamente com sua descrição:
80% em Agosto → 80% (parcial); 80% só em Setembro → 0% (fora da meta,
crítico); 85% em Setembro → 90% (mês e percentual da faixa de 90% batem
juntos). Rodando a validação de novo contra a planilha real: as duas
metas do Almoxarifado agora passam limpo — restam só as mesmas 2
pendências de sempre (peso de SP1/Lages1, e as 10 linhas de "Treinamento
Compliance" sem a faixa de 100% preenchida). **159 de 169 metas prontas.**
Também identificado: a linha 87 (Almoxarifado/Classificação de itens
Críticos) já tem um "Real" solto (`1`) na planilha — como a direção nova
precisa de duas entradas separadas e a planilha só tem uma coluna, esse
valor não foi importado (fica um aviso, não erro) — precisa ser lançado
depois pela tela de Apuração, já com mês e percentual corretos.

## Script de carga inicial (doc. 07)

`scripts/import_planilha.py` — lê a aba "Matriz de Metas", valida tudo
antes de gravar (nenhuma carga parcial), e só grava numa transação única
se não houver erro bloqueante. `--dry-run` (padrão) só mostra o relatório;
`--commit` grava de verdade (precisa de `DATABASE_URL`); `--skip-rows`
permite excluir linhas específicas já aceitas como fora do escopo.

Rodando contra a planilha real (`Formulario_de_Metas_2026_AMBAR_-_Calculo.xlsx`,
aba Matriz de Metas, 169 metas), com as 5 migrations: **159 passam limpo**.
As 10 restantes quebram em 2 causas específicas, ambas na planilha, não
no sistema:
- 10 linhas de "Treinamento Compliance" com as 5 faixas vazias (mesmo
  indicador que outras ~30 áreas já têm corretamente preenchido com `1`
  na faixa de 100%).
- 2 áreas (Faturamento SP 1, Faturamento Lages 1) com peso somando mais
  que 100% — erro de digitação. (Essas 10 linhas de Treinamento também
  contam peso nas suas áreas — pular a linha sem preencher a faixa faz a
  soma de peso daquelas áreas cair artificialmente, então a correção
  certa é preencher a faixa que falta, não excluir a linha.)

Testado de ponta a ponta contra Postgres local com as 5 migrations
aplicadas: as metas válidas são gravadas em uma única transação, incluindo
os goal_ranges (com target_month quando aplicável), e o motor de cálculo
recalcula automaticamente onde já havia Real preenchido — verificado com
dados sintéticos para os 4 casos (binário, cronológico, percentual_por_mes
e o padrão normal) antes de rodar contra a planilha real.

## Testes realizados

Rodei um Postgres 16 local, recriando o banco do zero a cada rodada de
teste e aplicando as 3 migrations em sequência com `ON_ERROR_STOP=1`
(qualquer erro para a execução, não deixa nada aplicado pela metade).
Criei o papel `authenticated` sem privilégio de superusuário — testar
como `postgres` não provaria nada, porque superusuário ignora RLS por
completo — e simulei 5 usuários (admin, gestor de área, gestor de
regional inteira, gestor de outra área/mesmo nível, usuário sem escopo).
Confirmado:
- Usuário sem escopo não vê nem cria metas fora do que tem acesso; Gestor
  só age dentro do escopo de `user_access`; Admin vê tudo sempre.
- Motor de cálculo: banda exata sem interpolar (950→90%), teto 120%
  (1350→120%), piso 0% abaixo do mínimo (500→0%), pendente sem Real.
- Segundo lançamento de Real na mesma meta é bloqueado (constraint).
- Solicitação de alteração de resultado criada por Gestor de Área.
- Esse mesmo Gestor tentando aprovar a própria solicitação: bloqueado.
- Gestor da Regional inteira (hierarquicamente acima): aprova, e o
  resultado é recalculado automaticamente (950→1150 = 110%, com o
  histórico antes/depois gravado corretamente).
- Gestor de outra Área (mesmo nível hierárquico, sem acesso a essa Área):
  não elegível para aprovar.
- Reprovação sem justificativa: bloqueada. Com justificativa: funciona e
  não altera o valor original (nada é efetivado numa reprovação).


## Migration 0006 (view de agregação para o Dashboard)

21. **`v_area_results`, com `security_invoker = true`.** O motor de
    cálculo (migrations 2-5) resolve por meta; "resultado da Área" (soma
    dos resultados ponderados) precisava de uma agregação que ainda não
    existia. `security_invoker` é essencial: sem isso a view rodaria com
    o privilégio de quem criou (o dono, que ignora RLS) e vazaria dados
    fora do escopo de quem consulta.
22. **Categoria da Área (coordenação/supervisão/outras) inferida pelo
    prefixo do nome dentro da view**, não uma coluna própria — não existe
    no doc. 02, e é o mesmo critério que o painel de referência já usava.
23. **Teto de 120% na Área é estrutural, não precisou de `LEAST()`.**
    Como o peso de uma Área sempre soma 100% (migration 2 valida isso no
    fechamento) e cada meta contribui no máximo `120% × seu peso`, a soma
    de todas as metas de uma Área nunca ultrapassa 120% mesmo sem cap
    explícito — é consequência da estrutura, não uma regra que precisou
    ser codificada à parte.

## Frontend (React + TypeScript + Vite + Tailwind + Supabase JS)

Doc. 10 não define stack de frontend — escolhido o conjunto mais simples
e comum pra um app que só fala com Supabase via RLS (sem backend próprio
no meio): React + TS + Vite + Tailwind + `@supabase/supabase-js`.

Construído nesta etapa: Login (desloga na hora se `status='inativo'`, em
vez de deixar entrar e travar em telas vazias por causa da RLS), layout
autenticado com contador de notificações em tempo real, e Dashboard
completo (KPIs, filtro por Regional, cards por Área, ranking só dentro de
uma Regional — nunca comparando Regionais diferentes, doc. 08).

Testado: `tsc -b` e `npm run build` passam limpos; a consulta que o
Dashboard faz (`v_area_results`) foi validada direto no Postgres com os
dados reais — 31 Áreas, peso 100%, resultado calculado certo.

**Não testado nesta etapa**: o fluxo de login de verdade — depende do
servidor de autenticação do Supabase (GoTrue), que não existe fora de um
projeto Supabase real, só Postgres não é suficiente pra simular.

**Pendência nova**: a carga inicial (doc. 07) trouxe Áreas/Metas/
Indicadores, mas não criou nenhuma conta de usuário — login precisa de
linhas em `auth.users` (Supabase Auth) + `users` + `user_roles` +
`user_access`, que ainda não têm uma tela nem um script de provisionamento.
Isso vira a tela de Usuários (doc. 05) ou um script à parte.

## Migration 0007 (seed de perfis/permissões)

24. **Faltava uma migration que criasse os 3 perfis (`administrador`,
    `gestor`, `usuario`) e as 2 permissões finas (`lancar_resultado`,
    `solicitar_alteracao`)** que o código das migrations 2-5 já
    referenciava por "code". Até aqui eu vinha inserindo isso à mão em
    cada sessão de teste — funcionava nos meus testes, mas quem aplicasse
    as migrations 1-6 num projeto novo ficaria sem conseguir provisionar
    ninguém. Corrigido: são dados de referência do próprio sistema, não
    dado de negócio da planilha, então entram numa migration própria.

## Migration 0008 (view de detalhe da meta)

25. **`v_goal_details`**, mesmo padrão de `security_invoker = true` de
    `v_area_results` — uma linha por meta ativa com indicador/área/
    regional/resultado juntos, usada pelas telas de Metas e Detalhe da
    Meta/Apuração.

## Script de provisionamento de usuários

`scripts/provision_users.py` — cria a conta no Supabase Auth (Admin API,
precisa de `SUPABASE_SERVICE_ROLE_KEY`, nunca a anon key) e já vincula
`employees`/`users`/`user_roles`/`user_access` a partir de um CSV
(`nome,email,senha_temporaria,cargo,perfil,escopo_regional,escopo_area`).
Escopo vazio em `escopo_regional` = Global; `escopo_area` vazio com
`escopo_regional` preenchido = Regional inteira.

Testado: a parte de banco (`provision_db`) foi validada de ponta a ponta
contra o Postgres local com um usuário de cada perfil (Administrador
Global, Gestor de Regional inteira, Gestor de Área específica, Usuário
comum) — os escopos gravados batem exatamente com o CSV, e testei a RLS
de verdade logado como o usuário comum: ele só enxerga metas da área dele.
**Não testado**: a chamada real ao Admin API do Supabase (não dá pra
simular o servidor de autenticação — GoTrue — fora de um projeto real).

**Achado ao testar**: as concessões de `GRANT`/`ALTER DEFAULT PRIVILEGES`
que uso pra simular o papel `authenticated` localmente **não fazem parte
de nenhuma migration** — e não deveriam. Um projeto Supabase real já
concede isso de fábrica pros papéis `anon`/`authenticated`/`service_role`;
essas concessões são só andaime do meu ambiente de teste (Postgres puro,
sem o resto da plataforma Supabase por trás). Documentando aqui pra não
confundir alguém tentando reproduzir os testes localmente.

## Frontend — Metas e Detalhe da Meta/Apuração

Telas 3 (Metas) e 4+5 (Detalhe da Meta + Apuração, combinadas nesta etapa
pra ganhar tempo — dá pra separar depois sem problema) construídas e
testadas. A tela de Apuração se adapta às 5 direções: número simples
(maior/menor_melhor, com conversão automática quando a unidade é "%"),
Sim/Não (binário), seletor de mês (cronológico), ou percentual + mês
juntos (percentual_por_mes). RLS testada de verdade: Gestor consegue
apurar dentro do escopo; a mesma lógica de bloqueio por escopo/permissão
já validada nas migrations anteriores se aplica sem mudança nenhuma.

Build (`npm run build`) e type-check (`tsc -b`) passam limpos.

## Migration 0009 (correção de bug — visibilidade do solicitante)

26. **Bug real, corrigido**: ao reescrever a policy de select de
    `approval_requests` na migration 3 pra cobrir reabertura (sem
    `goal_id`), a cláusula `requester_id = auth.uid()` que já existia na
    migration 2 ficou de fora sem eu perceber. Resultado: um Usuário
    comum que criava uma solicitação não conseguia ver a própria
    solicitação depois — só Admin/Gestor com escopo viam. `approval_
    request_items` já tinha essa cláusula certa; só `approval_requests`
    tinha ficado quebrada. Testado antes/depois: Beltrano (usuário comum)
    cria uma solicitação e agora consegue vê-la.

## Migration 0010 (view de usuários)

27. **`v_user_details`**, mesmo padrão `security_invoker = true` — junta
    `users`+`employees`+`user_roles`+`user_access` num array de perfis e
    escopos legível, pra tela de Usuários.

## Frontend — telas restantes do doc. 05

Construídas nesta etapa, sem interrupção pra decisão (nenhuma apareceu):
Solicitações, Aprovações, Notificações (central completa), Usuários,
Áreas e Regionais (com gestão do vínculo Área↔Regional — sem ele nenhuma
meta pode existir naquele par), Indicadores, Relatórios (exportação
Excel via lib `xlsx`) e Auditoria.

**Simplificações conscientes, documentadas em vez de perguntadas por não
serem decisões de regra de negócio, só de organização de tela:**
- **Detalhe da Meta + Apuração viraram uma tela só** (doc. 05 trata como
  2 telas separadas) — dá pra separar depois sem mexer em lógica.
- **Relatórios ficou dentro do menu "Administração" (só Admin vê o
  link)** — o doc. 08 não deixa claro se Gestor também deveria exportar
  relatório do próprio escopo; a RLS já filtraria certo se um Gestor
  acessasse a rota diretamente, então é só uma questão de mostrar o link
  ou não. Fácil de abrir pra Gestor depois, se fizer sentido.
- **Exportação em PDF não foi construída** — só Excel (`xlsx`) nesta
  etapa. PDF exigiria outra lib (`jspdf` ou geração server-side) e não
  parecia valer travar a entrega dessas 8 telas por isso.
- **Criação de conta de usuário continua fora do navegador** (script
  `provision_users.py`), nunca pela tela — a Admin API do Supabase exige
  a `service_role key`, que nunca pode ir pro bundle do frontend (vazaria
  pra qualquer pessoa que abrisse o DevTools). A tela de Usuários só
  ativa/desativa e mostra perfil/escopo de quem já existe.

**Testado**: `tsc -b` e `npm run build` passam limpos (94 módulos,
bundle único — vale considerar `code splitting` mais adiante, o aviso do
Vite é só sobre tamanho, não erro). Smoke-test direto no Postgres pra
cada tela nova: Admin cria Área + vínculo Área↔Regional (funciona);
Gestor comum tentando criar Área (bloqueado pela RLS); Auditoria consultada
por um Gestor comum (RLS filtra silenciosamente pra 0 linhas, sem erro —
comportamento correto de `SELECT` com RLS).

## Estado geral do projeto nesta pausa

Todas as 13 telas do doc. 05 existem (12 rotas, já que Detalhe+Apuração
foram combinadas). RLS, motor de cálculo, workflow de aprovação com
hierarquia, carga inicial e provisionamento de usuários — todos
testados de ponta a ponta contra dados reais.

**Não testado**: fluxo de login/sessão de verdade (depende do GoTrue do
Supabase, só existe num projeto real) e as chamadas Realtime/RPC via
navegador de fato (só testei as mesmas queries/RPCs direto no Postgres,
simulando o papel `authenticated` — o comportamento deve ser idêntico via
`@supabase/supabase-js`, mas a biblioteca em si não foi exercitada).

## Deploy real — projeto Supabase provisionado

Criado o projeto **sistema-metas-ambar** (`sa-east-1`, plano gratuito) na
sua organização Supabase. As 10 migrations + a de hardening de segurança
foram aplicadas nele diretamente (não é mais só ambiente local de teste).

28. **Hardening de segurança (migrations 11 e 12)**: rodei `get_advisors`
    (linter de segurança do próprio Supabase) depois de aplicar tudo e
    apareceram 2 categorias de aviso real:
    - 5 funções sem `search_path` fixo — corrigido com `ALTER FUNCTION`.
    - 11 funções `SECURITY DEFINER` executáveis por `anon` (usuário não
      logado) — não há nenhum caso de uso anônimo neste sistema.
    A migration 11 tentou revogar de `anon`/`authenticated` especificamente,
    mas não teve efeito — descobri rodando o advisor de novo que o Postgres
    concede `EXECUTE` a `PUBLIC` por padrão na criação da função, e um
    grant a `PUBLIC` inclui todo mundo independente do que se revoga de um
    papel específico. Migration 12 corrigiu revogando de `PUBLIC` e
    reconcedendo só pra `authenticated` nas funções que a RLS ou o
    frontend realmente precisam chamar. Resultado: os avisos de `anon`
    sumiram completamente; os de `authenticated` caíram de 11 pra 8 — os
    8 que sobraram são intencionais (funções que a RLS usa direto nas
    policies, ou que são o próprio endpoint RPC do frontend).
    **Não corrigidos**: os avisos de performance (`auth_rls_initplan` —
    envolver `auth.uid()` em `(select auth.uid())` nas policies pra cache
    do planner; `multiple_permissive_policies`; índices em foreign keys
    não usadas) — são otimizações de escala, não problemas de correção ou
    segurança, e o volume de dados atual (169 metas) não justifica o
    esforço agora. Documentado aqui pra retomar se o sistema crescer.

29. **Carga de dados real via SQL direto, não via `import_planilha.py`**.
    O ambiente onde rodo os comandos não tem uma conexão Postgres direta
    pro projeto real (só a ferramenta MCP do Supabase, que aplica SQL via
    `apply_migration`/`execute_sql`) — não dá pra rodar o script Python
    (que usa `psycopg2`) direto contra ele. Contornei gerando o SQL de
    carga a partir da mesma lógica do `import_planilha.py` (mesmas
    validações, já com 0 erros confirmados antes) e aplicando em pedaços:
    dados de referência, depois metas, depois faixas+resultados (esse
    último como um bloco `DO $$ ... $$` que expande um JSON compacto —
    a versão ingênua com uma linha `INSERT` por faixa, repetindo os JOINs
    inteiros, passava de 700KB de SQL repetitivo). Resultado idêntico ao
    testado localmente: 169 metas, 665 faixas, 85 resultados, 31 áreas,
    todas com peso 100%.

30. **Criação de usuário via Admin API não pôde ser automatizada por
    mim.** Não tenho uma ferramenta de chamada HTTP genérica (POST) nem
    acesso à `service_role key` — por design, a mesma razão pela qual o
    frontend nunca deveria ter essa chave. Você criou o admin direto no
    painel do Supabase (Authentication → Add user); eu completei a parte
    de banco (vínculo em `users`/`user_roles`) a partir do e-mail que você
    informou.

## Arquivos de deploy (GitHub + Vercel)

Adicionados nesta etapa: `.gitignore` na raiz, `README.md` na raiz com o
passo a passo completo de deploy, `frontend/vercel.json` (rewrite de SPA
— sem isso, atualizar a página em `/metas/123` dá 404 no Vercel) e
`frontend/.env.local` já preenchido com a URL e a chave `anon` reais do
projeto (a chave anon é pública por design — protegida pela RLS, não pelo
sigilo — então é seguro incluir no pacote; mesmo assim fica de fora do
Git via `.gitignore`, prática padrão).

## Administrador provisionado

`rafael.espindola@ambarenergia.com.br` — criado por você via painel do
Supabase (Authentication → Add user), vínculo de perfil Administrador
(escopo global, não precisa de linha em `user_access`) feito por mim
direto no banco. Confirmado via `v_user_details`.

## Revisão visual e de UX (pós-deploy)

Depois do primeiro deploy real, você revisou a interface e apontou 5
pontos onde o app novo (React) tinha se afastado do painel-metas original
sem eu perceber durante a reconstrução. Resolvidos nesta etapa:

31. **Cores de status corrigidas em todo o sistema.** Existia uma
    inversão: eu tinha `parcial`→amarelo e `pendente`→azul; o padrão
    correto (validado no painel original) é `parcial`→**azul**,
    `pendente`→**amarelo**. Criei `src/lib/statusColors.ts` como única
    fonte de verdade — Dashboard, Metas, Detalhe da Meta, Detalhe da Área
    e a Legenda na sidebar agora importam dali, nenhum tem cor própria
    solta. Isso evita a mesma inconsistência voltar a acontecer numa
    tela nova no futuro.

32. **Dashboard reconstruído**: colunas por Regional (Centro-Sul/Norte/
    Rio) lado a lado, cada uma com os 3 quadrantes por hierarquia
    (Coordenação/Supervisão/Demais áreas) com os tons suaves originais
    (lavanda/pêssego/verde-claro — só decoração de hierarquia, sem
    relação com status). Card com anel de progresso (`ProgressRing.tsx`,
    SVG) e clicável, levando pro Detalhe da Área.

33. **Nova tela: Detalhe da Área** (`/areas/:areaId`) — o que existia no
    painel original e não tinha sido reconstruído: lista todas as metas
    da área com nome, descrição, Real/Peso/Resultado, barra de progresso,
    e a tabela de faixas com a faixa efetivamente atingida destacada em
    verde (`isBandAchieved()` em `goalFormat.ts` — mesma lógica de
    comparação do motor de cálculo, só pra fins de destaque visual, nunca
    recalculando nada por conta própria).

34. **Identidade visual**: acento trocado de verde pra azul (`#2563eb`) e
    sidebar de azul-marinho (`#0f172a`, era verde-petróleo); logo da
    Âmbar reconstruída em texto/CSS (`AmbarLogo.tsx`) — **não tenho o
    arquivo de imagem original** neste projeto, então é uma reconstrução
    aproximada; se você tiver o arquivo, é só trocar pelo `<img>`. Texto
    de marca "Painel de Metas / Gestão executiva de performance" de volta
    na sidebar. `PageHeader.tsx` novo padroniza o cabeçalho de toda tela
    (eyebrow "ÂMBAR ENERGIA · PERFORMANCE 2026" + barra de destaque +
    título), sem o botão "Importar planilha" (não existe mais no fluxo
    novo — a carga é feita pelo script, não pela tela).

35. **Legenda de status na sidebar**, usando a mesma fonte de cores do
    item 31 — não é mais uma lista solta, se o mapeamento mudar de novo
    um dia, muda nos dois lugares ao mesmo tempo.

## Criar usuário direto pela tela + editar perfil/escopo

36. **Edge Function `create-user`, implantada no projeto real** —
    resolve o pedido de criar conta sem sair do navegador, mantendo a
    `service_role key` só no servidor (nunca no bundle do frontend). A
    função confere se quem está chamando é Admin (via `fn_is_admin`)
    antes de fazer qualquer coisa, senão qualquer pessoa logada poderia
    criar uma conta de Administrador pra si mesma. Reaproveita a mesma
    lógica de provisionamento do `provision_users.py`, só que rodando no
    servidor da função em vez da máquina de quem roda o script.

37. **Edição de perfil/escopo de usuário já existente**, direto na tela
    — isso nunca teve bloqueio de segurança nenhum (só criação de conta
    depende da Admin API), só não tinha sido construído. Reescreve
    `user_roles`/`user_access` do usuário — a RLS já garante que só Admin
    consegue.

**Não testado ainda de ponta a ponta pelo navegador** (só type-check,
build, e as queries/RPCs subjacentes direto no banco) — vale você conferir
visualmente depois do deploy, principalmente o fluxo de criar um usuário
novo pela tela, já que a Edge Function nunca tinha sido exercitada de
verdade.

## Segunda rodada de ajustes visuais (logo real, edição de nome, bug de layout, Login)

38. **Cores extraídas do arquivo real da logo**, não mais chutadas: escaneei
    os pixels do `Logo_Ambar_Energia_CMYK.jpg` e usei os tons dominantes
    exatos — cinza-chumbo `#2e3636` (sidebar/texto de marca) e laranja
    `#ff7300` (acento/botões). Substituem os tons de estoque usados antes.

39. **Logo real** salva em `frontend/public/logo-ambar.jpg` — redimensionada
    e comprimida (de 766KB pra 13KB, só o necessário pra um ícone de
    sidebar) — usada na sidebar e no Login, como link clicável de volta
    pro Dashboard (`AmbarLogo.tsx`).

40. **Bug de reorganização dos cards do Dashboard corrigido** — o mesmo
    problema que já tínhamos resolvido no painel-metas original: ao
    filtrar uma única Regional, a coluna ficava travada numa largura
    fixa estreita (cards empilhados verticalmente) em vez de ocupar a
    largura toda e reorganizar os cards lado a lado. Corrigido do mesmo
    jeito de antes: `flex-wrap` com largura mínima/máxima por card
    (`flex: 1 1 260px; max-width: 340px`), não mais `space-y-2` com
    `w-full`.

41. **Edição de nome na tela de Usuários** — exigiu expor `employee_id`
    em `v_user_details` (migration 13; precisou ser `DROP + CREATE`, não
    `CREATE OR REPLACE`, porque Postgres não deixa inserir coluna no meio
    de uma view existente). Usuários sem `employee` vinculado (como o
    Administrador, criado direto no painel do Supabase, sem passar pelo
    fluxo de provisionamento) agora ganham um registro `employees` criado
    na hora, na primeira vez que alguém edita o nome dele.

42. **Login reconstruído**: layout dividido (marca à esquerda em fundo
    escuro, formulário à direita), logo real, campo de senha com
    mostrar/ocultar, foco automático no e-mail, campos desabilitados
    durante o envio, erro de "conta inativa" com destaque visual
    diferente de erro de senha errada, e **fluxo completo de "esqueci
    minha senha"** (usa `resetPasswordForEmail` do Supabase Auth) — com
    uma tela nova, `/redefinir-senha`, que recebe o link do e-mail e deixa
    a pessoa definir a nova senha.

    **Pendência operacional, não travou nada mas precisa ser feita por
    você**: a URL do site publicado (Vercel) + `/redefinir-senha` precisa
    ser adicionada em Authentication → URL Configuration → Redirect URLs
    no painel do Supabase — sem isso, o link do e-mail de redefinição
    não redireciona de volta pro app.

**Testado**: `tsc -b` e `npm run build` passam limpos. Não testado no
navegador (login de verdade, fluxo de redefinição de senha de ponta a
ponta, clique na logo) — depende do deploy real.

## Bug crítico corrigido: auto-edição de usuário quebrava a própria permissão

43. **Migration 14 — `admin_update_user()`, uma RPC atômica.** Você
    reportou o erro `new row violates row-level security policy for
    table "user_roles"` ao editar o próprio usuário. Causa raiz: a tela
    fazia "apaga user_roles → insere de novo" em duas chamadas separadas
    do navegador; no instante entre as duas, `fn_is_admin(auth.uid())`
    já dava falso (a própria linha de Admin tinha acabado de ser
    apagada), e a RLS bloqueava a reinserção. Só acontece quando alguém
    edita o PRÓPRIO perfil — editar outra pessoa nunca teve esse
    problema. Corrigido com uma função `security definer` que checa
    "é Admin?" **uma vez só**, no início, e faz tudo internamente sem
    voltar a passar pela RLS a cada instrução — mesmo padrão já usado em
    `create_approval_request`/`approve_request`/`reject_request`.

44. **Efeito colateral do bug**: sua conta ficou temporariamente **sem
    nenhum perfil atribuído** (a etapa de apagar tinha rodado antes de
    travar na de inserir). Restaurei o perfil de Administrador
    manualmente assim que percebi, direto no banco.

**Testado**: simulei exatamente o cenário que quebrou (você editando o
próprio usuário — nome e perfil) direto no Postgres, autenticado como
você. Funcionou de ponta a ponta: nome salvo, perfil de Administrador
mantido durante toda a operação, sem erro.

## Terceira rodada de decisões de negócio — escopo de edição e fluxo de aprovação reescrito

Definidas em conversa extensa, ponto a ponto, antes de qualquer execução.

### Ponto 1 — visualização separada de edição (só perfil Usuário)

45. **Nova tabela `user_edit_access`** (migration 15): usuário tem
    visualização (`user_access`, como já existia) separada de edição —
    uma linha por Área que ele pode lançar/solicitar resultado. Trigger
    (`fn_check_edit_access_area`) garante que a área de edição só pode
    ser de dentro da MESMA Regional que ele já vê — nunca de outra.
46. **Decisão de negócio (reunião dos coordenadores regionais)**: Usuário
    **sempre** vê a Regional inteira — não existe mais "vê só uma Área".
    `admin_update_user` e a Edge Function `create-user` forçam isso
    (ignoram qualquer área de visualização isolada pra esse perfil).
47. Gestor e Administrador não mudam — visualização = edição, como
    sempre foi.

### Ponto 2 — só Administrador age direto

48. **`submit_goal_result()`** (migration 15) — nova função única pra
    lançar OU corrigir resultado, pra qualquer perfil. Decide sozinha:
    - **Administrador**: aplica e auto-aprova na hora (única situação em
      que autoaprovação é permitida — decisão de negócio explícita, só
      aqui). Fica registrado em auditoria como se fosse aprovado por
      outra pessoa, só que instantâneo.
    - **Gestor**: sempre fica pendente agora — antes agia direto no
      primeiro lançamento; essa mudança foi decidida nesta rodada.
    - **Usuário**: sempre fica pendente, e só pode solicitar se a Área da
      meta estiver na lista de `user_edit_access` dele.
49. **`apply_approval_effect()`** — a efetivação de cada tipo de
    solicitação (que antes só existia dentro de `approve_request`) virou
    uma função própria, reaproveitada tanto por `approve_request` quanto
    pela auto-aprovação do Admin em `submit_goal_result` — evita duplicar
    o "case" de tipos em dois lugares. Ganhou também o ramo de **primeiro
    lançamento** (antes só existia correção de um valor já apurado).
50. **Removida a policy de INSERT direto em `goal_results`** — não existe
    mais nenhum caminho de escrita direta na tabela; tudo passa por
    `submit_goal_result` ou pela efetivação de uma aprovação.
51. **Limitação conhecida, não resolvida nesta rodada**: se houver duas
    solicitações pendentes pra mesma meta ao mesmo tempo (ex.: alguém
    solicita de novo antes da primeira ser decidida) e a mais recente for
    aprovada primeiro, aprovar a mais antiga depois pode sobrescrever o
    valor já aplicado. Não é um cenário que surgiu na conversa; registrado
    aqui como algo a revisitar se passar a acontecer na prática (ex.:
    bloquear uma segunda solicitação pendente pra mesma meta).

### Pontos 3 e 4 — Aprovações e Solicitações reconstruídas

52. **View `v_approval_details`** (migration 16) — uma linha por
    solicitação já com nome/cargo de quem pediu e de quem aprovou/
    reprovou, valores antes→depois (`items`, jsonb), e todo o contexto
    (meta/área/regional/ciclo) — usada pelas duas telas.
53. **`ApprovalCard.tsx`** — componente compartilhado que mostra cada tipo
    de solicitação no formato certo (resultado tem Real antes→depois;
    meta tem peso antes→depois; reabertura tem área/regional/ciclo) —
    evita duplicar essa lógica de formatação entre as duas telas.
54. **Aprovação em lote**: `batch_approve_requests()` (migration 16) —
    "aprova tudo, avisa no final quais falharam" (decisão de negócio: nunca
    trava o lote inteiro por causa de uma falha isolada). A tela restringe
    a seleção a um único `request_type` por vez.
55. **Filtro por Regional** em ambas as telas, igual ao Dashboard, sempre
    abrindo em "Todas as regionais".

### Ponto 5 — tela de Metas

56. Renomeada pra **"Metas e Apuração"** (tela + item do menu). Filtro
    por Área adicionado, dependente do filtro de Regional já selecionado.

### Testes realizados

Migrations 15-17 testadas localmente (Postgres do zero) cobrindo: Usuário
autorizado/não-autorizado a editar uma Área; Gestor e Admin submetendo
resultado (pendente vs. auto-aprovado); `v_approval_details` e
`batch_approve_requests`. Depois, migrations aplicadas no projeto real e
o pipeline inteiro (Gestor submete 2 pendências → Admin aprova em lote →
resultados calculados) testado **contra o banco de produção**, dentro de
uma transação com `ROLLBACK` no final — confirmado funcionando (100%/
atingido e 90%/parcial, exatamente como esperado) sem persistir nenhum
dado de teste.

Frontend: `tsc -b` e `npm run build` passam limpos. Não testado no
navegador ainda — recomendo testar principalmente: Usuário sem nenhuma
área de edição tentando lançar (deve ser bloqueado com mensagem clara),
aprovação em lote pela tela, e o formulário de "Novo usuário" com áreas
de edição.

## Bugs de ajuste fino corrigidos (pós-deploy)

57. **Largura fixa nas telas de Detalhe da Área e Detalhe da Meta**
    (`max-w-4xl`/`max-w-3xl`) sobrava muito espaço vazio em monitores
    grandes — a página não se reorganizava conforme a resolução. Larguras
    ajustadas (`max-w-6xl`/`max-w-4xl`) e o cabeçalho de cada card de meta
    (nome + Real/Peso/Resultado) e a grade de faixas agora quebram linha
    de forma responsiva (`flex-col sm:flex-row`, `grid-cols-2 sm:grid-cols-5`)
    em vez de layout fixo.

58. **Bug real na tabela de faixas: mais de uma faixa acendia em verde ao
    mesmo tempo.** `isBandAchieved()` reconferia cada faixa de forma
    independente no navegador — pra metas onde o Real supera folgadamente
    o critério de várias faixas ao mesmo tempo (comum em metas "quanto
    antes/mais, melhor", como cronológicas), isso destacava TODAS as
    faixas satisfeitas, não só a mais alta. Corrigido comparando direto
    com `attainment_percentage`, que o banco já calculou como a faixa
    correta (mais alta satisfeita, sem interpolação) — elimina a lógica
    duplicada no frontend, que era a origem do bug.

59. **Ajuste fino do item 57**: não bastava aumentar o teto de largura
    (`max-w-6xl`) — o painel antigo não tinha teto nenhum, ocupava a
    largura toda de forma fluida. Removido o `max-w` da tela de Detalhe
    da Área por completo.
