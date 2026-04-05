from __future__ import annotations

import re
from typing import Any, Dict, List

_RE_CONTA_HINT = re.compile(
    r"\b(banco|bradesco|itau|itaú|caixa|santander|bb\b|nubank|corrente|aplica)\b",
    re.IGNORECASE,
)


def classify_lines(tokens: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """Define type: ITEM | CATEGORY | TOTAL | RESUMO | CONTA."""
    for t in tokens:
        raw = t.get("raw") or ""
        clean = t.get("clean") or ""
        valor = t.get("valor")
        money_count = int(t.get("money_count") or 0)

        if "total" in clean:
            t["type"] = "TOTAL"
            continue

        if any(
            x in clean
            for x in (
                "saldo anterior",
                "saldo final",
                "sld ant",
                "sld atual",
                "saldo atual",
            )
        ):
            t["type"] = "RESUMO"
            continue

        if t.get("block") == "CONTAS" or _RE_CONTA_HINT.search(raw):
            if money_count >= 2 or (valor is not None and _RE_CONTA_HINT.search(raw)):
                t["type"] = "CONTA"
                continue

        if valor is not None:
            t["type"] = "ITEM"
            continue

        if t.get("is_upper") and len(clean) >= 3 and len(clean) < 120:
            t["type"] = "CATEGORY"
            continue

        t["type"] = "CATEGORY"

    return tokens
