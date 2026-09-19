#!/usr/bin/env python3
"""
Provisionamento de usuários (doc. 05, tela "Usuários") — cria a conta de
login no Supabase Auth e já vincula perfil (Administrador/Gestor/Usuário)
e escopo (Regional/Área), a partir de um CSV.

A carga inicial (import_planilha.py) trouxe Áreas/Metas/Indicadores, mas
não cria contas de usuário — é um passo à parte, feito aqui ou pela tela
de Usuários (ainda não construída).

CSV esperado (cabeçalho obrigatório, nessa ordem ou por nome de coluna):
  nome, email, senha_temporaria, cargo, perfil, escopo_regional, escopo_area

  perfil: administrador | gestor | usuario
  escopo_regional: nome exato de uma Regional já cadastrada, ou vazio = Global
  escopo_area: nome exato de uma Área já cadastrada, ou vazio = Regional inteira
    (só faz sentido se escopo_regional também estiver preenchido)

Uso:
  export SUPABASE_URL="https://SEU-PROJETO.supabase.co"
  export SUPABASE_SERVICE_ROLE_KEY="..."   # nunca a anon key — Admin API exige a service role
  export DATABASE_URL="postgresql://..."
  python3 provision_users.py usuarios.csv --dry-run
  python3 provision_users.py usuarios.csv --commit
"""
import argparse
import csv
import os
import sys

import requests


def create_auth_user(supabase_url, service_role_key, email, password):
    """Cria o usuário no Supabase Auth via Admin API. Retorna o id (uuid)."""
    resp = requests.post(
        f"{supabase_url}/auth/v1/admin/users",
        headers={
            "apikey": service_role_key,
            "Authorization": f"Bearer {service_role_key}",
            "Content-Type": "application/json",
        },
        json={"email": email, "password": password, "email_confirm": True},
        timeout=30,
    )
    if resp.status_code >= 300:
        raise RuntimeError(f"Falha ao criar usuário no Auth ({resp.status_code}): {resp.text}")
    return resp.json()["id"]


def provision_db(cur, auth_user_id, row):
    """Provisiona os dados de aplicação (employees/users/user_roles/user_access)
    para um usuário cujo id já existe em auth.users. Assume que a transação
    (commit/rollback) é controlada por quem chama."""
    nome = row["nome"].strip()
    email = row["email"].strip()
    cargo = row.get("cargo", "").strip() or None
    perfil = row["perfil"].strip().lower()
    regional_nome = (row.get("escopo_regional") or "").strip()
    area_nome = (row.get("escopo_area") or "").strip()

    if perfil not in ("administrador", "gestor", "usuario"):
        raise ValueError(f"{nome}: perfil inválido {perfil!r} (use administrador/gestor/usuario)")
    if area_nome and not regional_nome:
        raise ValueError(f"{nome}: escopo_area preenchido sem escopo_regional — não faz sentido.")

    regional_id = None
    area_id = None
    if regional_nome:
        cur.execute("select id from regionals where name = %s", (regional_nome,))
        r = cur.fetchone()
        if not r:
            raise ValueError(f"{nome}: Regional {regional_nome!r} não encontrada.")
        regional_id = r[0]
    if area_nome:
        cur.execute("select id from areas where name = %s", (area_nome,))
        a = cur.fetchone()
        if not a:
            raise ValueError(f"{nome}: Área {area_nome!r} não encontrada.")
        area_id = a[0]

    # employee: reaproveita se já existe uma pessoa com esse nome (a carga
    # inicial não criou employees — só cita nomes soltos —, então na
    # prática isso quase sempre cria uma linha nova).
    cur.execute("select id from employees where name = %s", (nome,))
    existing = cur.fetchone()
    if existing:
        employee_id = existing[0]
    else:
        cur.execute(
            "insert into employees (name, email, cargo, area_id, regional_id) "
            "values (%s,%s,%s,%s,%s) returning id",
            (nome, email, cargo, area_id, regional_id))
        employee_id = cur.fetchone()[0]

    cur.execute(
        "insert into users (id, employee_id, email, status) values (%s,%s,%s,'ativo') "
        "on conflict (id) do update set employee_id=excluded.employee_id, email=excluded.email",
        (auth_user_id, employee_id, email))

    cur.execute("select id from roles where code = %s", (perfil,))
    role_row = cur.fetchone()
    if not role_row:
        raise ValueError(f"perfil {perfil!r} não existe na tabela roles — rode as migrations primeiro.")
    cur.execute(
        "insert into user_roles (user_id, role_id) values (%s,%s) on conflict do nothing",
        (auth_user_id, role_row[0]))

    if perfil in ("administrador",) and not regional_nome:
        pass  # administrador não depende de user_access (fn_is_admin já libera tudo)
    else:
        cur.execute(
            "insert into user_access (user_id, regional_id, area_id) values (%s,%s,%s)",
            (auth_user_id, regional_id, area_id))


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("csv_path")
    ap.add_argument("--commit", action="store_true", help="Cria de verdade. Sem isso, é sempre dry-run (só valida o CSV).")
    args = ap.parse_args()

    with open(args.csv_path, newline="", encoding="utf-8") as f:
        rows = list(csv.DictReader(f))

    required_cols = {"nome", "email", "senha_temporaria", "cargo", "perfil", "escopo_regional", "escopo_area"}
    missing_cols = required_cols - set(rows[0].keys()) if rows else required_cols
    if missing_cols:
        raise SystemExit(f"CSV sem as colunas obrigatórias: {sorted(missing_cols)}")

    emails = [r["email"].strip().lower() for r in rows]
    dupes = {e for e in emails if emails.count(e) > 1}
    if dupes:
        raise SystemExit(f"E-mails duplicados no CSV: {sorted(dupes)}")

    print(f"{len(rows)} usuário(s) no CSV.")
    for r in rows:
        print(f"  - {r['nome']} <{r['email']}> | perfil={r['perfil']} | "
              f"escopo={r['escopo_regional'] or 'GLOBAL'}/{r['escopo_area'] or '(regional inteira)'}")

    if not args.commit:
        print("\nDry-run — nenhuma conta foi criada. Rode com --commit para criar de verdade.")
        return

    supabase_url = os.environ.get("SUPABASE_URL")
    service_role_key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    database_url = os.environ.get("DATABASE_URL")
    if not (supabase_url and service_role_key and database_url):
        raise SystemExit("SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY e DATABASE_URL precisam estar definidas.")

    import psycopg2
    conn = psycopg2.connect(database_url)
    created = []
    try:
        for row in rows:
            auth_id = create_auth_user(supabase_url, service_role_key, row["email"].strip(), row["senha_temporaria"])
            created.append((row["email"], auth_id))
            with conn:
                with conn.cursor() as cur:
                    provision_db(cur, auth_id, row)
            print(f"OK — {row['nome']} <{row['email']}> criado.")
    except Exception:
        print("\nERRO — parou no meio da lista. Usuários já criados no Auth até aqui "
              "(não são desfeitos automaticamente, precisam ser removidos manualmente se for reiniciar):")
        for email, auth_id in created:
            print(f"  - {email} ({auth_id})")
        raise
    finally:
        conn.close()


if __name__ == "__main__":
    main()
