-- ============================================================================
-- 0012_security_hardening_fix.sql
-- Sistema de Gestão de Metas — V1
-- Migration 12/N: a migration 11 revogou de `anon`/`authenticated`
-- especificamente, mas o Postgres concede EXECUTE a `PUBLIC` por padrão na
-- criação da função — um grant a `PUBLIC` inclui `anon` e `authenticated`
-- de qualquer jeito, então a 11 não teve efeito nenhum (confirmado rodando
-- o advisor de novo depois: os mesmos 11 achados continuaram lá).
-- Correção: revoga de PUBLIC explicitamente, e concede de volta só pra
-- `authenticated` nas funções que realmente precisam ser chamáveis (pela
-- RLS ou como RPC do frontend).
-- ============================================================================

revoke execute on function fn_has_role(uuid, text) from public;
grant execute on function fn_has_role(uuid, text) to authenticated;

revoke execute on function fn_is_admin(uuid) from public;
grant execute on function fn_is_admin(uuid) to authenticated;

revoke execute on function fn_has_permission(uuid, text) from public;
grant execute on function fn_has_permission(uuid, text) to authenticated;

revoke execute on function fn_has_scope(uuid, uuid, uuid) from public;
grant execute on function fn_has_scope(uuid, uuid, uuid) to authenticated;

revoke execute on function fn_calc_attainment(uuid, numeric, numeric) from public;
grant execute on function fn_calc_attainment(uuid, numeric, numeric) to authenticated;

revoke execute on function fn_can_approve(uuid) from public;
grant execute on function fn_can_approve(uuid) to authenticated;

revoke execute on function create_approval_request(text, uuid, uuid, uuid, uuid, text, jsonb) from public;
grant execute on function create_approval_request(text, uuid, uuid, uuid, uuid, text, jsonb) to authenticated;

revoke execute on function approve_request(uuid, text) from public;
grant execute on function approve_request(uuid, text) to authenticated;

revoke execute on function reject_request(uuid, text) from public;
grant execute on function reject_request(uuid, text) to authenticated;

-- Puramente internas — nenhuma policy de RLS nem o frontend chamam estas
-- direto; só outras funções SECURITY DEFINER chamam (e essa chamada roda
-- com o privilégio do DONO da função, não de quem originalmente entrou,
-- então continuam funcionando mesmo sem grant nenhum pra anon/authenticated).
revoke execute on function fn_gestor_scope_level(uuid, uuid, uuid) from public;
revoke execute on function fn_is_eligible_approver(uuid, uuid) from public;
revoke execute on function fn_notify_eligible_approvers(uuid) from public;
