from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Dict, List, Optional


ROLE_JUNIOR = "junior"
ROLE_SPECIALIST = "specialist"
ROLE_LEAD = "lead"
ROLE_CHIEF = "chief"
ROLE_HR = "hr"


ROLE_LABELS = {
    ROLE_JUNIOR: "Младший специалист",
    ROLE_SPECIALIST: "Специалист",
    ROLE_LEAD: "Ведущий специалист",
    ROLE_CHIEF: "Главный специалист",
    ROLE_HR: "Курирующий HR",
}


@dataclass(frozen=True)
class User:
    id: int
    full_name: str
    role: str
    manager_id: Optional[int] = None

    @property
    def role_label(self) -> str:
        return ROLE_LABELS.get(self.role, self.role)

    @property
    def initials(self) -> str:
        # Обычно на аватаре показывают «Имя+Отчество». Если отчества нет — «Имя+Фамилия».
        parts = [p for p in self.full_name.split() if p.strip()]
        if len(parts) >= 3:
            name, patronymic = parts[1], parts[2]
            return (name[:1] + patronymic[:1]).upper()
        if len(parts) >= 2:
            return (parts[0][:1] + parts[1][:1]).upper()
        return (parts[0][:2] if parts else "??").upper()


@dataclass(frozen=True)
class DisplayUser:
    """Пользователь с данными профиля (для отображения в UI)."""

    id: int
    full_name: str
    role: str
    manager_id: Optional[int] = None
    position: str = ""
    module: str = ""
    controlled_module: Optional[str] = None

    @property
    def role_label(self) -> str:
        return ROLE_LABELS.get(self.role, self.role)

    @property
    def initials(self) -> str:
        parts = [p for p in self.full_name.split() if p.strip()]
        if len(parts) >= 3:
            name, patronymic = parts[1], parts[2]
            return (name[:1] + patronymic[:1]).upper()
        if len(parts) >= 2:
            return (parts[0][:1] + parts[1][:1]).upper()
        return (parts[0][:2] if parts else "??").upper()


def make_display_user(base: User, profile: Optional[Dict[str, Any]]) -> DisplayUser:
    """Склеить статического пользователя и профиль из БД."""
    if profile is None:
        return DisplayUser(
            id=base.id,
            full_name=base.full_name,
            role=base.role,
            manager_id=base.manager_id,
            position=base.role_label,
            module="",
            controlled_module=None,
        )
    return DisplayUser(
        id=base.id,
        full_name=str(profile.get("full_name") or base.full_name),
        role=base.role,
        manager_id=profile.get("manager_id") if profile.get("manager_id") is not None else base.manager_id,
        position=str(profile.get("position") or base.role_label),
        module=str(profile.get("module") or ""),
        controlled_module=profile.get("controlled_module"),
    )


# --- Предопределённые пользователи + иерархия ---
#
# Правило:
# - младшие специалисты -> подчиняются специалистам
# - специалисты -> ведущим специалистам
# - ведущие -> главному специалисту
# - HR пока отдельно


USERS: List[User] = [
    # Главный специалист
    User(id=1, full_name="Алексеев Денис Романович", role=ROLE_CHIEF, manager_id=None),

    # Ведущие специалисты
    User(id=2, full_name="Васильев Михаил Андреевич", role=ROLE_LEAD, manager_id=1),
    User(id=3, full_name="Громова Ирина Валерьевна", role=ROLE_LEAD, manager_id=1),

    # Специалисты
    User(id=10, full_name="Петров Александр Николаевич", role=ROLE_SPECIALIST, manager_id=2),
    User(id=11, full_name="Николаева Ольга Владимировна", role=ROLE_SPECIALIST, manager_id=2),
    User(id=12, full_name="Орлов Кирилл Евгеньевич", role=ROLE_SPECIALIST, manager_id=3),
    User(id=13, full_name="Захарова Татьяна Сергеевна", role=ROLE_SPECIALIST, manager_id=3),

    # Младшие специалисты
    User(id=20, full_name="Иванов Иван Сергеевич", role=ROLE_JUNIOR, manager_id=10),
    User(id=21, full_name="Кузнецова Анна Дмитриевна", role=ROLE_JUNIOR, manager_id=10),

    User(id=22, full_name="Смирнов Артём Павлович", role=ROLE_JUNIOR, manager_id=11),
    User(id=23, full_name="Попова Екатерина Андреевна", role=ROLE_JUNIOR, manager_id=11),

    User(id=24, full_name="Волков Максим Олегович", role=ROLE_JUNIOR, manager_id=12),
    User(id=25, full_name="Морозова Мария Ильинична", role=ROLE_JUNIOR, manager_id=12),

    User(id=26, full_name="Фёдоров Даниил Викторович", role=ROLE_JUNIOR, manager_id=13),
    User(id=27, full_name="Соколова Полина Михайловна", role=ROLE_JUNIOR, manager_id=13),

    # Курирующий HR (функционал позже)
    User(id=100, full_name="Беляева Наталья Константиновна", role=ROLE_HR, manager_id=None),
]

USERS_BY_ID: Dict[int, User] = {u.id: u for u in USERS}


def get_user(user_id: int) -> Optional[User]:
    return USERS_BY_ID.get(int(user_id))


def group_users_for_login() -> List[tuple[str, List[User]]]:
    """Для login.html: сгруппировать по ролям в порядке иерархии."""
    order = [ROLE_CHIEF, ROLE_LEAD, ROLE_SPECIALIST, ROLE_JUNIOR, ROLE_HR]
    grouped: List[tuple[str, List[User]]] = []
    for role in order:
        items = [u for u in USERS if u.role == role]
        if items:
            grouped.append((ROLE_LABELS.get(role, role), items))
    return grouped


def subordinates_of(manager_id: int) -> List[User]:
    return [u for u in USERS if u.manager_id == manager_id]
