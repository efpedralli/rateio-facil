from __future__ import annotations

import re
from typing import Any, Dict, List, Optional

# Valores BR: 1.234,56 | 1234,56 | R$ 1.234,56
_RE_MONEY = re.compile(
    r"(?:R\$\s*)?(\d{1,3}(?:\.\d{3})*(?:,\d{1,2})?|\d+,\d{1,2})",
    re.IGNORECASE,
)


def _parse_br_float(s: str) -> Optional[float]:
    s = s.strip()
    if not s:
        return None
    s = s.replace("R$", "").replace("r$", "").strip()
    if "," in s:
        s = s.replace(".", "").replace(",", ".")
    else:
        s = s.replace(".", "")
    try:
        return float(s)
    except ValueError:
        return None


def _first_money_value(line: str) -> Optional[float]:
    m = _RE_MONEY.search(line)
    if not m:
        return None
    return _parse_br_float(m.group(1))


def _count_money_tokens(line: str) -> int:
    return len(_RE_MONEY.findall(line))


def _is_mostly_upper(s: str) -> bool:
    letters = [c for c in s if c.isalpha()]
    if not letters:
        return False
    return sum(1 for c in letters if c.isupper()) / len(letters) > 0.75


def tokenize(lines: List[str]) -> List[Dict[str, Any]]:
    """Transforma linhas brutas em tokens com heurísticas de valor e formato."""
    out: List[Dict[str, Any]] = []
    for raw in lines:
        if not raw or not str(raw).strip():
            continue
        raw = str(raw).strip()
        clean = " ".join(raw.lower().split())
        valor = _first_money_value(raw)
        has_currency = "R$" in raw or "r$" in raw
        out.append(
            {
                "raw": raw,
                "clean": clean,
                "valor": valor,
                "money_count": _count_money_tokens(raw),
                "has_currency": has_currency,
                "is_upper": _is_mostly_upper(raw),
                "block": "UNKNOWN",
                "type": None,
            }
        )
    return out
