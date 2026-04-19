"""
5S workspace: categorías, plantillas, proyectos (checklist + tareas + despensa + agendas).
Persistencia JSON local.
Asistente: por defecto Ollama (hugo-garcia:latest o AGENTE_5S_OLLAMA_MODEL); fallback Gemini si AGENTE_5S_LLM=auto.
"""
from __future__ import annotations

import json
import os
import re
import threading
import uuid
from datetime import datetime
from typing import Any

import requests

_DATA_DIR = os.path.join(os.path.dirname(__file__), "..", "data")
WORKSPACE_PATH = os.path.join(_DATA_DIR, "cinco_s_workspace.json")
CINCO_S_AUDIO_DIR = os.path.join(_DATA_DIR, "5s_audio")
_LOCK = threading.Lock()
_MAX_BYTES = 2_000_000
_MAX_WAV_BYTES = 8 * 1024 * 1024


def _now_iso() -> str:
    return datetime.now().isoformat(timespec="seconds")


def default_workspace() -> dict[str, Any]:
    return {
        "version": 1,
        "updated_at": _now_iso(),
        "categories": [
            {"id": "c-limpieza", "name": "Limpieza", "icon": "🧹"},
            {"id": "c-diseno", "name": "Diseño y taller", "icon": "🛠"},
            {"id": "c-finanzas", "name": "Finanzas", "icon": "📊"},
            {"id": "c-ingenieria", "name": "Ingeniería", "icon": "⚙"},
            {"id": "c-alimentacion", "name": "Alimentación", "icon": "🍳"},
            {"id": "c-mascotas", "name": "Mascotas", "icon": "🐾"},
            {"id": "c-entrenamientos", "name": "Entrenamientos", "icon": "🏋️"},
            {"id": "c-jardineria", "name": "Jardinería", "icon": "🌿"},
            {"id": "c-gestion_empresarial", "name": "Gestión empresarial", "icon": "💼"},
        ],
        "templates": [
            {
                "id": "t-blender",
                "category_id": "c-diseno",
                "name": "Proyecto mockups Blender",
                "preflight_steps": [
                    {"label": "Materiales y referencias reunidos", "assignee": ""},
                    {"label": "Estación ordenada (5S)", "assignee": ""},
                ],
                "tasks": [
                    {"title": "Conceptos / moodboard", "assignee": ""},
                    {"title": "Modelado base", "assignee": ""},
                    {"title": "Render y export", "assignee": ""},
                ],
                "ritual_notes": "Antes de abrir Blender: carpeta del proyecto lista; guardar incremental.",
            },
            {
                "id": "t-cocina",
                "category_id": "c-alimentacion",
                "name": "Preparación con control de cocina",
                "preflight_steps": [
                    {"label": "Loza lavada y guardada", "assignee": ""},
                    {"label": "Mesones desocupados", "assignee": ""},
                    {"label": "Cocina aseada", "assignee": ""},
                    {"label": "Utensilios en su puesto", "assignee": ""},
                ],
                "tasks": [
                    {"title": "Mise en place", "assignee": ""},
                    {"title": "Ejecución receta", "assignee": ""},
                    {"title": "Limpieza final", "assignee": ""},
                ],
                "ritual_notes": "No iniciar fuego hasta preflight completo.",
            },
            {
                "id": "t-paseo",
                "category_id": "c-mascotas",
                "name": "Rutina paseo mascotas",
                "preflight_steps": [
                    {"label": "Alimento / hidratación revisados", "assignee": ""},
                    {"label": "Correas y bozales OK", "assignee": ""},
                    {"label": "Bolsas, llaves, identificación", "assignee": ""},
                ],
                "tasks": [
                    {"title": "Salida", "assignee": ""},
                    {"title": "Paseo", "assignee": ""},
                    {"title": "Retorno y higiene", "assignee": ""},
                ],
                "ritual_notes": "Checklist antes de salir de casa.",
            },
        ],
        "projects": [],
    }


def _ensure_shape(data: dict[str, Any]) -> dict[str, Any]:
    out = default_workspace()
    if not isinstance(data, dict):
        return out
    for k in ("categories", "templates", "projects"):
        v = data.get(k)
        if isinstance(v, list):
            out[k] = v
    ver = data.get("version")
    if isinstance(ver, int):
        out["version"] = ver
    out["updated_at"] = _now_iso()
    # Mantener categorías existentes pero asegurar set base de áreas del tablero 5S.
    base_cats = {str(c.get("id")): c for c in default_workspace().get("categories", []) if isinstance(c, dict)}
    cur = [c for c in (out.get("categories") or []) if isinstance(c, dict) and c.get("id")]
    cur_ids = {str(c.get("id")) for c in cur}
    for cid, row in base_cats.items():
        if cid not in cur_ids:
            cur.append(row)
    out["categories"] = cur
    # Proyectos legacy: asegurar postflight (cierre 5S) y campos mínimos.
    projs = out.get("projects")
    if isinstance(projs, list):
        for p in projs:
            if not isinstance(p, dict):
                continue
            pf = p.get("postflight")
            if not isinstance(pf, list) or not pf:
                p["postflight"] = default_postflight_steps()
            if not isinstance(p.get("shopping_list"), list):
                p["shopping_list"] = []
            if "shopping_required" not in p:
                p["shopping_required"] = False
            if "routine_state" not in p:
                p["routine_state"] = "pending"
    return out


def read_workspace() -> dict[str, Any]:
    with _LOCK:
        try:
            with open(WORKSPACE_PATH, "r", encoding="utf-8") as f:
                raw = json.load(f)
            if isinstance(raw, dict):
                return _ensure_shape(raw)
        except FileNotFoundError:
            pass
        except Exception:
            pass
        return default_workspace()


def write_workspace(data: dict[str, Any]) -> dict[str, Any]:
    normalized = _ensure_shape(data)
    blob = json.dumps(normalized, indent=2, ensure_ascii=False).encode("utf-8")
    if len(blob) > _MAX_BYTES:
        raise ValueError("workspace demasiado grande")
    os.makedirs(_DATA_DIR, exist_ok=True)
    tmp = WORKSPACE_PATH + ".tmp"
    with _LOCK:
        with open(tmp, "wb") as f:
            f.write(blob)
        os.replace(tmp, WORKSPACE_PATH)
    return normalized


def _valid_category_ids(workspace: dict[str, Any]) -> set[str]:
    return {
        str(c.get("id"))
        for c in (workspace.get("categories") or [])
        if isinstance(c, dict) and c.get("id")
    }


def resolve_category_from_tags(
    workspace: dict[str, Any],
    tags: list[str] | None,
    explicit_category_id: str | None,
) -> str:
    """Elige category_id: explícito válido, heurística por patrones (tags), o primera categoría."""
    valid = _valid_category_ids(workspace)
    want = (explicit_category_id or "").strip()
    if want and want in valid:
        return want
    tag_to_cat: dict[str, str] = {
        "mascotas": "c-mascotas",
        "hogar": "c-limpieza",
        "limpieza": "c-limpieza",
        "mantenimiento": "c-limpieza",
        "salud": "c-entrenamientos",
        "cocina": "c-alimentacion",
        "alimentacion": "c-alimentacion",
        "taller": "c-diseno",
        "diseno": "c-diseno",
        "finanzas": "c-finanzas",
        "pagos": "c-finanzas",
        "ingenieria": "c-ingenieria",
        "jardineria": "c-jardineria",
        "entrenamiento": "c-entrenamientos",
        "entrenamientos": "c-entrenamientos",
        "empresa": "c-gestion_empresarial",
        "gestion": "c-gestion_empresarial",
    }
    for raw in tags or []:
        s = str(raw).strip().lower()
        if not s:
            continue
        cid = tag_to_cat.get(s)
        if cid and cid in valid:
            return cid
    cats = workspace.get("categories") or []
    if cats and isinstance(cats[0], dict):
        first = str(cats[0].get("id") or "")
        if first in valid:
            return first
    return next(iter(valid), "") if valid else ""


def _norm_tags(tags: list[str] | None, limit: int = 24) -> list[str]:
    out: list[str] = []
    seen: set[str] = set()
    for raw in tags or []:
        s = str(raw).strip()
        if not s or len(s) > 48:
            continue
        key = s.lower()
        if key in seen:
            continue
        seen.add(key)
        out.append(s)
        if len(out) >= limit:
            break
    return out


_ALLOWED_PANTRY_UNITS = frozenset(
    {
        "g",
        "kg",
        "mg",
        "ml",
        "l",
        "ud",
        "u",
        "porción",
        "porciones",
        "servicio",
        "servicios",
        "unidad",
        "unidades",
        "caja",
        "bolsa",
        "bandeja",
        "taza",
        "cda",
        "cc",
        "lb",
        "oz",
    }
)


def _norm_pantry_unit(raw: Any) -> str:
    s = str(raw or "").strip().lower()
    s = s.replace("ó", "o")
    if not s or len(s) > 14:
        return "ud"
    return s if s in _ALLOWED_PANTRY_UNITS else "ud"


def _normalize_supplies(raw: Any) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    if not isinstance(raw, list):
        return out
    for it in raw:
        if not isinstance(it, dict):
            continue
        name = str(it.get("name", "")).strip()
        if not name:
            continue
        prep = str(it.get("prep_action", "")).strip()
        unit = _norm_pantry_unit(it.get("unit"))
        try:
            init = float(it.get("initial_qty", 1))
        except (TypeError, ValueError):
            init = 1.0
        try:
            reorder = float(it.get("reorder_below", 0.25))
        except (TypeError, ValueError):
            reorder = 0.25
        try:
            pri = int(it.get("priority", 3))
        except (TypeError, ValueError):
            pri = 3
        pri = max(1, min(5, pri))
        out.append(
            {
                "name": name,
                "prep_action": prep,
                "initial_qty": max(0.0, init),
                "reorder_below": max(0.0, reorder),
                "priority": pri,
                "unit": unit,
            }
        )
    return out


def default_postflight_steps() -> list[dict[str, Any]]:
    """Seiketsu + Shitsuke: cierre operativo tras Core-Process."""
    return _steps_from_labels(
        [
            "Registrar consumos y ajustar inventario si aplica",
            "Estandarizar: dejar checklist y utensilios listos para el próximo uso",
            "Disciplina: confirmar área ordenada y sin residuos",
        ]
    )


def create_routine_project(
    workspace: dict[str, Any],
    name: str,
    tags: list[str] | None,
    preflight_labels: list[str] | None,
    task_titles: list[str] | None,
    ritual_notes: str,
    category_id: str | None,
    also_save_template: bool,
    supplies: list[dict[str, Any]] | None = None,
    materials: list[dict[str, Any]] | None = None,
    recipe_notes: str | None = None,
    postflight_labels: list[str] | None = None,
) -> tuple[dict[str, Any] | None, str | None]:
    """
    Crea un proyecto sin plantilla previa (rutina guiada).
    supplies: insumos con preparación previa → despensa + tareas scope=prep + preflight de verificación.
    Opcionalmente agrega una plantilla derivada del mismo checklist (patrón reutilizable).
    """
    nm = str(name or "").strip()
    if not nm:
        return None, "nombre requerido"
    pre_extras = [str(x).strip() for x in (preflight_labels or []) if str(x).strip()]
    titles = [str(x).strip() for x in (task_titles or []) if str(x).strip()]
    sup = _normalize_supplies(supplies)
    if not titles and not sup:
        return None, "agregá insumos en despensa o al menos una tarea principal"
    if not titles and sup:
        titles = [f"Completar rutina: {nm}"]
    valid = _valid_category_ids(workspace)
    if not valid:
        return None, "sin categorías en el workspace"
    resolved = resolve_category_from_tags(workspace, tags, category_id)
    if resolved not in valid:
        return None, "category_id inválido"

    def _steps_from_labels(labels: list[str]) -> list[dict[str, Any]]:
        out: list[dict[str, Any]] = []
        for lab in labels:
            out.append(
                {
                    "id": f"pf-{uuid.uuid4().hex[:10]}",
                    "label": lab,
                    "done": False,
                    "assignee": "",
                }
            )
        return out

    pantry_list: list[dict[str, Any]] = []
    materials_list: list[dict[str, Any]] = []
    prep_tasks: list[dict[str, Any]] = []
    preflight_gate_labels: list[str] = []

    for i, s in enumerate(sup):
        pan_id = f"pan-{uuid.uuid4().hex[:10]}"
        u = str(s.get("unit") or "ud")
        pantry_list.append(
            {
                "id": pan_id,
                "name": s["name"],
                "qty": float(s["initial_qty"]),
                "unit": u,
                "reorder_below": float(s["reorder_below"]),
                "consumption_per_run": 1.0,
                "prep_notes": s["prep_action"],
            }
        )
        gate = f'{s["name"]}: verificado en despensa (≥ {s["reorder_below"]} {u})'
        preflight_gate_labels.append(gate)
        if s["prep_action"]:
            prep_tasks.append(
                {
                    "id": f"tk-{uuid.uuid4().hex[:10]}",
                    "title": f'{s["prep_action"]} — {s["name"]}',
                    "status": "pending",
                    "assignee": "",
                    "blocked_reason": "",
                    "order": int(s["priority"]) * 20 + i,
                    "scope": "prep",
                    "linked_pantry_id": pan_id,
                }
            )

    for m in materials or []:
        if not isinstance(m, dict):
            continue
        name = str(m.get("name", "")).strip()
        if not name:
            continue
        try:
            qty = float(m.get("qty", 1))
        except (TypeError, ValueError):
            qty = 1.0
        try:
            cpr = float(m.get("consumption_per_run", 1))
        except (TypeError, ValueError):
            cpr = 1.0
        materials_list.append(
            {
                "id": f"mat-{uuid.uuid4().hex[:10]}",
                "name": name,
                "qty": max(0.0, qty),
                "unit": _norm_pantry_unit(m.get("unit")),
                "consumption_per_run": max(0.0, cpr),
                "required_for_start": True,
            }
        )

    max_prep_ord = max((int(t["order"]) for t in prep_tasks), default=-1)
    base_main = max_prep_ord + 10
    main_tasks: list[dict[str, Any]] = []
    for i, title in enumerate(titles):
        main_tasks.append(
            {
                "id": f"tk-{uuid.uuid4().hex[:10]}",
                "title": title,
                "status": "pending",
                "assignee": "",
                "blocked_reason": "",
                "order": base_main + i,
                "scope": "main",
            }
        )

    pre_all = preflight_gate_labels + pre_extras
    preflight_rows = _steps_from_labels(pre_all)
    post_extras = [str(x).strip() for x in (postflight_labels or []) if str(x).strip()]
    postflight_rows = _steps_from_labels(post_extras) if post_extras else default_postflight_steps()

    pid = f"p-{uuid.uuid4().hex[:12]}"
    ts = _now_iso()
    ritual = str(ritual_notes or "").strip()
    tag_list = _norm_tags(tags)

    project: dict[str, Any] = {
        "id": pid,
        "category_id": resolved,
        "template_id": "rutina-personalizada",
        "name": nm,
        "tags": tag_list,
        "created_at": ts,
        "updated_at": ts,
        "preflight": preflight_rows,
        "postflight": postflight_rows,
        "tasks": prep_tasks + main_tasks,
        "materials": materials_list,
        "pantry": pantry_list,
        "shopping_list": [],
        "shopping_required": False,
        "routine_state": "pending",
        "recipe_notes": str(recipe_notes or "").strip(),
        "schedules": [],
        "ritual_notes": ritual,
    }
    projs = list(workspace.get("projects") or [])
    projs.append(project)
    workspace["projects"] = projs

    if also_save_template:
        tid = f"t-{uuid.uuid4().hex[:10]}"
        tpl_name = f"Patrón: {nm[:52]}"
        merged = _normalize_template_steps(
            {
                "name": tpl_name,
                "category_id": resolved,
                "ritual_notes": ritual,
                "preflight_steps": [{"label": x} for x in pre_all],
                "tasks": [{"title": str(t.get("title", ""))} for t in prep_tasks + main_tasks if str(t.get("title", "")).strip()],
            },
            tid,
        )
        if merged and not any(str(t.get("id")) == tid for t in (workspace.get("templates") or [])):
            workspace.setdefault("templates", []).append(merged)

    workspace["updated_at"] = _now_iso()
    return project, None


def _parse_json_object_from_llm(text: str) -> dict[str, Any] | None:
    t = (text or "").strip()
    if not t:
        return None
    if t.startswith("```"):
        t = re.sub(r"^```(?:json)?\s*", "", t, flags=re.I)
        if "```" in t:
            t = t.split("```", 1)[0].strip()
    try:
        obj = json.loads(t)
        return obj if isinstance(obj, dict) else None
    except Exception:
        return None


def suggest_routine_json(
    description: str,
    hints: dict[str, Any] | None = None,
) -> tuple[dict[str, Any] | None, str]:
    """
    Hugo (Ollama) sugiere checklist/tareas/tags en JSON.
    Retorna (dict con keys tags, preflight, tasks, ritual_notes normalizadas, error_usuario).
    """
    desc = str(description or "").strip()
    if not desc:
        return None, "descripción requerida"
    hint_txt = ""
    if hints and isinstance(hints, dict):
        try:
            hint_txt = json.dumps(hints, ensure_ascii=False)[:2000]
        except Exception:
            hint_txt = ""

    system = """Sos Hugo García, coach operativo. El usuario describe una rutina o tarea repetitiva.
Respondé SOLO con un objeto JSON (sin markdown, sin texto fuera del JSON) con esta forma exacta:
{"tags":["palabra_clave",...], "preflight":["condición antes de empezar",...], "tasks":["paso principal",...], "ritual_notes":"una frase corta de hábito o recordatorio"}
- tags: 2 a 8 strings cortas en español minúsculas (contexto: hogar, cocina, mascotas, taller, pagos, etc.)
- preflight: 0 a 8 ítems concretos
- tasks: 3 a 12 ítems ordenados (verbos en infinitivo o imperativo breve)
- ritual_notes: string, puede ser vacía
No uses comillas tipográficas; escapá saltos de línea dentro de strings."""

    user = f"""Lo que ya cargó el usuario (puede estar vacío):
{hint_txt or "{}"}

Descripción en sus palabras:
{desc[:4000]}"""

    base = _ollama_base_url()
    model = _ollama_model_5s()
    url = f"{base}/api/chat"
    try:
        r = requests.post(
            url,
            json={
                "model": model,
                "messages": [
                    {"role": "system", "content": system},
                    {"role": "user", "content": user},
                ],
                "stream": False,
                "options": {"temperature": 0.35},
            },
            timeout=120,
        )
        r.raise_for_status()
        data = r.json()
        msg = data.get("message") or {}
        raw = (msg.get("content") or "").strip()
        obj = _parse_json_object_from_llm(raw)
        if not obj:
            return None, "No se pudo interpretar JSON del modelo. Probá de nuevo o acortá el texto."

        tags = _norm_tags([str(x) for x in (obj.get("tags") or []) if x is not None])
        pre: list[str] = []
        for it in obj.get("preflight") or []:
            if isinstance(it, str) and it.strip():
                pre.append(it.strip())
            elif isinstance(it, dict) and str(it.get("label", "")).strip():
                pre.append(str(it["label"]).strip())
        tasks: list[str] = []
        for it in obj.get("tasks") or []:
            if isinstance(it, str) and it.strip():
                tasks.append(it.strip())
            elif isinstance(it, dict) and str(it.get("title", "")).strip():
                tasks.append(str(it["title"]).strip())
        ritual = str(obj.get("ritual_notes", "") or "").strip()

        if not tasks:
            return None, "El modelo no devolvió tareas válidas. Reformulá la descripción."

        return (
            {
                "tags": tags,
                "preflight": pre[:12],
                "tasks": tasks[:16],
                "ritual_notes": ritual[:2000],
            },
            "",
        )
    except Exception as e:
        err = str(e)
        if len(err) > 220:
            err = err[:220] + "…"
        print(f"5S suggest_routine: {url} model={model} → {err}")
        return None, f"Ollama no disponible o error: {err}"


def new_project_from_template(
    template_id: str,
    name: str,
    workspace: dict[str, Any] | None = None,
    category_id: str | None = None,
) -> dict[str, Any] | None:
    ws = workspace or read_workspace()
    tpl = next((t for t in ws.get("templates", []) if t.get("id") == template_id), None)
    if not tpl:
        return None
    pid = f"p-{uuid.uuid4().hex[:12]}"
    ts = _now_iso()
    valid_cat = {
        str(c.get("id"))
        for c in (ws.get("categories") or [])
        if isinstance(c, dict) and c.get("id")
    }
    want = (category_id or "").strip()
    if want and want in valid_cat:
        resolved_category = want
    else:
        resolved_category = (tpl.get("category_id") or "").strip()

    def _steps(items, key_label="label"):
        out = []
        for it in items or []:
            if isinstance(it, dict):
                lab = (it.get(key_label) or it.get("label") or "").strip()
            else:
                lab = str(it).strip()
            if not lab:
                continue
            out.append(
                {
                    "id": f"pf-{uuid.uuid4().hex[:10]}",
                    "label": lab,
                    "done": False,
                    "assignee": (it.get("assignee") if isinstance(it, dict) else "") or "",
                }
            )
        return out

    tasks_out = []
    for i, it in enumerate(tpl.get("tasks") or []):
        title = (it.get("title") if isinstance(it, dict) else str(it)).strip()
        if not title:
            continue
        tasks_out.append(
            {
                "id": f"tk-{uuid.uuid4().hex[:10]}",
                "title": title,
                "status": "pending",
                "assignee": (it.get("assignee") if isinstance(it, dict) else "") or "",
                "blocked_reason": "",
                "order": i,
                "scope": "main",
            }
        )

    project = {
        "id": pid,
        "category_id": resolved_category,
        "template_id": tpl.get("id"),
        "name": name.strip() or tpl.get("name") or "Proyecto",
        "tags": [],
        "created_at": ts,
        "updated_at": ts,
        "preflight": _steps(tpl.get("preflight_steps")),
        "postflight": default_postflight_steps(),
        "tasks": tasks_out,
        "materials": [],
        "pantry": [],
        "shopping_list": [],
        "shopping_required": False,
        "routine_state": "pending",
        "recipe_notes": "",
        "schedules": [],
        "ritual_notes": (tpl.get("ritual_notes") or "").strip(),
    }
    projs = list(ws.get("projects", []))
    projs.append(project)
    ws["projects"] = projs
    ws["updated_at"] = _now_iso()
    return project


def save_wav_upload(file_storage) -> str:
    """
    Guarda un WAV subido. Retorna solo el nombre de archivo (uuid.wav).
    Valida cabecera RIFF/WAVE y tamaño máximo.
    """
    raw = file_storage.read(_MAX_WAV_BYTES + 1)
    if len(raw) > _MAX_WAV_BYTES:
        raise ValueError("archivo demasiado grande (máx 8MB)")
    if len(raw) < 12:
        raise ValueError("archivo vacío o inválido")
    if raw[:4] != b"RIFF" or raw[8:12] != b"WAVE":
        raise ValueError("no es un WAV válido (se espera RIFF/WAVE)")
    fname = f"{uuid.uuid4().hex}.wav"
    os.makedirs(CINCO_S_AUDIO_DIR, exist_ok=True)
    path = os.path.join(CINCO_S_AUDIO_DIR, fname)
    with open(path, "wb") as out:
        out.write(raw)
    return fname


def remove_project(workspace: dict[str, Any], project_id: str) -> bool:
    pid = str(project_id).strip()
    projs = list(workspace.get("projects") or [])
    new_projs = [p for p in projs if str(p.get("id")) != pid]
    if len(new_projs) == len(projs):
        return False
    workspace["projects"] = new_projs
    workspace["updated_at"] = _now_iso()
    return True


def remove_template(workspace: dict[str, Any], template_id: str) -> bool:
    tid = str(template_id).strip()
    tpls = list(workspace.get("templates") or [])
    new_tpls = [t for t in tpls if str(t.get("id")) != tid]
    if len(new_tpls) == len(tpls):
        return False
    workspace["templates"] = new_tpls
    workspace["updated_at"] = _now_iso()
    return True


def _normalize_template_steps(data: dict[str, Any], template_id: str) -> dict[str, Any] | None:
    """Construye dict plantilla desde JSON cliente; None si inválido."""
    name = str(data.get("name", "")).strip()
    if not name:
        return None
    cid = str(data.get("category_id", "")).strip()
    pre: list[dict[str, str]] = []
    for it in data.get("preflight_steps") or []:
        if isinstance(it, dict):
            lab = (it.get("label") or "").strip()
        else:
            lab = str(it).strip()
        if lab:
            pre.append({"label": lab, "assignee": (it.get("assignee") if isinstance(it, dict) else "") or ""})
    tasks: list[dict[str, str]] = []
    for it in data.get("tasks") or []:
        if isinstance(it, dict):
            title = (it.get("title") or "").strip()
        else:
            title = str(it).strip()
        if title:
            tasks.append({"title": title, "assignee": (it.get("assignee") if isinstance(it, dict) else "") or ""})
    return {
        "id": template_id,
        "category_id": cid,
        "name": name,
        "preflight_steps": pre,
        "tasks": tasks,
        "ritual_notes": str(data.get("ritual_notes", "")).strip(),
    }


def replace_template(workspace: dict[str, Any], template_id: str, data: dict[str, Any]) -> dict[str, Any] | None:
    tpls = list(workspace.get("templates") or [])
    idx = next((i for i, t in enumerate(tpls) if str(t.get("id")) == str(template_id)), -1)
    if idx < 0:
        return None
    old = tpls[idx]
    valid_cat = {str(c.get("id")) for c in (workspace.get("categories") or []) if isinstance(c, dict) and c.get("id")}
    merged = _normalize_template_steps(data, str(template_id))
    if not merged:
        return None
    if not merged["category_id"]:
        merged["category_id"] = str(old.get("category_id") or "")
    if merged["category_id"] not in valid_cat:
        return None
    tpls[idx] = merged
    workspace["templates"] = tpls
    workspace["updated_at"] = _now_iso()
    return write_workspace(workspace)


def append_template(workspace: dict[str, Any], data: dict[str, Any]) -> tuple[dict[str, Any] | None, str | None]:
    """Retorna (workspace_guardado, error)."""
    tid = str(data.get("id", "")).strip() or f"t-{uuid.uuid4().hex[:10]}"
    if any(str(t.get("id")) == tid for t in (workspace.get("templates") or [])):
        return None, "id de plantilla ya existe"
    merged = _normalize_template_steps({**data, "id": tid}, tid)
    if not merged:
        return None, "nombre requerido"
    valid_cat = {str(c.get("id")) for c in (workspace.get("categories") or []) if isinstance(c, dict) and c.get("id")}
    if not merged["category_id"] or merged["category_id"] not in valid_cat:
        return None, "category_id inválido"
    workspace.setdefault("templates", []).append(merged)
    workspace["updated_at"] = _now_iso()
    return write_workspace(workspace), None


def _5s_context_text(contexto: dict[str, Any] | None) -> str:
    if not contexto:
        return ""
    try:
        return json.dumps(contexto, ensure_ascii=False, indent=2)[:12000]
    except Exception:
        return str(contexto)[:8000]


def _ollama_base_url() -> str:
    return (
        os.getenv("AGENTE_5S_OLLAMA_URL", "").strip()
        or os.getenv("AGENTE_OLLAMA_URL", "").strip()
        or os.getenv("OLLAMA_BASE_URL", "").strip()
        or "http://127.0.0.1:11434"
    ).rstrip("/")


def _ollama_model_5s() -> str:
    return (os.getenv("AGENTE_5S_OLLAMA_MODEL") or "hugo-garcia:latest").strip()


def _asistente_5s_ollama(mensaje: str, ctx_txt: str) -> str | None:
    base = _ollama_base_url()
    model = _ollama_model_5s()
    system = """Sos Hugo García, asesor operativo de McKenna Group (Colombia).
Coacheás con la metodología 5S: Seiri (clasificar y quitar lo innecesario), Seiton (orden y ubicación),
Seiso (limpieza y detectar anomalías), Seiketsu (estándares visibles), Shitsuke (disciplina y hábito).
Respondé en español rioplatense/colombiano natural ("veci" si encaja), máximo ~900 caracteres, sin markdown pesado.
Priorizá: un solo siguiente paso concreto, seguridad, orden del espacio, y si hay checklist preflight o inventario mencionálos cuando aplique."""

    user = f"""Contexto JSON del tablero (puede estar vacío):
{ctx_txt or "(vacío)"}

Consulta del operario:
{mensaje}"""

    url = f"{base}/api/chat"
    try:
        r = requests.post(
            url,
            json={
                "model": model,
                "messages": [
                    {"role": "system", "content": system},
                    {"role": "user", "content": user},
                ],
                "stream": False,
                "options": {"temperature": 0.4},
            },
            timeout=180,
        )
        r.raise_for_status()
        data = r.json()
        msg = data.get("message") or {}
        texto = (msg.get("content") or "").strip()
        return texto[:4000] if texto else None
    except Exception as e:
        err = str(e)
        if len(err) > 200:
            err = err[:200] + "…"
        print(f"5S Ollama: {url} model={model} → {err}")
        return None


def _asistente_5s_gemini(mensaje: str, ctx_txt: str) -> str | None:
    api_key = os.getenv("GOOGLE_API_KEY", "").strip()
    if not api_key:
        return None
    try:
        from google import genai
    except ImportError:
        return None

    prompt = f"""Eres Hugo García, coach operativo McKenna Group. Metodología 5S:
Seiri, Seiton, Seiso, Seiketsu, Shitsuke.

Contexto JSON:
{ctx_txt}

Mensaje:
{mensaje}

Respuesta breve en español (Colombia), accionable, máximo ~800 caracteres."""

    client = genai.Client(api_key=api_key)
    for model_name in ("gemini-2.5-flash", "gemini-2.0-flash"):
        try:
            resp = client.models.generate_content(model=model_name, contents=prompt)
            texto = (resp.text or "").strip()
            if texto:
                return texto[:2000]
        except Exception:
            continue
    return None


def asistente_5s_detailed(mensaje: str, contexto: dict[str, Any] | None) -> dict[str, Any]:
    """
    Retorna: reply (str o vacío), provider ('ollama'|'gemini'|''), error (mensaje usuario).
    Orden según AGENTE_5S_LLM: ollama | gemini | auto (default auto = Ollama luego Gemini).
    """
    ctx_txt = _5s_context_text(contexto)
    mode = (os.getenv("AGENTE_5S_LLM") or "auto").strip().lower()
    if mode not in ("ollama", "gemini", "auto"):
        mode = "auto"

    def _ok(text: str | None, provider: str) -> dict[str, Any]:
        t = (text or "").strip()
        if not t:
            return {"reply": "", "provider": "", "error": ""}
        return {"reply": t, "provider": provider, "error": ""}

    if mode == "gemini":
        g = _asistente_5s_gemini(mensaje, ctx_txt)
        if g:
            return _ok(g, "gemini")
        return {
            "reply": "",
            "provider": "",
            "error": "Gemini no respondió o falta GOOGLE_API_KEY.",
        }

    if mode == "ollama":
        o = _asistente_5s_ollama(mensaje, ctx_txt)
        if o:
            return _ok(o, "ollama")
        return {
            "reply": "",
            "provider": "",
            "error": f"Ollama no disponible ({_ollama_base_url()}). ¿Modelo `{_ollama_model_5s()}` levantado?",
        }

    # auto
    o = _asistente_5s_ollama(mensaje, ctx_txt)
    if o:
        return _ok(o, "ollama")
    g = _asistente_5s_gemini(mensaje, ctx_txt)
    if g:
        return _ok(g, "gemini")
    return {
        "reply": "",
        "provider": "",
        "error": "Sin respuesta: revisá Ollama local o configurá GOOGLE_API_KEY para fallback Gemini.",
    }


def asistente_5s(mensaje: str, contexto: dict[str, Any] | None) -> str | None:
    """Compat: solo texto de respuesta o None."""
    out = asistente_5s_detailed(mensaje, contexto)
    r = (out.get("reply") or "").strip()
    return r if r else None
