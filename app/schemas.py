from __future__ import annotations

from datetime import datetime
from typing import Optional

from pydantic import BaseModel

from app.models import JobStatus


class JobBase(BaseModel):
    id: int
    group_alias: str
    group_id: str
    text: str
    run_at: datetime
    status: JobStatus
    last_error: Optional[str] = None

    class Config:
        from_attributes = True


class JobListResponse(BaseModel):
    jobs: list[JobBase]


class GroupRead(BaseModel):
    alias: str
    group_id: str
    group_name: Optional[str] = None

    class Config:
        from_attributes = True
