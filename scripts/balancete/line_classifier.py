from __future__ import annotations

import re
from typing import Any, Dict, List

# Linha de extrato numerado (ex.: "01 - Saldo Anterior 8.302,37")
_RE_CONTA_NUMERADA = re.compile(r"^\d{1,2}\s*-\s*")

# Totais de seção — evita "total" como substring de "Manutenção", nomes de empresa, etc.
_TOTAL_LINE_HINT = re.compile(
    r"(?is)^(total\s*[:\.]|total\s+de\s+receitas|total\s+de\s+despesas|"
    r"subtotal|total\s+geral|total\s+grupo|total\s*\()"
)
# Belle / Sicredi: "... - Total Grupo R$ ..." (total não está no início da linha)
_TOTAL_LINE_INLINE = re.compile(r"(?is)\b(total\s+grupo|total\s+geral|subtotal)\b")

_STRONG_CONTA_KEYS = (
    "saldo anterior",
    "saldo atual",
    "saldo final",
    "créditos",
    "creditos",
    "débitos",
    "debitos",
    "transferência",
    "transferencia",
    "conta movimento",
    "conta corrente",
    "fundo reserva",
    "capital social",
)

# Receitas financeiras: mencionam banco/aplicação mas são lançamento de receita, não extrato de conta
_RECEITA_FINANCEIRA_KEYS = (
    "rendimento",
    "juros",
    "poupança",
    "poupanca",
    "resgate",
    "aplicação financeira",
    "aplicacao financeira",
    "receita financeira",
    "irrf de aplicação",
    "irrf de aplicacao",
    "provisionado",
)


def _strong_conta_indicators(clean: str) -> bool:
    low = (clean or "").lower()
    return any(k in low for k in _STRONG_CONTA_KEYS)


def _receita_financeira_like(clean: str, raw: str) -> bool:
    low = f"{clean or ''} {raw or ''}".lower()
    return any(k in low for k in _RECEITA_FINANCEIRA_KEYS)


def classify_lines(tokens: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """Define type: ITEM | CATEGORY | TOTAL | RESUMO | CONTA."""
    for t in tokens:
        raw = t.get("raw") or ""
        clean = t.get("clean") or ""
        valor = t.get("valor")
        money_count = int(t.get("money_count") or 0)
        block = str(t.get("block") or "UNKNOWN")

        cl = (clean or "").strip()
        if _TOTAL_LINE_HINT.match(cl):
            t["type"] = "TOTAL"
            continue
        if _TOTAL_LINE_INLINE.search(cl):
            t["type"] = "TOTAL"
            continue

        # Receitas financeiras no bloco RECEITAS: nunca tratar como CONTA só por nome de banco
        if (
            block == "RECEITAS"
            and valor is not None
            and _receita_financeira_like(clean, raw)
        ):
            t["type"] = "ITEM"
            continue

        # Bloco CONTAS: movimentação / posição bancária
        if block == "CONTAS":
            if valor is not None and _RE_CONTA_NUMERADA.match(clean.strip()):
                t["type"] = "CONTA"
                continue
            if money_count >= 2:
                t["type"] = "CONTA"
                continue
            if valor is not None and _strong_conta_indicators(clean):
                t["type"] = "CONTA"
                continue
            if valor is not None:
                t["type"] = "CONTA"
                continue

        # Resumo do mês / saldos fora de extrato numerado de contas
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

        # DESPESAS / RECEITAS: não promover a CONTA por palavras de banco (heurística antiga removida)

        if valor is not None:
            t["type"] = "ITEM"
            continue

        if t.get("is_upper") and len(clean) >= 3 and len(clean) < 120:
            t["type"] = "CATEGORY"
            continue

        t["type"] = "CATEGORY"

    return tokens
