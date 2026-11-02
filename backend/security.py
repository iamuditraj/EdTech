import os
import time
import threading
from datetime import datetime, timezone, timedelta

import bcrypt
import jwt
from fastapi import HTTPException, Depends
from fastapi.security import HTTPBearer

JWT_SECRET = os.environ["JWT_SECRET"]

# --- Passwords & Tokens ---

def hash_password(p: str) -> str:
    return bcrypt.hashpw(p.encode(), bcrypt.gensalt()).decode()

def verify_password(p: str, h: str) -> bool:
    return bcrypt.checkpw(p.encode(), h.encode())

def create_token(claims: dict) -> str:
    payload = {**claims, "exp": datetime.now(timezone.utc) + timedelta(hours=24)}
    return jwt.encode(payload, JWT_SECRET, algorithm="HS256")

def require_role(role: str):
    def dep(creds = Depends(HTTPBearer())):
        try:
            data = jwt.decode(creds.credentials, JWT_SECRET, algorithms=["HS256"], options={"require": ["exp"]})
        except jwt.PyJWTError:
            raise HTTPException(401, "Invalid or expired token")
        if data.get("role") != role:
            raise HTTPException(403, "Not allowed")
        return data
    return dep

# --- Rate Limiter ---

_attempts = {}
_lock = threading.Lock()
MAX_FAILS, WINDOW = 5, 300

def check_rate_limit(key: str):
    now = time.time()
    with _lock:
        fails = [t for t in _attempts.get(key, []) if now - t < WINDOW]
        if fails:
            _attempts[key] = fails
        else:
            _attempts.pop(key, None)
            
        if len(fails) >= MAX_FAILS:
            raise HTTPException(429, "Too many attempts. Please wait a few minutes and try again.")

def record_failure(key: str):
    with _lock:
        if len(_attempts) > 5000:
            _attempts.clear()
        _attempts.setdefault(key, []).append(time.time())

def clear_failures(key: str):
    with _lock:
        _attempts.pop(key, None)