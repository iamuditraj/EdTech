import os
from contextlib import contextmanager
from psycopg.rows import dict_row
from psycopg_pool import ConnectionPool

pool = ConnectionPool(os.environ["DATABASE_URL"], min_size=2, max_size=10, timeout=10, open=False)

ALLOWED_ROLES = {"auth_role", "admin_role", "teacher_role", "student_role"}

@contextmanager
def with_db_context(role: str, user: dict | None = None):
    if role not in ALLOWED_ROLES:
        raise ValueError(f"Unknown role: {role}")
        
    with pool.connection() as conn, conn.transaction(), conn.cursor(row_factory=dict_row) as cur:
        cur.execute(f"SET LOCAL ROLE {role}")
        
        if role in ("teacher_role", "student_role"):
            cur.execute(
                """
                SELECT set_config('app.user_id', %s, true),
                       set_config('app.school_id', %s, true),
                       set_config('app.class_id', %s, true)
                """,
                (str(user["user_id"]), str(user["school_id"]), str(user["class_id"]))
            )
            
        yield cur