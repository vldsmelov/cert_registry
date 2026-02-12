from __future__ import annotations

from pathlib import Path

from typing import Any, Dict, Optional, List

from io import BytesIO
from xml.sax.saxutils import escape as xml_escape

import qrcode
import qrcode.image.svg

from reportlab.lib.pagesizes import A4
from reportlab.lib.colors import HexColor
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfgen import canvas

from fastapi import FastAPI, Form, Request, HTTPException
from fastapi.responses import HTMLResponse, JSONResponse, RedirectResponse, Response
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from starlette.middleware.sessions import SessionMiddleware

from .db import (
    MODULES,
    MODULE_CERTIFICATION,
    add_certificate,
    compute_status,
    get_certificate,
    get_user_profile,
    init_db,
    list_certificates,
    list_certificates_by_module,
    list_certificates_for_owners,
    list_exam_requests,
    list_user_profiles,
    revoke_certificate,
    unrevoke_certificate,
    set_exam_result,
    upsert_user_profile,
    update_certificate,
    delete_certificate,
)
from .users import USERS, USERS_BY_ID, DisplayUser, get_user, group_users_for_login, make_display_user


app = FastAPI(title="Реестр сертификатов")

# Cookie-based session
app.add_middleware(SessionMiddleware, secret_key="dev-secret-key-change-me")

BASE_DIR = Path(__file__).resolve().parent

templates = Jinja2Templates(directory=str(BASE_DIR / "templates"))
app.mount("/static", StaticFiles(directory=str(BASE_DIR / "static")), name="static")


@app.on_event("startup")
def _startup() -> None:
    init_db()


def current_user(request: Request) -> DisplayUser | None:
    uid = request.session.get("user_id")
    if uid is None:
        return None
    try:
        base = USERS_BY_ID.get(int(uid))
        if base is None:
            return None
        profile = get_user_profile(base.id)
        return make_display_user(base, profile)
    except Exception:
        return None


_PDF_FONTS_READY = False


def ensure_pdf_fonts() -> None:
    """Регистрирует шрифты с кириллицей для PDF (best-effort)."""
    global _PDF_FONTS_READY
    if _PDF_FONTS_READY:
        return

    font_pairs = [
        ("DejaVu", "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"),
        ("DejaVu-Bold", "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"),
    ]

    for name, fpath in font_pairs:
        try:
            if Path(fpath).exists():
                pdfmetrics.registerFont(TTFont(name, fpath))
        except Exception:
            pass

    _PDF_FONTS_READY = True


def can_view_certificate(user: DisplayUser, cert: Dict[str, Any]) -> bool:
    """Доступ к сертификату: владелец / руководитель / HR (по модулю)."""
    try:
        owner_id = int(cert.get("owner_id") or 0)
    except Exception:
        owner_id = 0

    if owner_id == int(user.id):
        return True

    if user.role == "hr":
        allowed = user.controlled_module or MODULE_CERTIFICATION
        cert_module = cert.get("snapshot_module") or MODULE_CERTIFICATION
        return cert_module == allowed

    return owner_id in descendant_user_ids(user.id)



def normalize_award(grade: Any) -> str | None:
    """Нормализует оценку/шаблон к одному из: gold/silver/bronze.

    В UI уровни называются: Light | Standart | Hard.
    Внутри оставляем стабильные коды (gold/silver/bronze) и поддерживаем
    совместимость со старыми значениями.
    """
    g = str(grade or "").strip().lower()
    if not g:
        return None
    # поддержка старых числовых оценок
    if g in ("5", "5.0"):
        return "gold"
    if g in ("4", "4.0"):
        return "silver"
    if g in ("3", "3.0", "2", "2.0"):
        return "bronze"

    # русские/англ варианты + новые уровни
    if "зол" in g or g == "gold" or "hard" in g:
        return "gold"
    if "сереб" in g or g == "silver" or g in ("standart", "standard") or "standart" in g or "standard" in g:
        return "silver"
    if "брон" in g or g == "bronze" or "light" in g:
        return "bronze"
    return None


def award_label(grade: Any) -> str | None:
    a = normalize_award(grade)
    if a == "gold":
        return "Hard"
    if a == "silver":
        return "Standart"
    if a == "bronze":
        return "Light"
    return None


def award_palette(cert: Dict[str, Any]) -> Dict[str, str]:
    """Цветовая палитра сертификата в зависимости от оценки."""
    # Если экзамен не сдан — выделяем красным (внутри системы)
    if cert.get("cert_type") == "internal" and cert.get("workflow_status") == "failed":
        return {
            "accent": "#d93025",
            "accent_light": "#FDECEA",
            "accent_border": "#F6B8B2",
            "accent_text": "#b3261e",
        }

    a = normalize_award(cert.get("exam_grade")) if cert.get("workflow_status") == "passed" else None
    if a == "gold":
        return {"accent": "#C9A227", "accent_light": "#FFF7D1", "accent_border": "#E2CD6A", "accent_text": "#8A6A00"}
    if a == "silver":
        return {"accent": "#7B8794", "accent_light": "#F0F3F7", "accent_border": "#C7D0DA", "accent_text": "#4A5562"}
    if a == "bronze":
        return {"accent": "#B87333", "accent_light": "#F6E6D7", "accent_border": "#D7A47A", "accent_text": "#7A3F10"}
    # default
    return {"accent": "#2157ff", "accent_light": "#EEF3FF", "accent_border": "#AFC3FF", "accent_text": "#2157ff"}


def public_status(cert: Dict[str, Any]) -> Dict[str, str]:
    """Статус для публичного просмотра (без авторизации).

    По требованиям публичная страница показывает только:
    - ДЕЙСТВИТЕЛЕН
    - НЕДЕЙСТВИТЕЛЕН

    Любые причины (отозван/просрочен/ожидает экзамен) скрываем.
    """

    # 1) Отозван HR
    if cert.get("workflow_status") == "revoked":
        return {"code": "invalid", "label": "Недействителен"}

    # 2) Просрочен по сроку
    status, _ = compute_status(str(cert.get("expires_at") or ""))
    if status == "expired":
        return {"code": "invalid", "label": "Недействителен"}

    # 3) Внутренний, но экзамен не сдан
    if cert.get("cert_type") == "internal" and cert.get("workflow_status") != "passed":
        return {"code": "invalid", "label": "Недействителен"}

    # 4) В остальных случаях считаем действительным
    return {"code": "valid", "label": "Действителен"}


def _wf_label(cert: Dict[str, Any]) -> str:
    if cert.get("workflow_status") == "revoked":
        return "ОТОЗВАН"
    if cert.get("cert_type") == "internal" and cert.get("workflow_status") == "pending_exam":
        return "ОЖИДАЕТ ЭКЗАМЕН"
    if cert.get("cert_type") == "internal" and cert.get("workflow_status") == "passed":
        return "ЭКЗАМЕН СДАН"
    if cert.get("cert_type") == "internal" and cert.get("workflow_status") == "failed":
        return "ЭКЗАМЕН НЕ СДАН"
    return "ДЕЙСТВИТЕЛЕН"


def certificate_svg(cert: Dict[str, Any]) -> str:
    """Генерирует SVG-картинку сертификата на лету."""
    cid = str(cert.get("id", ""))
    full_name = str(cert.get("snapshot_full_name") or "")
    position = str(cert.get("snapshot_position") or "")
    module = str(cert.get("snapshot_module") or MODULE_CERTIFICATION)
    name = str(cert.get("name") or "Сертификат")
    cert_type = "Внутренний" if cert.get("cert_type") == "internal" else "Внешний"
    topic = str(cert.get("topic") or "")
    issued = str(cert.get("issued_at") or "")
    expires = str(cert.get("expires_at") or "")
    expires_label = expires if str(expires).strip() else "Бессрочно"

    pal = award_palette(cert)
    accent = pal["accent"]
    accent_light = pal["accent_light"]
    accent_border = pal["accent_border"]
    accent_text = pal["accent_text"]

    wf = _wf_label(cert)
    extra = ""
    if cert.get("workflow_status") == "revoked":
        extra = f"HR: {cert.get('revoked_by_name') or '—'} • Причина: {cert.get('revoked_reason') or '—'}"
    elif cert.get("cert_type") == "internal" and cert.get("workflow_status") == "pending_exam":
        extra = f"Экзаменатор: {cert.get('required_examiner_name') or '—'}"
    elif cert.get("cert_type") == "internal" and cert.get("workflow_status") == "passed":
        g = award_label(cert.get("exam_grade")) or cert.get("exam_grade") or "—"
        d = cert.get("exam_date") or ""
        extra = f"Экзамен: {g} {('(' + d + ')') if d else ''}"
    elif cert.get("cert_type") == "internal" and cert.get("workflow_status") == "failed":
        d = cert.get("exam_date") or ""
        extra = f"Экзамен: не сдан {('(' + d + ')') if d else ''}"

    def x(s: str) -> str:
        return xml_escape(s or "")

    return f"""<?xml version='1.0' encoding='UTF-8'?>
<svg xmlns='http://www.w3.org/2000/svg' width='1200' height='800' viewBox='0 0 1200 800'>
  <defs>
    <linearGradient id='bg' x1='0' y1='0' x2='1' y2='1'>
      <stop offset='0%' stop-color='{x(accent_light)}'/>
      <stop offset='100%' stop-color='#ffffff'/>
    </linearGradient>
  </defs>
  <rect x='0' y='0' width='1200' height='800' fill='url(#bg)'/>
  <rect x='60' y='60' width='1080' height='680' rx='28' fill='#fff' stroke='rgba(0,0,0,0.12)' stroke-width='2'/>

  <text x='600' y='150' text-anchor='middle' font-size='56' font-family='Inter, Arial, sans-serif' font-weight='700'>СЕРТИФИКАТ</text>
  <text x='600' y='195' text-anchor='middle' font-size='20' font-family='Inter, Arial, sans-serif' fill='rgba(0,0,0,0.65)'>№ {x(cid)} • {x(module)}</text>

  <text x='600' y='285' text-anchor='middle' font-size='28' font-family='Inter, Arial, sans-serif' fill='rgba(0,0,0,0.65)'>Подтверждает, что</text>
  <text x='600' y='350' text-anchor='middle' font-size='44' font-family='Inter, Arial, sans-serif' font-weight='700'>{x(full_name)}</text>
  <text x='600' y='390' text-anchor='middle' font-size='22' font-family='Inter, Arial, sans-serif' fill='rgba(0,0,0,0.65)'>{x(position)}</text>

  <text x='600' y='470' text-anchor='middle' font-size='24' font-family='Inter, Arial, sans-serif'>{x(name)}</text>
  <text x='600' y='505' text-anchor='middle' font-size='18' font-family='Inter, Arial, sans-serif' fill='rgba(0,0,0,0.65)'>{x(cert_type)}{(' • ' + x(topic)) if topic else ''}</text>

  <text x='600' y='575' text-anchor='middle' font-size='18' font-family='Inter, Arial, sans-serif' fill='rgba(0,0,0,0.65)'>Выдан: {x(issued)} • Действителен до: {x(expires_label)}</text>

  <g>
    <rect x='440' y='610' width='320' height='44' rx='14' fill='{x(accent_light)}' stroke='{x(accent_border)}'/>
    <text x='600' y='640' text-anchor='middle' font-size='16' font-family='Inter, Arial, sans-serif' fill='{x(accent_text)}' font-weight='700'>{x(wf)}</text>
  </g>

  <text x='600' y='690' text-anchor='middle' font-size='14' font-family='Inter, Arial, sans-serif' fill='rgba(0,0,0,0.65)'>{x(extra)}</text>

  <line x1='240' y1='720' x2='560' y2='720' stroke='rgba(0,0,0,0.22)'/>
  <text x='400' y='748' text-anchor='middle' font-size='14' font-family='Inter, Arial, sans-serif' fill='rgba(0,0,0,0.55)'>Подпись / Печать</text>

  <line x1='640' y1='720' x2='960' y2='720' stroke='rgba(0,0,0,0.22)'/>
  <text x='800' y='748' text-anchor='middle' font-size='14' font-family='Inter, Arial, sans-serif' fill='rgba(0,0,0,0.55)'>Ответственный</text>
</svg>
"""


def certificate_pdf_bytes(cert: Dict[str, Any]) -> bytes:
    """Генерирует PDF сертификата на лету."""
    ensure_pdf_fonts()

    reg = set(pdfmetrics.getRegisteredFontNames())
    font = "DejaVu" if "DejaVu" in reg else "Helvetica"
    font_bold = "DejaVu-Bold" if "DejaVu-Bold" in reg else "Helvetica-Bold"

    buf = BytesIO()
    c = canvas.Canvas(buf, pagesize=A4)
    width, height = A4

    pal = award_palette(cert)
    accent = HexColor(pal["accent"])
    accent_light = HexColor(pal["accent_light"])

    # рамка + цветовой акцент (по оценке)
    c.setLineWidth(1)
    c.setStrokeColor(accent)
    c.roundRect(36, 36, width - 72, height - 72, 18, stroke=1, fill=0)

    # верхняя плашка-шаблон
    c.setFillColor(accent_light)
    c.roundRect(36, height - 140, width - 72, 70, 18, stroke=0, fill=1)
    c.setFillColor(HexColor('#000000'))

    c.setFont(font_bold, 26)
    c.drawCentredString(width / 2, height - 90, "СЕРТИФИКАТ")
    c.setFont(font, 12)
    c.drawCentredString(width / 2, height - 115, f"№ {cert.get('id', '')} • {cert.get('snapshot_module') or MODULE_CERTIFICATION}")

    y = height - 170

    lines = [
        ("ФИО", cert.get("snapshot_full_name") or ""),
        ("Должность", cert.get("snapshot_position") or ""),
        ("Название", cert.get("name") or ""),
        ("Тип", "Внутренний" if cert.get("cert_type") == "internal" else "Внешний"),
        ("Профиль", cert.get("topic") or "—"),
        ("Дата выдачи", cert.get("issued_at") or ""),
        ("Действителен до", cert.get("expires_at") or "Бессрочно"),
    ]

    if cert.get("cert_type") != "internal":
        lines[4] = ("Профиль", "—")

    for k, v in lines:
        c.setFont(font_bold, 12)
        c.drawString(70, y, f"{k}:")
        c.setFont(font, 12)
        c.drawString(190, y, str(v))
        y -= 18

    y -= 10

    c.setFont(font_bold, 12)
    c.drawString(70, y, "Статус:")
    c.setFont(font, 12)
    c.drawString(190, y, _wf_label(cert))
    y -= 18

    if cert.get("workflow_status") == "revoked":
        c.setFont(font_bold, 12)
        c.drawString(70, y, "Отозван:")
        c.setFont(font, 12)
        c.drawString(190, y, f"{cert.get('revoked_by_name') or '—'}")
        y -= 18

        c.setFont(font_bold, 12)
        c.drawString(70, y, "Причина:")
        c.setFont(font, 12)
        c.drawString(190, y, f"{cert.get('revoked_reason') or '—'}")
        y -= 18

    if cert.get("cert_type") == "internal" and cert.get("workflow_status") == "pending_exam":
        c.setFont(font_bold, 12)
        c.drawString(70, y, "Экзаменатор:")
        c.setFont(font, 12)
        c.drawString(190, y, f"{cert.get('required_examiner_name') or '—'}")
        y -= 18

    if cert.get("cert_type") == "internal" and cert.get("workflow_status") == "passed":
        c.setFont(font_bold, 12)
        c.drawString(70, y, "Экзамен:")
        c.setFont(font, 12)
        grade = award_label(cert.get("exam_grade")) or cert.get("exam_grade") or "—"
        dt = cert.get("exam_date") or ""
        c.drawString(190, y, f"Оценка {grade} {('(' + dt + ')') if dt else ''}")
        y -= 18

    if cert.get("cert_type") == "internal" and cert.get("workflow_status") == "failed":
        c.setFont(font_bold, 12)
        c.drawString(70, y, "Экзамен:")
        c.setFont(font, 12)
        dt = cert.get("exam_date") or ""
        c.drawString(190, y, f"Не сдан {('(' + dt + ')') if dt else ''}")
        y -= 18

    # подписи
    c.line(70, 110, 270, 110)
    c.setFont(font, 10)
    c.drawString(70, 95, "Подпись")

    c.line(width - 270, 110, width - 70, 110)
    c.drawRightString(width - 70, 95, "Ответственный")

    c.showPage()
    c.save()
    buf.seek(0)
    return buf.getvalue()




def decorate_cert(item: Dict[str, Any]) -> Dict[str, Any]:
    """Добавляет поля status/status_label, учитывая отзыв HR."""
    if item.get("workflow_status") == "revoked":
        item["status"] = "revoked"
        item["status_label"] = "Отозван"
        return item

    # Внутренний сертификат не должен считаться действительным,
    # пока экзамен не сдан (или если экзамен провален)
    if item.get("cert_type") == "internal":
        if item.get("workflow_status") == "pending_exam":
            item["status"] = "pending"
            item["status_label"] = "Ожидает экзамен"
            return item
        if item.get("workflow_status") == "failed":
            item["status"] = "invalid"
            item["status_label"] = "Недействителен"
            return item

    # Приводим отображаемую оценку к текущим уровням (Light/Standart/Hard)
    # для корректного UI и PDF/SVG, даже если в базе остались старые значения.
    if item.get("workflow_status") == "passed" and item.get("exam_grade") and item.get("exam_grade") != "Не сдан":
        item["exam_grade"] = award_label(item.get("exam_grade")) or item.get("exam_grade")

    status, label = compute_status(str(item.get("expires_at", "")))
    item["status"] = status
    item["status_label"] = label
    return item


def descendant_user_ids(manager_id: int) -> List[int]:
    """Все подчинённые (прямые и косвенные) согласно профилям."""
    profiles = {int(p["user_id"]): p for p in list_user_profiles()}
    children: Dict[int, List[int]] = {}

    def mgr_of(uid: int) -> Optional[int]:
        prof = profiles.get(int(uid))
        if prof is not None and prof.get("manager_id") is not None:
            try:
                return int(prof.get("manager_id"))
            except Exception:
                return None
        base = USERS_BY_ID.get(int(uid))
        return base.manager_id if base else None

    for u in USERS:
        mid = mgr_of(u.id)
        if mid is None:
            continue
        children.setdefault(int(mid), []).append(int(u.id))

    out: List[int] = []
    stack: List[int] = list(children.get(int(manager_id), []))
    seen = set()
    while stack:
        uid = stack.pop()
        if uid in seen:
            continue
        seen.add(uid)
        out.append(uid)
        stack.extend(children.get(uid, []))
    return out

# -------------------------
# Auth
# -------------------------

@app.get("/login", response_class=HTMLResponse)
async def login_page(request: Request):
    # Если уже вошли — сразу на реестр
    if current_user(request) is not None:
        return RedirectResponse("/certification", status_code=303)

    grouped = group_users_for_login()
    return templates.TemplateResponse(
        "login.html",
        {
            "request": request,
            "groups": grouped,
        },
    )


@app.post("/login")
async def do_login(request: Request, user_id: int = Form(...)):
    user = get_user(user_id)
    if user is None:
        raise HTTPException(status_code=400, detail="Unknown user")

    request.session["user_id"] = int(user_id)
    return RedirectResponse("/certification", status_code=303)


@app.get("/logout")
async def logout(request: Request):
    request.session.clear()
    return RedirectResponse("/login", status_code=303)


# -------------------------
# Pages
# -------------------------

@app.get("/", response_class=HTMLResponse)
async def home(request: Request):
    user = current_user(request)
    if user is None:
        return RedirectResponse("/login", status_code=303)

    return templates.TemplateResponse(
        "index.html",
        {
            "request": request,
            "user": user,
        },
    )


@app.get("/certification", response_class=HTMLResponse)
async def certification(request: Request):
    user = current_user(request)
    if user is None:
        return RedirectResponse("/login", status_code=303)

    return templates.TemplateResponse(
        "index_base.html",
        {
            "request": request,
            "user": user,
        },
    )


@app.get("/profile", response_class=HTMLResponse)
async def profile_page(request: Request):
    user = current_user(request)
    if user is None:
        return RedirectResponse("/login", status_code=303)

    profile = get_user_profile(user.id) or {
        "user_id": user.id,
        "full_name": user.full_name,
        "position": user.position,
        "module": user.module,
        "manager_id": user.manager_id,
        "controlled_module": user.controlled_module,
    }

    # список пользователей для выбора руководителя
    users_for_select = []
    for u in USERS:
        # имя покажем из профиля, если оно было изменено
        pu = make_display_user(u, get_user_profile(u.id))
        users_for_select.append(pu)

    return templates.TemplateResponse(
        "profile.html",
        {
            "request": request,
            "user": user,
            "profile": profile,
            "users": users_for_select,
            "modules": MODULES,
        },
    )


@app.post("/profile")
async def profile_save(
    request: Request,
    full_name: str = Form(...),
    position: str = Form(...),
    module: str = Form(...),
    manager_id: str = Form(""),
    controlled_module: str = Form(""),
):
    user = current_user(request)
    if user is None:
        return RedirectResponse("/login", status_code=303)

    mid: Optional[int]
    try:
        mid = int(manager_id) if manager_id.strip() else None
    except Exception:
        mid = None

    cm = controlled_module.strip() or None

    upsert_user_profile(
        user_id=user.id,
        full_name=full_name.strip(),
        position=position.strip(),
        module=module.strip(),
        manager_id=mid,
        controlled_module=cm,
    )

    return RedirectResponse("/profile?saved=1", status_code=303)




@app.get("/certificate/{cert_id:int}", response_class=HTMLResponse)
async def certificate_page(request: Request, cert_id: int):
    cert = get_certificate(int(cert_id))
    if cert is None:
        raise HTTPException(status_code=404, detail="Certificate not found")

    user = current_user(request)

    # Публичный просмотр (без авторизации): показываем только статус
    if user is None:
        st = public_status(cert)
        return templates.TemplateResponse(
            "certificate_public.html",
            {
                "request": request,
                "cert_id": int(cert_id),
                "status_code": st["code"],
                "status_label": st["label"],
            },
        )

    # --- приватный просмотр (внутри системы) ---
    # подставим снапшоты если старые записи без них
    owner_id = int(cert.get("owner_id") or 0)
    if not cert.get("snapshot_full_name") and owner_id:
        base = USERS_BY_ID.get(owner_id)
        if base:
            du = make_display_user(base, get_user_profile(base.id))
            cert["snapshot_full_name"] = du.full_name
            cert["snapshot_position"] = du.position
            cert["snapshot_module"] = du.module
            cert["snapshot_manager_id"] = du.manager_id
            mgr_name = None
            if du.manager_id is not None:
                base_mgr = USERS_BY_ID.get(int(du.manager_id))
                if base_mgr is not None:
                    mgr_name = make_display_user(base_mgr, get_user_profile(base_mgr.id)).full_name
            cert["snapshot_manager_name"] = mgr_name

    if not can_view_certificate(user, cert):
        raise HTTPException(status_code=403, detail="Not allowed")

    decorate_cert(cert)

    share_url = str(request.url_for("certificate_page", cert_id=int(cert_id)))

    can_exam = bool(cert.get("cert_type") == "internal" and cert.get("required_examiner_id") is not None and int(cert.get("required_examiner_id")) == int(user.id) and cert.get("workflow_status") != "revoked")
    can_hr = bool(user.role == "hr")

    return templates.TemplateResponse(
        "certificate_detail.html",
        {
            "request": request,
            "user": user,
            "cert": cert,
            "share_url": share_url,
            "can_exam": can_exam,
            "can_hr": can_hr,
        },
    )


# -------------------------
# API
# -------------------------

@app.get("/api/users/me")
async def api_me(request: Request):
    user = current_user(request)
    if user is None:
        raise HTTPException(status_code=401, detail="Not authenticated")
    return {
        "id": user.id,
        "full_name": user.full_name,
        "initials": user.initials,
        "role": user.role,
        "role_label": user.role_label,
        "position": user.position,
        "module": user.module,
        "manager_id": user.manager_id,
        "controlled_module": user.controlled_module,
    }


@app.get("/api/users")
async def api_users(request: Request):
    user = current_user(request)
    if user is None:
        raise HTTPException(status_code=401, detail="Not authenticated")
    items = []
    for u in USERS:
        du = make_display_user(u, get_user_profile(u.id))
        items.append(
            {
                "id": du.id,
                "full_name": du.full_name,
                "role": du.role,
                "role_label": du.role_label,
            }
        )
    return {"items": items}


@app.get("/api/certificates")
async def api_list_certificates(request: Request):
    user = current_user(request)
    if user is None:
        raise HTTPException(status_code=401, detail="Not authenticated")

    items = list_certificates(user.id)
    for it in items:
        decorate_cert(it)
    return {"items": items}


@app.get("/api/certificates/requests")
async def api_exam_requests(request: Request):
    user = current_user(request)
    if user is None:
        raise HTTPException(status_code=401, detail="Not authenticated")

    items = list_exam_requests(user.id)
    for it in items:
        decorate_cert(it)
    return {"items": items}


@app.post("/api/certificates")
async def api_add_certificate(request: Request):
    user = current_user(request)
    if user is None:
        raise HTTPException(status_code=401, detail="Not authenticated")

    payload: Dict[str, Any] = await request.json()

    name = str(payload.get("name", "")).strip()
    issued_at = str(payload.get("issued_at", "")).strip()
    expires_at = str(payload.get("expires_at", "")).strip()
    is_perpetual = bool(payload.get("is_perpetual", False))
    cert_type = str(payload.get("cert_type", "external")).strip() or "external"
    topic = str(payload.get("topic", "")).strip() or None

    if not name or not issued_at:
        raise HTTPException(status_code=400, detail="name and issued_at are required")

    # По умолчанию сертификаты бессрочные.
    # Если чекбокс выключен — expires_at обязателен.
    if is_perpetual or not expires_at:
        expires_at = ""
    else:
        expires_at = str(expires_at).strip()
        if not expires_at:
            raise HTTPException(status_code=400, detail="expires_at is required when not perpetual")
    if cert_type not in ("internal", "external"):
        raise HTTPException(status_code=400, detail="cert_type must be internal or external")
    if cert_type == "internal" and not topic:
        raise HTTPException(status_code=400, detail="topic is required for internal certificate")

    # берём актуальные данные профиля на момент добавления
    prof = get_user_profile(user.id) or {}

    manager_id = prof.get("manager_id")
    manager_name = None
    if manager_id is not None:
        base_mgr = USERS_BY_ID.get(int(manager_id))
        if base_mgr is not None:
            manager_name = make_display_user(base_mgr, get_user_profile(base_mgr.id)).full_name

    workflow_status = "active"
    required_examiner_id = None
    required_examiner_name = None

    if cert_type == "internal":
        workflow_status = "pending_exam"
        required_examiner_id = int(manager_id) if manager_id is not None else None
        required_examiner_name = manager_name

    cert = add_certificate(
        owner_id=user.id,
        name=name,
        issued_at=issued_at,
        expires_at=expires_at,
        cert_type=cert_type,
        topic=topic,
        workflow_status=workflow_status,
        required_examiner_id=required_examiner_id,
        required_examiner_name=required_examiner_name,
        snapshot_full_name=str(prof.get("full_name") or user.full_name),
        snapshot_position=str(prof.get("position") or user.position),
        snapshot_module=str(prof.get("module") or user.module),
        snapshot_manager_id=int(manager_id) if manager_id is not None else None,
        snapshot_manager_name=manager_name,
    )

    decorate_cert(cert)
    return JSONResponse(cert)


@app.get("/api/certificates/{cert_id:int}")
async def api_get_certificate(cert_id: int, request: Request):
    user = current_user(request)
    if user is None:
        raise HTTPException(status_code=401, detail="Not authenticated")

    cert = get_certificate(int(cert_id))
    if cert is None:
        raise HTTPException(status_code=404, detail="Not found")

    if not can_view_certificate(user, cert):
        raise HTTPException(status_code=403, detail="Not allowed")

    decorate_cert(cert)
    return JSONResponse(cert)


@app.get("/api/certificates/{cert_id:int}/image")
async def api_certificate_image(cert_id: int, request: Request):
    user = current_user(request)
    if user is None:
        raise HTTPException(status_code=401, detail="Not authenticated")

    cert = get_certificate(int(cert_id))
    if cert is None:
        raise HTTPException(status_code=404, detail="Not found")

    if not can_view_certificate(user, cert):
        raise HTTPException(status_code=403, detail="Not allowed")

    # важно: не используем HTML-шаблоны, а отдаём "картинку" на лету
    svg = certificate_svg(cert)
    return Response(content=svg, media_type="image/svg+xml")


@app.get("/api/certificates/{cert_id:int}/qr")
async def api_certificate_qr(cert_id: int, request: Request):
    """QR-код (SVG) со ссылкой на карточку сертификата."""
    user = current_user(request)
    if user is None:
        raise HTTPException(status_code=401, detail="Not authenticated")

    cert = get_certificate(int(cert_id))
    if cert is None:
        raise HTTPException(status_code=404, detail="Not found")

    if not can_view_certificate(user, cert):
        raise HTTPException(status_code=403, detail="Not allowed")

    # Полная ссылка на карточку сертификата (под доменом/портом текущего запроса)
    share_url = str(request.url_for("certificate_page", cert_id=int(cert_id)))

    factory = qrcode.image.svg.SvgImage
    img = qrcode.make(share_url, image_factory=factory, box_size=10, border=2)
    buf = BytesIO()
    img.save(buf)
    return Response(content=buf.getvalue(), media_type="image/svg+xml")


@app.get("/api/certificates/{cert_id:int}/pdf")
async def api_certificate_pdf(cert_id: int, request: Request):
    user = current_user(request)
    if user is None:
        raise HTTPException(status_code=401, detail="Not authenticated")

    cert = get_certificate(int(cert_id))
    if cert is None:
        raise HTTPException(status_code=404, detail="Not found")

    if not can_view_certificate(user, cert):
        raise HTTPException(status_code=403, detail="Not allowed")

    pdf = certificate_pdf_bytes(cert)
    filename = f"certificate_{int(cert_id)}.pdf"
    return Response(
        content=pdf,
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )

@app.post("/api/certificates/{cert_id:int}/exam")
async def api_set_exam_result(cert_id: int, request: Request):
    user = current_user(request)
    if user is None:
        raise HTTPException(status_code=401, detail="Not authenticated")

    payload: Dict[str, Any] = await request.json()
    grade = str(payload.get("exam_grade", "")).strip()
    exam_date = str(payload.get("exam_date", "")).strip()

    # нормализуем оценки под уровни: Light / Standart / Hard
    # + отдельное значение "Не сдан"
    raw = grade
    grade = award_label(grade) or grade
    if str(raw).strip().lower() in {"не сдан", "не сдал", "не сдано"}:
        grade = "Не сдан"
    allowed_grades = {"Hard", "Standart", "Light", "Не сдан"}

    if not grade or not exam_date:
        raise HTTPException(status_code=400, detail="exam_grade and exam_date are required")
    if grade not in allowed_grades:
        raise HTTPException(status_code=400, detail="exam_grade must be one of: Hard, Standart, Light, Не сдан")

    try:
        wf = "failed" if grade == "Не сдан" else "passed"
        cert = set_exam_result(
            cert_id=cert_id,
            examiner_id=user.id,
            exam_grade=grade,
            exam_date=exam_date,
            workflow_status=wf,
        )
    except PermissionError:
        raise HTTPException(status_code=403, detail="Not allowed")
    except ValueError:
        raise HTTPException(status_code=404, detail="Not found")

    decorate_cert(cert)
    return JSONResponse(cert)


@app.get("/api/certificates/team")
async def api_team_certificates(request: Request):
    """Сертификаты сотрудников по подчинённости, либо по модулю для HR."""
    user = current_user(request)
    if user is None:
        raise HTTPException(status_code=401, detail="Not authenticated")

    # HR видит сертификаты подконтрольного модуля
    if user.role == "hr":
        module = user.controlled_module or MODULE_CERTIFICATION
        items = list_certificates_by_module(module)
        for it in items:
            decorate_cert(it)
        return {
            "items": items,
            "scope": f"Подконтрольный модуль: {module}",
            "can_revoke": True,
        }

    # Руководители видят всех подчинённых (прямых и косвенных)
    subs = descendant_user_ids(user.id)
    items = list_certificates_for_owners(subs)
    for it in items:
        decorate_cert(it)

    scope = "У вас нет подчинённых." if not subs else f"Подчинённых: {len(subs)}"
    return {"items": items, "scope": scope, "can_revoke": False}


@app.post("/api/certificates/{cert_id:int}/revoke")
async def api_revoke_certificate(cert_id: int, request: Request):
    user = current_user(request)
    if user is None:
        raise HTTPException(status_code=401, detail="Not authenticated")
    if user.role != "hr":
        raise HTTPException(status_code=403, detail="Not allowed")

    payload: Dict[str, Any] = await request.json()
    reason = str(payload.get("reason", "")).strip()
    if not reason:
        raise HTTPException(status_code=400, detail="reason is required")

    try:
        cert = revoke_certificate(
            cert_id=int(cert_id),
            hr_id=user.id,
            hr_name=user.full_name,
            reason=reason,
            allowed_module=user.controlled_module,
        )
    except PermissionError:
        raise HTTPException(status_code=403, detail="Not allowed")
    except ValueError:
        raise HTTPException(status_code=404, detail="Not found")

    decorate_cert(cert)
    return JSONResponse(cert)


@app.post("/api/certificates/{cert_id:int}/unrevoke")
async def api_unrevoke_certificate(cert_id: int, request: Request):
    user = current_user(request)
    if user is None:
        raise HTTPException(status_code=401, detail="Not authenticated")
    if user.role != "hr":
        raise HTTPException(status_code=403, detail="Not allowed")

    try:
        cert = unrevoke_certificate(
            cert_id=int(cert_id),
            hr_id=user.id,
            allowed_module=user.controlled_module,
        )
    except PermissionError:
        raise HTTPException(status_code=403, detail="Not allowed")
    except ValueError:
        raise HTTPException(status_code=404, detail="Not found")

    decorate_cert(cert)
    return JSONResponse(cert)


@app.post("/api/certificates/{cert_id:int}/edit")
async def api_edit_certificate(cert_id: int, request: Request):
    """Редактирование сертификата (для HR)."""
    user = current_user(request)
    if user is None:
        raise HTTPException(status_code=401, detail="Not authenticated")
    if user.role != "hr":
        raise HTTPException(status_code=403, detail="Not allowed")

    payload: Dict[str, Any] = await request.json()

    name = str(payload.get("name", "")).strip()
    issued_at = str(payload.get("issued_at", "")).strip()
    expires_at = str(payload.get("expires_at", "")).strip()
    is_perpetual = bool(payload.get("is_perpetual", False))
    topic = str(payload.get("topic", "")).strip() or None

    if not name or not issued_at:
        raise HTTPException(status_code=400, detail="name and issued_at are required")

    if is_perpetual or not expires_at:
        expires_at = ""

    try:
        cert = update_certificate(
            cert_id=int(cert_id),
            name=name,
            issued_at=issued_at,
            expires_at=expires_at,
            topic=topic,
            allowed_module=user.controlled_module or MODULE_CERTIFICATION,
        )
    except PermissionError:
        raise HTTPException(status_code=403, detail="Not allowed")
    except ValueError:
        raise HTTPException(status_code=404, detail="Not found")

    decorate_cert(cert)
    return JSONResponse(cert)


@app.delete("/api/certificates/{cert_id:int}")
async def api_delete_certificate(cert_id: int, request: Request):
    """Удаление сертификата (для курирующего HR)."""
    user = current_user(request)
    if user is None:
        raise HTTPException(status_code=401, detail="Not authenticated")
    if user.role != "hr":
        raise HTTPException(status_code=403, detail="Not allowed")

    try:
        delete_certificate(
            cert_id=int(cert_id),
            allowed_module=user.controlled_module or MODULE_CERTIFICATION,
        )
    except PermissionError:
        raise HTTPException(status_code=403, detail="Not allowed")
    except ValueError:
        raise HTTPException(status_code=404, detail="Not found")

    return JSONResponse({"ok": True})
