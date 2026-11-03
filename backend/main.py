import os
import logging
from contextlib import asynccontextmanager
from dotenv import load_dotenv

load_dotenv()

from fastapi import FastAPI
from fastapi.responses import JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from psycopg import Error as PsycopgError
from psycopg_pool import PoolTimeout
import routes_auth
import routes_admin
import routes_student
import routes_teacher


from db import pool, with_db_context



logger = logging.getLogger(__name__)

UNIQUE_MESSAGES = {
    "schools_name_key": "A school with this name already exists.",
    "classes_name_key": "A class with this name already exists.",
    "classes_pkey": "A class with this id already exists.",
    "platform_admins_username_key": "This admin username is taken.",
    "uq_subscriptions_school_class": "This school already has a subscription for that class.",
    "uq_teachers_school_username": "This username is already used by another teacher in this school.",
    "uq_teachers_school_class": "This class already has a teacher.",
    "uq_students_school_reg_num": "A student with this registration number already exists in this school.",
}

CHECK_MESSAGES = {
    "chk_subscriptions_date_range": "end_date must be on or after start_date.",
    "chk_subscriptions_total_seats": "total_seats must be greater than 0.",
    "chk_videos_duration": "Video duration must be greater than 0.",
    "chk_videos_completion_threshold": "Completion threshold must be between 1 and 100.",
}

@asynccontextmanager
async def lifespan(app: FastAPI):
    pool.open()
    yield
    pool.close()

app = FastAPI(lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[o.strip() for o in os.environ.get("CORS_ORIGINS", "").split(",") if o.strip()],
    allow_origin_regex=r"https://.*\.vercel\.app",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.exception_handler(PsycopgError)
async def psycopg_error_handler(request, exc: PsycopgError):
    if isinstance(exc, PoolTimeout):
        return JSONResponse(status_code=503, content={"detail": "Server busy, try again."})
        
    state = getattr(exc, "sqlstate", None)
    constraint = exc.diag.constraint_name if getattr(exc, "diag", None) else None

    if state == "23505":
        return JSONResponse(status_code=409, content={"detail": UNIQUE_MESSAGES.get(constraint, "Duplicate value")})
    if state == "23503":
        return JSONResponse(status_code=409, content={"detail": "This record is linked to other data, or its subscription does not exist."})
    if state == "23514":
        return JSONResponse(status_code=422, content={"detail": CHECK_MESSAGES.get(constraint, "Invalid value")})
    if state == "42501":
        logger.critical(f"Permission error: {exc}")
        return JSONResponse(status_code=500, content={"detail": "Internal server error."})
        
    logger.exception("Database error")
    return JSONResponse(status_code=500, content={"detail": "Internal server error."})

app.include_router(routes_auth.router)
app.include_router(routes_admin.router)
app.include_router(routes_student.router)
app.include_router(routes_teacher.router)
