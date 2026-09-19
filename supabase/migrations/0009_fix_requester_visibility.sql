-- ============================================================================
-- 0009_fix_requester_visibility.sql
-- Sistema de Gestão de Metas — V1
-- Migration 9/N: corrige um bug introduzido na migration 3 — ao reescrever
-- a policy de select de approval_requests pra cobrir reabertura (que não
-- tem goal_id), a cláusula "requester_id = auth.uid()" que já existia na
-- migration 2 ficou de fora. Resultado: um Usuário comum que cria uma
-- solicitação não conseguia ver a própria solicitação depois — só
-- Admin/Gestor com escopo viam. approval_request_items já tinha essa
-- cláusula certa (migration 2), só approval_requests ficou quebrada.
-- ============================================================================

drop policy if exists scoped_select on approval_requests;
create policy scoped_select on approval_requests for select using (
  requester_id = auth.uid()
  or fn_is_admin(auth.uid())
  or (fn_has_role(auth.uid(), 'gestor') and fn_has_scope(auth.uid(), regional_id, area_id))
);
