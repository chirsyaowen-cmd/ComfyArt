import hashlib
import json
import re
import time
import uuid
from contextlib import contextmanager
from pathlib import Path

from sqlalchemy import func, or_, select, text, update

from . import db
from ._common import app_path
from .settings import get_setting

MIGRATION = "project-memory-v1"
CATEGORIES = {"about", "taste", "work", "assets"}
# Old title notes should never supersede the live project name.
TITLE_NOTE = re.compile(r"^\s*(?:(?:当前|本)?(?:作品|项目|小志)(?:的)?(?:名称|名|标题)|(?:artwork|project|zine)\s+(?:name|title))\s*[:：]", re.I)


GLOBAL_INTENT = re.compile(r"所有项目|各个项目|跨项目|全局|以后都|all (?:my |future )?projects|across projects|globally", re.I)


def explicit_global_request(blocks, args):
    quote, value = args.get("global_request"), args.get("text")
    if not isinstance(quote, str) or not isinstance(value, str) or not value.strip():
        return False
    if not GLOBAL_INTENT.search(quote) or value.strip().strip("。.!！") not in quote:
        return False
    user_text = "\n".join(b.get("text", "") for b in blocks if b.get("type") == "text")
    return quote in user_text and not re.search(r"仅当前|仅本|只在|不要|不希望|only this|not across|never", user_text, re.I)


def _now():
    return int(time.time() * 1000)


def _scope(table, user, project):
    return (table.user == user, or_(table.scope == "global", (table.scope == "project") & (table.project == project)))


def _event(s, user, project, scope, action, value, source, at=None):
    s.add(db.MemoryEvent(user=user, project=project, scope=scope, time=at if at is not None else _now(),
                         action=action, text=value, source=source))


def _legacy_file(name):
    path = Path(app_path("userdata", "comfyart", name))
    if not path.exists():
        return []
    data = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(data, list):
        raise ValueError("Invalid legacy memory file: " + name)
    return [r for r in data if isinstance(r, dict)]


def _legacy_origins(s, user):
    # Recover provenance from successful write calls, never from another chat
    # merely mentioning or reading the same title.
    origins = {}
    rows = s.execute(select(db.Chat.project, db.Message).join(db.Message, db.Message.chat_id == db.Chat.id)
                     .where(db.Chat.user == user, db.Message.role == "assistant", db.Message.blocks.contains("memory")))
    for project, msg in rows:
        calls = {}
        for block in json.loads(msg.blocks):
            if block.get("name", "").split("__")[-1] != "memory":
                continue
            if block.get("type") == "tool_use":
                args = block.get("input") or {}
                calls[block.get("id")] = (args.get("text") if args.get("action") == "add" else
                                          args.get("new") if args.get("action") == "correct" else None)
            elif block.get("type") == "tool_result" and block.get("status") == "success":
                value = calls.pop(block.get("id"), None)
                if isinstance(value, str):
                    origins.setdefault(value.strip(), set()).add((project, msg.parent_id))
    return origins


def migrate(s, user):
    if s.get(db.Migration, (user, MIGRATION)):
        return
    entries = _legacy_file("memory.json") if user == "default" else []
    origins = _legacy_origins(s, user) if entries else {}
    for row in entries:
        value = row.get("text")
        if not isinstance(value, str) or not value.strip():
            continue
        value = value.strip()
        matches = origins.get(value, set())
        projects = {project for project, _ in matches}
        project = next(iter(projects)) if len(projects) == 1 else None
        if project and not s.get(db.Project, (user, project)):
            project = None
        scope = "project" if project and not TITLE_NOTE.match(value) else "legacy"
        s.add(db.Memory(id=uuid.uuid4().hex, user=user, scope=scope, project=project if scope == "project" else None,
                        text=value, category=row.get("category") or "about", time=row.get("time") or 0,
                        source_message_id=next(iter(matches))[1] if len(matches) == 1 else None))
    for row in (_legacy_file("memory-log.json") if user == "default" else []):
        if row.get("action") in {"add", "update", "forget", "skill"} and isinstance(row.get("text"), str):
            _event(s, user, None, "legacy", row["action"], row["text"], row.get("source", ""), row.get("time", 0))
    s.add(db.Migration(user=user, name=MIGRATION, done_at=time.time()))
    s.flush()


@contextmanager
def transaction(user):
    with db.session() as s:
        s.execute(text("BEGIN IMMEDIATE"))
        migrate(s, user)
        yield s
        s.commit()


def _entry(m):
    row = {k: getattr(m, k) for k in ("id", "scope", "project", "text", "category", "time", "source_message_id")}
    if m.scope == "legacy":
        row["can_assign"] = not bool(TITLE_NOTE.match(m.text))
    return row


def _items(s, user, project):
    return list(s.scalars(select(db.Memory).where(*_scope(db.Memory, user, project)).order_by(db.Memory.time, db.Memory.id)))


def listing(user, project, *, management=False):
    with transaction(user) as s:
        result = {"memories": [_entry(m) for m in _items(s, user, project)]}
        if management:
            result["legacy"] = [_entry(m) for m in s.scalars(select(db.Memory).where(db.Memory.user == user, db.Memory.scope == "legacy"))]
            events = s.scalars(select(db.MemoryEvent).where(db.MemoryEvent.user == user, or_(
                db.MemoryEvent.scope.in_(("legacy", "global")), db.MemoryEvent.project == project))
                .order_by(db.MemoryEvent.time.desc(), db.MemoryEvent.seq.desc()).limit(200))
            result["log"] = [{k: getattr(e, k) for k in ("time", "text", "source", "action", "scope")} for e in events]
        return result


def mutate(user, project, args, *, source, message_id=None, management=False, automatic=False):
    action = args.get("action")
    scope = args.get("scope", "project")
    if scope not in ("project", "global") or not project:
        raise ValueError("Choose a project or global scope")
    value = args.get("text", "")
    if action in ("add", "correct", "skill") and (not isinstance(value, str) or not value.strip()):
        raise ValueError("Memory text required")
    with transaction(user) as s:
        if message_id:
            if not isinstance(message_id, str):
                raise ValueError("Invalid source message")
            msg = s.scalar(select(db.Message).where(db.Message.id == message_id))
            chat = msg and s.get(db.Chat, msg.chat_id)
            if not chat or chat.user != user or chat.project != project or msg.role != "user":
                raise ValueError("Memory source is outside this project")
            if automatic and scope == "global" and not explicit_global_request(json.loads(msg.blocks), args):
                scope = "project"
        owner = project if scope == "project" else None
        if action == "skill" and management:
            _event(s, user, project, "project", "skill", value.strip(), source)
            return {"ok": True}
        if action == "add":
            category = args.get("category") or "about"
            if not isinstance(category, str) or category not in CATEGORIES:
                raise ValueError("Unknown memory category")
            value = value.strip()
            if TITLE_NOTE.match(value):
                raise ValueError("The project name is stored on the project. Rename it in the project header.")
            existing = s.scalar(select(db.Memory).where(db.Memory.user == user, db.Memory.scope == scope,
                                db.Memory.project == owner, db.Memory.text == value))
            if existing:
                return _entry(existing)
            m = db.Memory(id=uuid.uuid4().hex, user=user, project=owner, scope=scope, text=value,
                          category=category, time=_now(), source_message_id=message_id)
            s.add(m)
        else:
            m = s.get(db.Memory, args.get("id")) if isinstance(args.get("id"), str) else None
            if not m or m.user != user or (m.scope == "legacy" and not management) or (m.project and m.project != project):
                raise ValueError("Unknown memory ID in this project")
            if action == "forget":
                _event(s, user, m.project, m.scope, "forget", m.text, source)
                s.delete(m)
                return {"forgotten": m.id}
            if action == "assign" and management and m.scope == "legacy" and not TITLE_NOTE.match(m.text):
                m.scope, m.project = scope, owner
            elif action == "correct" and not TITLE_NOTE.match(value.strip()):
                m.text = value.strip()
            else:
                raise ValueError("Unsupported memory change")
            m.time = _now()
            if message_id:
                m.source_message_id = message_id
        _event(s, user, m.project, m.scope, "add" if action == "add" else "update", m.text, source)
        return _entry(m)


def retire_legacy_zine_sessions(s, user):
    migration = "retire-zine-roadmap-context"
    if s.get(db.Migration, (user, migration)):
        return
    # Provider sessions keep the previous tool results, even when a tool is removed.
    candidates = s.execute(select(db.Message.chat_id, db.Message.blocks)
                           .join(db.Chat, db.Chat.id == db.Message.chat_id)
                           .where(db.Chat.user == user, db.Message.role == "user",
                                  db.Message.blocks.contains("roadmap_turn")))
    affected = {chat_id for chat_id, blocks in candidates
                if any(b.get("type") == "roadmap_turn" for b in json.loads(blocks))}
    if affected:
        s.execute(update(db.Chat).where(db.Chat.id.in_(affected)).values(resume_token=None))
        s.execute(update(db.Message).where(db.Message.chat_id.in_(affected)).values(resume_token_after=None))
    s.add(db.Migration(user=user, name=migration, done_at=time.time()))


def turn_context(chat, prompt):
    user, project = chat["user"], chat["project"]
    with transaction(user) as s:
        saved = s.get(db.Project, (user, project))
        memories = _items(s, user, project) if get_setting("memory-enabled") else []
        context = {"project_name": saved.name if saved else "", "project_notes": [], "global_preferences": []}
        for m in memories:
            context["global_preferences" if m.scope == "global" else "project_notes"].append(m.text)
        header = json.dumps(context, ensure_ascii=False)
        retire_legacy_zine_sessions(s, user)
        token = s.scalar(select(db.Chat.resume_token).where(db.Chat.id == chat["id"]))
        if chat["provider"] == "deepseek-harness":
            # A transient note may have been read by a tool and deleted within the
            # same turn. The next prompt can match byte-for-byte while that session is stale.
            version = s.scalar(select(func.max(db.MemoryEvent.seq)).where(
                *_scope(db.MemoryEvent, user, project), db.MemoryEvent.action != "skill"))
            digest = hashlib.sha256(f"{version}:{header}".encode()).hexdigest()
            last = s.get(db.ChatMemoryContext, chat["id"])
            if not last or last.digest != digest:
                # Old sessions may contain injected notes in the provider transcript.
                # Do not delete visible messages or replay old assistant/tool output.
                s.execute(update(db.Chat).where(db.Chat.id == chat["id"]).values(resume_token=None))
                s.execute(update(db.Message).where(db.Message.chat_id == chat["id"]).values(resume_token_after=None))
                s.merge(db.ChatMemoryContext(chat_id=chat["id"], digest=digest))
                token = None
        return ("Current project context. Use the name only for identification. "
                "Project notes apply only to this project.\n" + header + "\n\n" + prompt
                if any(context.values()) else prompt), token
