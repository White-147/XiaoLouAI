from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import get_session
from app.models import Project
from app.schemas import ProjectCreate, ProjectRead

router = APIRouter(prefix="/api/projects", tags=["projects"])


@router.get("", response_model=list[ProjectRead])
async def list_projects(session: AsyncSession = Depends(get_session)) -> list[Project]:
    result = await session.scalars(select(Project).order_by(Project.created_at.desc()).limit(100))
    return list(result)


@router.post("", response_model=ProjectRead, status_code=status.HTTP_201_CREATED)
async def create_project(
    payload: ProjectCreate,
    session: AsyncSession = Depends(get_session),
) -> Project:
    project = Project(owner_id=payload.owner_id, title=payload.title, payload=payload.payload)
    session.add(project)
    await session.commit()
    await session.refresh(project)
    return project


def _uuid_or_none(value: str) -> UUID | None:
    try:
        return UUID(value)
    except ValueError:
        return None


@router.get("/{project_id}", response_model=ProjectRead)
async def get_project(project_id: str, session: AsyncSession = Depends(get_session)) -> Project:
    parsed_id = _uuid_or_none(project_id)
    conditions = [Project.legacy_id == project_id]
    if parsed_id:
        conditions.append(Project.id == parsed_id)
    project = await session.scalar(select(Project).where(or_(*conditions)).limit(1))
    if not project:
        raise HTTPException(status_code=404, detail="project not found")
    return project
