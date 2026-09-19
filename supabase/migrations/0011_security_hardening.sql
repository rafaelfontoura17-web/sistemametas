-- ============================================================================
-- 0011_security_hardening.sql
-- Sistema de Gestão de Metas — V1
-- Migration 11/N: corrige os avisos do linter de segurança do Supabase
-- (get_advisors) rodados após aplicar as migrations 1-10 no projeto real.
--
-- Dois achados:
-- 1. 5 funções sem `search_path` fixo — risco de sequestro via search_path
--    mutável. Corrigido com ALTER FUNCTION, sem tocar no corpo.
-- 2. 11 funções SECURITY DEFINER executáveis por `anon` (usuário não
--    logado) — não há NENHUM caso de uso anônimo neste sistema, então
--    revoga de anon em todas. Pra `authenticated`, só revoga das que
--    NUNCA são chamadas diretamente por RLS nem pelo cliente via RPC —
--    são só "miolo" usado por outras funções SECURITY DEFINER (que
--    continuam funcionando porque a chamada interna roda com o
--    privilégio do dono da função, não de quem originalmente chamou).
--    As que a RLS usa direto nas policies (fn_is_admin, fn_has_role,
--    fn_has_permission, fn_has_scope) e as que são endpoint de verdade
--    pro frontend (fn_can_approve, create_approval_request,
--    approve_request, reject_request) continuam liberadas pra
--    `authenticated`, senão a RLS inteira quebra.
-- ============================================================================

-- 1. search_path fixo
alter function set_updated_at() set search_path = public;
alter function fn_check_goal_area_regional() set search_path = public;
alter function fn_check_area_closure() set search_path = public;
alter function fn_calc_attainment(uuid, numeric, numeric) set search_path = public;
alter function fn_apply_goal_result() set search_path = public;

-- 2a. anon nunca precisa executar nenhuma função de negócio deste sistema.
revoke execute on function fn_has_role(uuid, text) from anon;
revoke execute on function fn_is_admin(uuid) from anon;
revoke execute on function fn_has_permission(uuid, text) from anon;
revoke execute on function fn_has_scope(uuid, uuid, uuid) from anon;
revoke execute on function fn_calc_attainment(uuid, numeric, numeric) from anon;
revoke execute on function fn_gestor_scope_level(uuid, uuid, uuid) from anon;
revoke execute on function fn_is_eligible_approver(uuid, uuid) from anon;
revoke execute on function fn_can_approve(uuid) from anon;
revoke execute on function fn_notify_eligible_approvers(uuid) from anon;
revoke execute on function create_approval_request(text, uuid, uuid, uuid, uuid, text, jsonb) from anon;
revoke execute on function approve_request(uuid, text) from anon;
revoke execute on function reject_request(uuid, text) from anon;

-- 2b. authenticated: só revoga o que é puramente interno (nunca chamado
-- direto pela RLS nem pelo frontend via .rpc()).
revoke execute on function fn_gestor_scope_level(uuid, uuid, uuid) from authenticated;
revoke execute on function fn_is_eligible_approver(uuid, uuid) from authenticated;
revoke execute on function fn_notify_eligible_approvers(uuid) from authenticated;
