from __future__ import annotations

import os
import sqlite3
from datetime import date
from typing import Any, Dict, List, Optional, Tuple


DB_PATH = os.getenv("CERT_DB_PATH", "/app/data/cert_registry.db")


MODULE_CERTIFICATION = "Модуль Сертификации"
MODULES = [MODULE_CERTIFICATION]


def _connect() -> sqlite3.Connection:
    os.makedirs(os.path.dirname(DB_PATH), exist_ok=True)
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def _table_columns(conn: sqlite3.Connection, table: str) -> List[str]:
    rows = conn.execute(f"PRAGMA table_info({table})").fetchall()
    return [str(r[1]) for r in rows]


def _ensure_column(conn: sqlite3.Connection, table: str, col: str, ddl: str) -> None:
    cols = _table_columns(conn, table)
    if col in cols:
        return
    conn.execute(f"ALTER TABLE {table} ADD COLUMN {col} {ddl}")


def init_db() -> None:
    """Создаёт БД и выполняет простую миграцию схемы."""
    with _connect() as conn:
        # --- certificates ---
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS certificates (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                owner_id INTEGER NOT NULL,
                name TEXT NOT NULL,
                issued_at TEXT NOT NULL,
                expires_at TEXT NOT NULL,
                created_at TEXT NOT NULL DEFAULT (datetime('now'))
            )
            """
        )

        # Новые поля (эволюция схемы)
        _ensure_column(conn, "certificates", "cert_type", "TEXT NOT NULL DEFAULT 'external'")
        _ensure_column(conn, "certificates", "topic", "TEXT")
        _ensure_column(conn, "certificates", "workflow_status", "TEXT NOT NULL DEFAULT 'active'")
        _ensure_column(conn, "certificates", "required_examiner_id", "INTEGER")
        _ensure_column(conn, "certificates", "required_examiner_name", "TEXT")
        _ensure_column(conn, "certificates", "exam_grade", "TEXT")
        _ensure_column(conn, "certificates", "exam_date", "TEXT")
        _ensure_column(conn, "certificates", "snapshot_full_name", "TEXT")
        _ensure_column(conn, "certificates", "snapshot_position", "TEXT")
        _ensure_column(conn, "certificates", "snapshot_module", "TEXT")
        _ensure_column(conn, "certificates", "snapshot_manager_id", "INTEGER")
        _ensure_column(conn, "certificates", "snapshot_manager_name", "TEXT")

        # HR: отзыв сертификата
        _ensure_column(conn, "certificates", "revoked_by_id", "INTEGER")
        _ensure_column(conn, "certificates", "revoked_by_name", "TEXT")
        _ensure_column(conn, "certificates", "revoked_reason", "TEXT")
        _ensure_column(conn, "certificates", "revoked_at", "TEXT")

        # --- user_profiles ---
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS user_profiles (
                user_id INTEGER PRIMARY KEY,
                full_name TEXT NOT NULL,
                position TEXT NOT NULL,
                module TEXT NOT NULL,
                manager_id INTEGER,
                controlled_module TEXT
            )
            """
        )

        # Seed профилей для предопределённых пользователей (если их ещё нет)
        from .users import USERS, ROLE_LABELS

        existing = conn.execute("SELECT user_id FROM user_profiles").fetchall()
        existing_ids = {int(r[0]) for r in existing}
        for u in USERS:
            if u.id in existing_ids:
                continue
            # по умолчанию должность = подпись роли
            position = ROLE_LABELS.get(u.role, u.role)
            controlled_module = MODULE_CERTIFICATION if u.role == "hr" else None
            conn.execute(
                """
                INSERT INTO user_profiles (user_id, full_name, position, module, manager_id, controlled_module)
                VALUES (?, ?, ?, ?, ?, ?)
                """,
                (
                    u.id,
                    u.full_name,
                    position,
                    MODULE_CERTIFICATION,
                    u.manager_id,
                    controlled_module,
                ),
            )

        conn.commit()


# -------------------------
# Profiles
# -------------------------


def get_user_profile(user_id: int) -> Optional[Dict[str, Any]]:
    with _connect() as conn:
        row = conn.execute(
            "SELECT user_id, full_name, position, module, manager_id, controlled_module FROM user_profiles WHERE user_id = ?",
            (int(user_id),),
        ).fetchone()
    return dict(row) if row else None


def list_user_profiles() -> List[Dict[str, Any]]:
    with _connect() as conn:
        rows = conn.execute(
            "SELECT user_id, full_name, position, module, manager_id, controlled_module FROM user_profiles"
        ).fetchall()
    return [dict(r) for r in rows]


def upsert_user_profile(
    user_id: int,
    full_name: str,
    position: str,
    module: str,
    manager_id: Optional[int],
    controlled_module: Optional[str],
) -> None:
    with _connect() as conn:
        conn.execute(
            """
            INSERT INTO user_profiles (user_id, full_name, position, module, manager_id, controlled_module)
            VALUES (?, ?, ?, ?, ?, ?)
            ON CONFLICT(user_id) DO UPDATE SET
                full_name = excluded.full_name,
                position = excluded.position,
                module = excluded.module,
                manager_id = excluded.manager_id,
                controlled_module = excluded.controlled_module
            """,
            (
                int(user_id),
                full_name,
                position,
                module,
                int(manager_id) if manager_id is not None else None,
                controlled_module,
            ),
        )
        conn.commit()


# -------------------------
# Certificates
# -------------------------


_CERT_SELECT = """
    SELECT
        id, owner_id, name, cert_type, topic,
        issued_at, expires_at, created_at,
        workflow_status, required_examiner_id, required_examiner_name,
        exam_grade, exam_date,
        snapshot_full_name, snapshot_position, snapshot_module,
        snapshot_manager_id, snapshot_manager_name,
        revoked_by_id, revoked_by_name, revoked_reason, revoked_at
    FROM certificates
"""


def get_certificate(cert_id: int) -> Optional[Dict[str, Any]]:
    with _connect() as conn:
        row = conn.execute(_CERT_SELECT + "\n            WHERE id = ?\n            ", (int(cert_id),)).fetchone()
    return dict(row) if row else None


def list_certificates(owner_id: int) -> List[Dict[str, Any]]:
    with _connect() as conn:
        rows = conn.execute(
            _CERT_SELECT
            + """
            WHERE owner_id = ?
            ORDER BY id DESC
            """,
            (int(owner_id),),
        ).fetchall()
    return [dict(r) for r in rows]


def list_certificates_for_owners(owner_ids: List[int]) -> List[Dict[str, Any]]:
    """Сертификаты для набора сотрудников (для вкладки 'Сертификаты сотрудников')."""
    if not owner_ids:
        return []
    ids = [int(x) for x in owner_ids]
    placeholders = ",".join(["?"] * len(ids))
    with _connect() as conn:
        rows = conn.execute(
            _CERT_SELECT
            + f"""
            WHERE owner_id IN ({placeholders})
            ORDER BY id DESC
            """,
            ids,
        ).fetchall()
    return [dict(r) for r in rows]


def list_certificates_by_module(module: str) -> List[Dict[str, Any]]:
    """Сертификаты в модуле (HR)."""
    with _connect() as conn:
        rows = conn.execute(
            _CERT_SELECT
            + """
            WHERE COALESCE(snapshot_module, ?) = ?
            ORDER BY id DESC
            """,
            (module, module),
        ).fetchall()
    return [dict(r) for r in rows]


def list_exam_requests(examiner_id: int) -> List[Dict[str, Any]]:
    """Сертификаты, которые нужно принять (экзаменатор = текущий пользователь)."""
    with _connect() as conn:
        rows = conn.execute(
            _CERT_SELECT
            + """
            WHERE required_examiner_id = ?
              AND cert_type = 'internal'
              AND workflow_status = 'pending_exam'
            ORDER BY id DESC
            """,
            (int(examiner_id),),
        ).fetchall()
    return [dict(r) for r in rows]


def add_certificate(
    *,
    owner_id: int,
    name: str,
    issued_at: str,
    expires_at: str,
    cert_type: str,
    topic: Optional[str],
    workflow_status: str,
    required_examiner_id: Optional[int],
    required_examiner_name: Optional[str],
    snapshot_full_name: Optional[str],
    snapshot_position: Optional[str],
    snapshot_module: Optional[str],
    snapshot_manager_id: Optional[int],
    snapshot_manager_name: Optional[str],
) -> Dict[str, Any]:
    with _connect() as conn:
        cur = conn.execute(
            """
            INSERT INTO certificates (
                owner_id, name, issued_at, expires_at,
                cert_type, topic, workflow_status,
                required_examiner_id, required_examiner_name,
                snapshot_full_name, snapshot_position, snapshot_module,
                snapshot_manager_id, snapshot_manager_name
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                int(owner_id),
                name,
                issued_at,
                expires_at,
                cert_type,
                topic,
                workflow_status,
                int(required_examiner_id) if required_examiner_id is not None else None,
                required_examiner_name,
                snapshot_full_name,
                snapshot_position,
                snapshot_module,
                int(snapshot_manager_id) if snapshot_manager_id is not None else None,
                snapshot_manager_name,
            ),
        )
        cert_id = int(cur.lastrowid)
        row = conn.execute("SELECT * FROM certificates WHERE id = ?", (cert_id,)).fetchone()
        conn.commit()
    return dict(row) if row else {"id": cert_id}


def set_exam_result(
    *,
    cert_id: int,
    examiner_id: int,
    exam_grade: str,
    exam_date: str,
    workflow_status: str = "passed",
) -> Dict[str, Any]:
    """Проставить оценку и дату сдачи. Доступно только назначенному экзаменатору."""
    with _connect() as conn:
        row = conn.execute("SELECT * FROM certificates WHERE id = ?", (int(cert_id),)).fetchone()
        if not row:
            raise ValueError("certificate_not_found")
        cert = dict(row)

        if cert.get("workflow_status") == "revoked":
            raise PermissionError("revoked")

        if cert.get("required_examiner_id") is None or int(cert.get("required_examiner_id")) != int(examiner_id):
            raise PermissionError("not_examiner")

        wf = str(workflow_status or "passed").strip().lower()
        if wf not in ("passed", "failed"):
            wf = "passed"

        conn.execute(
            """
            UPDATE certificates
            SET exam_grade = ?, exam_date = ?, workflow_status = ?
            WHERE id = ?
            """,
            (exam_grade, exam_date, wf, int(cert_id)),
        )
        row2 = conn.execute("SELECT * FROM certificates WHERE id = ?", (int(cert_id),)).fetchone()
        conn.commit()
    return dict(row2) if row2 else cert


def revoke_certificate(
    *,
    cert_id: int,
    hr_id: int,
    hr_name: str,
    reason: str,
    allowed_module: Optional[str],
) -> Dict[str, Any]:
    """Отозвать сертификат (только HR)."""
    with _connect() as conn:
        row = conn.execute("SELECT * FROM certificates WHERE id = ?", (int(cert_id),)).fetchone()
        if not row:
            raise ValueError("certificate_not_found")
        cert = dict(row)

        # Ограничение по подконтрольному модулю (если задано)
        if allowed_module:
            cert_module = cert.get("snapshot_module") or MODULE_CERTIFICATION
            if cert_module != allowed_module:
                raise PermissionError("module_mismatch")

        conn.execute(
            """
            UPDATE certificates
            SET workflow_status = 'revoked',
                revoked_by_id = ?,
                revoked_by_name = ?,
                revoked_reason = ?,
                revoked_at = datetime('now')
            WHERE id = ?
            """,
            (int(hr_id), hr_name, reason, int(cert_id)),
        )
        row2 = conn.execute("SELECT * FROM certificates WHERE id = ?", (int(cert_id),)).fetchone()
        conn.commit()
    return dict(row2) if row2 else cert


def unrevoke_certificate(
    *,
    cert_id: int,
    hr_id: int,
    allowed_module: Optional[str],
) -> Dict[str, Any]:
    """Снять отзыв сертификата (только HR).

    В прототипе восстанавливаем статус по данным сертификата:
    - internal: если есть exam_grade -> passed/failed; иначе pending_exam
    - external: active
    """
    with _connect() as conn:
        row = conn.execute("SELECT * FROM certificates WHERE id = ?", (int(cert_id),)).fetchone()
        if not row:
            raise ValueError("certificate_not_found")
        cert = dict(row)

        if cert.get("workflow_status") != 'revoked':
            # нечего снимать — просто возвращаем
            return cert

        # Ограничение по подконтрольному модулю (если задано)
        if allowed_module:
            cert_module = cert.get("snapshot_module") or MODULE_CERTIFICATION
            if cert_module != allowed_module:
                raise PermissionError("module_mismatch")

        new_status = 'active'
        if str(cert.get('cert_type') or '') == 'internal':
            if cert.get('exam_grade'):
                new_status = 'failed' if str(cert.get('exam_grade')) == 'Не сдан' else 'passed'
            else:
                # если есть экзаменатор — значит ожидание экзамена
                new_status = 'pending_exam' if cert.get('required_examiner_id') else 'active'

        conn.execute(
            """
            UPDATE certificates
            SET workflow_status = ?,
                revoked_by_id = NULL,
                revoked_by_name = NULL,
                revoked_reason = NULL,
                revoked_at = NULL
            WHERE id = ?
            """,
            (new_status, int(cert_id)),
        )
        row2 = conn.execute("SELECT * FROM certificates WHERE id = ?", (int(cert_id),)).fetchone()
        conn.commit()
    return dict(row2) if row2 else cert




def update_certificate(
    *,
    cert_id: int,
    name: str,
    issued_at: str,
    expires_at: str,
    topic: Optional[str],
    allowed_module: Optional[str],
) -> Dict[str, Any]:
    """Редактировать сертификат (для HR).

    Ограничиваем редактирование подконтрольным модулем, если он задан.
    """
    with _connect() as conn:
        row = conn.execute('SELECT * FROM certificates WHERE id = ?', (int(cert_id),)).fetchone()
        if not row:
            raise ValueError('certificate_not_found')
        cert = dict(row)

        if allowed_module:
            cert_module = cert.get('snapshot_module') or MODULE_CERTIFICATION
            if cert_module != allowed_module:
                raise PermissionError('module_mismatch')

        cert_type = str(cert.get('cert_type') or 'external')
        if cert_type != 'internal':
            topic = None

        conn.execute(
            """
            UPDATE certificates
            SET name = ?, issued_at = ?, expires_at = ?, topic = ?
            WHERE id = ?
            """,
            (name, issued_at, expires_at, topic, int(cert_id)),
        )
        row2 = conn.execute('SELECT * FROM certificates WHERE id = ?', (int(cert_id),)).fetchone()
        conn.commit()
    return dict(row2) if row2 else cert


def delete_certificate(*, cert_id: int, allowed_module: Optional[str]) -> None:
    """Удалить сертификат (для HR).

    Ограничиваем удаление подконтрольным модулем, если он задан.
    Удаление необратимо (для прототипа делаем физическое удаление).
    """
    with _connect() as conn:
        row = conn.execute("SELECT * FROM certificates WHERE id = ?", (int(cert_id),)).fetchone()
        if not row:
            raise ValueError("certificate_not_found")
        cert = dict(row)

        if allowed_module:
            cert_module = cert.get("snapshot_module") or MODULE_CERTIFICATION
            if cert_module != allowed_module:
                raise PermissionError("module_mismatch")

        conn.execute("DELETE FROM certificates WHERE id = ?", (int(cert_id),))
        conn.commit()


def compute_status(expires_at: str) -> Tuple[str, str]:
    """Возвращает (status_code, label) на основе даты окончания.

    Пустая дата окончания = сертификат бессрочный (считаем действительным).
    """
    expires_at = str(expires_at or '').strip()
    if not expires_at:
        return 'valid', 'Действителен'

    try:
        y, m, d = [int(x) for x in expires_at.split('-')]
        exp = date(y, m, d)
        if exp >= date.today():
            return 'valid', 'Действителен'
        return 'expired', 'Просрочен'
    except Exception:
        return 'unknown', 'Неизвестно'
