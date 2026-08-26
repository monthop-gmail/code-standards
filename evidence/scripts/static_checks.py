#!/usr/bin/env python3
"""Mechanical evidence-gathering for the greppable assertions.

ไม่ได้ตัดสินผ่าน/ไม่ผ่านเอง — คืน 'หลักฐาน' ให้ grader ใช้ประกอบ เพราะบางเคส
(เช่น string ที่หน้าตาเหมือน secret แต่อยู่ใน .env.example) ต้องใช้วิจารณญาณ
"""
import json, re, sys
from pathlib import Path

CODE_EXT = {".js", ".ts", ".tsx", ".mjs", ".cjs", ".py", ".sql"}
SKIP_DIR = {"node_modules", ".git", "dist", "build", "__pycache__", ".venv"}

PATTERNS = {
    "hardcoded_secret": r"""(password|passwd|api[_-]?key|secret|token|dsn)\s*[:=]\s*['"][^'"\s]{6,}['"]""",
    "string_concat_sql": r"""(SELECT|INSERT|UPDATE|DELETE)[^\n;]*['"]\s*\+|\+\s*['"][^\n]*(WHERE|VALUES)""",
    "fstring_sql": r"""(execute|query)\s*\(\s*f['"]""",
    "empty_catch": r"""catch\s*(\([^)]*\))?\s*\{\s*\}|except[^\n:]*:\s*(pass|\.\.\.)\s*$""",
    "todo_placeholder": r"""\b(TODO|FIXME|XXX|not implemented|NotImplemented)\b""",
    "ts_any": r""":\s*any\b|<any>|as any\b""",
    "await_in_loop": r"""for\s*\([^)]*\)\s*\{[^}]*await """,
    "env_usage": r"""process\.env\.|os\.environ|os\.getenv|getenv\(""",
    "param_query": r"""\?\s*[,)]|\$\d|%s|:\w+\s*[,)}]""",
    "decimal_money": r"""\bDecimal\b|NUMERIC|::numeric""",
    "float_money": r"""\bfloat\(|\bparseFloat\(""",
    "group_by": r"""\bGROUP\s+BY\b""",
    "context_manager": r"""\bwith\s+\w+.*:|finally\s*:|\.close\(\)""",
    "zod_schema": r"""\bz\.object\(|\bzod\b|class-validator|joi\.""",
    "signature_verify": r"""(verify|hmac|createHmac|timingSafeEqual|signature)""",
    "idempotency": r"""idempoten|already[_ ]?processed|ON CONFLICT|event_id|dedup""",
    "transaction": r"""BEGIN\b|\.transaction\(|START TRANSACTION|COMMIT\b""",
    "http_status": r"""\.status\(\s*(400|401|403|404|409|422|500)""",
    "over_abstraction": r"""\babstract\s+class\b|\bContainer\b|inversify|tsyringe|@[Ii]njectable""",
    "type_hint_py": r"""def\s+\w+\([^)]*\)\s*->""",
    "docstring_py": r'''"""''',
}

def files(root: Path):
    for p in sorted(root.rglob("*")):
        if p.is_file() and p.suffix in CODE_EXT and not (SKIP_DIR & set(p.parts)):
            yield p

def scan(root: Path) -> dict:
    root = Path(root)
    out = {"root": str(root), "files": [], "hits": {k: [] for k in PATTERNS}}
    if not root.exists():
        out["error"] = "missing"
        return out
    for p in files(root):
        rel = str(p.relative_to(root))
        text = p.read_text(errors="replace")
        out["files"].append({"path": rel, "lines": text.count("\n") + 1})
        for name, pat in PATTERNS.items():
            for m in re.finditer(pat, text, re.I | re.M):
                line = text[: m.start()].count("\n") + 1
                snippet = text.splitlines()[line - 1].strip()[:160]
                out["hits"][name].append({"file": rel, "line": line, "snippet": snippet})
    out["all_files"] = sorted(
        str(p.relative_to(root)) for p in root.rglob("*")
        if p.is_file() and not (SKIP_DIR & set(p.parts))
    )
    return out

if __name__ == "__main__":
    print(json.dumps(scan(Path(sys.argv[1])), ensure_ascii=False, indent=2))
