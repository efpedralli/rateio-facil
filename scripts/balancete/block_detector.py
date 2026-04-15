from __future__ import annotations

import re
from typing import Any, Dict, List, Optional, Tuple

# (regex sobre `clean` já em minúsculas, desde o início da linha, rótulo)
_HEADER_RULES: List[Tuple[str, str]] = [
    (r"^resumo\s+das\s+contas\b", "CONTAS"),
    (r"^contas\s+correntes\b", "CONTAS"),
    (r"^contas\b", "CONTAS"),
    (r"^resumo\s+do\s+m[eê]s\b", "RESUMO"),
    (r"^data\s+fornecedor\s*\(\s*\+\s*\)", "RECEITAS"),
    (r"^data\s+fornecedor\s*\(\s*-\s*\)", "DESPESAS"),
    (r"^receitas/hist[oó]rico\b", "RECEITAS"),
    (r"^despesas/hist[oó]rico\b", "DESPESAS"),
    (r"^receitas\b", "RECEITAS"),
    (r"^despesas\b", "DESPESAS"),
    (r"^resumo\b", "RESUMO"),
    (r"^saldo\s+anterior\b", "CONTAS"),
    # Orçamento / previsão (Aires): "Valores rateados na taxa de condomínio" => tratar como DESPESAS
    (r"^valores\s+rateados\s+na\s+taxa\s+de\s+condom[ií]nio\b", "DESPESAS"),
    (r"^classe\s+da\s+conta\s+valor\b", "DESPESAS"),
]


def is_strong_block_header(raw: str, clean: str) -> Optional[str]:
    """
    Cabeçalho forte de seção: só no início da linha (após normalizar espaços).
    Não dispara com 'receita' ou 'despesa' no meio da descrição (ex.: Receita Federal).
    """
    s = (clean or "").strip()
    if not s:
        return None
    for pat, label in _HEADER_RULES:
        if re.match(pat, s, re.IGNORECASE):
            return label
    return None


def detect_blocks(tokens: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """Atribui bloco só em cabeçalhos fortes; mantém contexto até o próximo."""
    current = "UNKNOWN"
    for t in tokens:
        clean = str(t.get("clean") or "")
        raw = str(t.get("raw") or "")
        hit = is_strong_block_header(raw, clean)
        if hit:
            current = hit
            t["block"] = hit
        else:
            t["block"] = current
    return tokens
