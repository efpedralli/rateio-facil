from __future__ import annotations

from typing import Any, Dict, List, Tuple

# (rótulo bloco, palavras-chave na linha já normalizada)
_RULES: List[Tuple[str, Tuple[str, ...]]] = [
    (
        "RECEITAS",
        ("receita", "receitas", "créditos", "creditos", "entradas"),
    ),
    (
        "DESPESAS",
        ("despesa", "despesas", "débitos", "debitos", "saídas", "saidas"),
    ),
    ("RESUMO", ("resumo", "saldo", "resultado")),
    (
        "CONTAS",
        ("conta", "banco", "corrente", "aplicação", "aplicacao"),
    ),
]


def _match_block(clean: str) -> str | None:
    for label, keys in _RULES:
        if any(k in clean for k in keys):
            return label
    return None


def detect_blocks(tokens: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """Atribui bloco semântico por cabeçalhos; mantém contexto até o próximo cabeçalho."""
    current = "UNKNOWN"
    for t in tokens:
        hit = _match_block(t.get("clean") or "")
        if hit:
            current = hit
            t["block"] = hit
        else:
            t["block"] = current
    return tokens
