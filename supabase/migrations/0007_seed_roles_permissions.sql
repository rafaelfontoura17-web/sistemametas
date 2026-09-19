-- ============================================================================
-- 0007_seed_roles_permissions.sql
-- Sistema de Gestão de Metas — V1
-- Migration 7/N: dados de referência mínimos pra o sistema funcionar.
-- Não é dado de negócio (isso é a carga da migration/script de import) —
-- são os 3 perfis e as 2 permissões finas que o código das migrations
-- 2-5 já referencia por "code" (fn_has_role, fn_has_permission), mas que
-- nenhuma migration até agora de fato inseria. Sem isso, provisionar
-- qualquer usuário falha.
-- ============================================================================

insert into roles (name, code) values
  ('Administrador', 'administrador'),
  ('Gestor', 'gestor'),
  ('Usuário', 'usuario')
on conflict (code) do nothing;

insert into permissions (name, code, description) values
  ('Lançar resultado', 'lancar_resultado', 'Permite a um Usuário comum lançar o Real de uma meta (doc. 03: "Se autorizado").'),
  ('Solicitar alteração', 'solicitar_alteracao', 'Permite a um Usuário comum solicitar inclusão/alteração/exclusão/reabertura (doc. 03: "Se autorizado").')
on conflict (code) do nothing;
