from __future__ import annotations

import re
from typing import Any, Dict, List, Optional, Tuple

# Valores BR: 1.234,56 | 1234,56 | R$ 1.234,56
_RE_MONEY = re.compile(
    r"(?:R\$\s*)?(\d{1,3}(?:\.\d{3})*(?:,\d{1,2})?|\d+,\d{1,2})",
    re.IGNORECASE,
)

# Datas comuns em extratos / balancetes (bloqueiam heurística de %)
_RE_LINE_HAS_DATE = re.compile(
    r"\b\d{1,2}/\d{2,4}\b|\b\d{4}-\d{2}-\d{2}\b",
)

# Estrutura típica de lançamento (não é coluna de % de receita)
_RE_LANCAMENTO_HINT = re.compile(
    r"(débito|debito|boleto|\bpix\b|transferência|transferencia|"
    r"guia\b|doc\.|documento|nf-?e|\bnf\b|aut\.|\baut\b)",
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


def _money_spans_with_comma_decimal(line: str) -> List[Tuple[float, int, int, str]]:
    """
    Candidatos monetários que incluem vírgula decimal (evita '02' de datas em 02/2026).
    Usado só na heurística de [valor][%] no fim da linha.
    """
    out: List[Tuple[float, int, int, str]] = []
    for m in _RE_MONEY.finditer(line):
        g1 = m.group(1)
        if "," not in g1:
            continue
        val = _parse_br_float(g1)
        if val is None:
            continue
        out.append((val, m.start(), m.end(), g1))
    return out


def _raw_looks_like_resumo_line(raw: str) -> bool:
    clean = " ".join(raw.lower().split())
    return any(
        x in clean
        for x in (
            "saldo anterior",
            "saldo final",
            "sld ant",
            "sld atual",
            "saldo atual",
        )
    )


def _block_excludes_percentage(block: str) -> bool:
    return block in ("DESPESAS", "CONTAS", "RESUMO")


def _should_consider_receita_percent_heuristic(t: Dict[str, Any]) -> bool:
    """Só RECEITAS + ITEM (bloco explícito). Sem atalho só por llm_type."""
    raw = str(t.get("raw") or "")
    if _raw_looks_like_resumo_line(raw):
        return False
    block = str(t.get("block") or "")
    if _block_excludes_percentage(block):
        return False
    if block != "RECEITAS":
        return False
    typ = str(t.get("type") or "").upper()
    if typ != "ITEM":
        return False
    if t.get("valor") is None:
        return False
    return True


def is_percentage_context(raw: str, block: str) -> Tuple[bool, str]:
    """
    Contexto seguro para tratar o último número como % de composição (receitas tabulares).
    Todas as condições precisam passar.
    """
    if _block_excludes_percentage(block):
        return False, "block_not_receitas"
    if block != "RECEITAS":
        return False, "block_not_receitas"
    if "R$" in raw or "r$" in raw:
        return False, "has_rs"
    if _RE_LINE_HAS_DATE.search(raw):
        return False, "has_date"
    if _RE_LANCAMENTO_HINT.search(raw):
        return False, "lancamento_or_payment_hint"
    spans = _money_spans_with_comma_decimal(raw)
    if len(spans) != 2:
        return False, "not_exactly_two_comma_amounts"
    return True, "ok"


def _trailing_value_and_composition_percent(
    raw: str,
) -> Optional[Tuple[float, float, int]]:
    """
    Dois últimos números com vírgula no fim da linha; último em [0,100];
    penúltimo claramente montante vs. percentual (evita 1,00 + 42,36).
    """
    spans = _money_spans_with_comma_decimal(raw)
    if len(spans) < 2:
        return None
    if "R$" in raw or "r$" in raw:
        return None
    pen_val, pen_start, pen_end, _ = spans[-2]
    last_val, last_start, last_end, _ = spans[-1]
    if raw[last_end :].strip():
        return None
    between = raw[pen_end:last_start]
    if between.strip():
        return None
    if last_val < -1e-9 or last_val > 100.0 + 1e-6:
        return None
    if not (pen_val > last_val + 1e-9 or last_val >= 99.0 - 1e-9):
        return None
    # Último é quase sempre < 100% composto; exige razão mínima pen/último (exceto total 100,00)
    if last_val < 99.0 - 1e-9:
        if pen_val + 1e-9 < last_val * 3.0:
            return None
    sel_index = len(spans) - 2
    return (pen_val, last_val, sel_index)


def _last_comma_amount_value(raw: str) -> Optional[float]:
    spans = _money_spans_with_comma_decimal(raw)
    if not spans:
        return None
    return float(spans[-1][0])


def refine_trailing_composition_amounts(tokens: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """
    Em RECEITAS tabulares (DOM FELIPE e similares), valor = penúltimo e % = último.
    Em despesas com data / lançamento, força último valor com vírgula (corrige primeiro match ruim).
    """
    for t in tokens:
        raw = str(t.get("raw") or "")
        block = str(t.get("block") or "")
        typ = str(t.get("type") or "").upper()

        t["percentage_detected"] = False
        t["percentage_reason"] = ""
        t["rejected_percentage_reason"] = ""
        t["value_selection_strategy"] = "first_money"

        # Despesas: datas ou típico lançamento → último valor monetário (vírgula), nunca %.
        if (
            block == "DESPESAS"
            and typ == "ITEM"
            and (_RE_LINE_HAS_DATE.search(raw) or _RE_LANCAMENTO_HINT.search(raw))
        ):
            last_v = _last_comma_amount_value(raw)
            if last_v is not None:
                t["valor"] = last_v
                t["value_selection_strategy"] = "last_money_lancamento_line"
                t["rejected_percentage_reason"] = (
                    "despesa_data_ou_lancamento_usa_ultimo_valor"
                )
            else:
                t["rejected_percentage_reason"] = "despesa_lancamento_sem_valor_com_virgula"
            continue

        if not _should_consider_receita_percent_heuristic(t):
            if block in ("DESPESAS", "CONTAS", "RESUMO"):
                t["rejected_percentage_reason"] = "block_excludes_percentage"
            elif block != "RECEITAS":
                t["rejected_percentage_reason"] = "not_receitas_block"
            else:
                t["rejected_percentage_reason"] = "not_receitas_item_line"
            continue

        ok_ctx, ctx_reason = is_percentage_context(raw, block)
        if not ok_ctx:
            t["rejected_percentage_reason"] = ctx_reason
            t["percentage_reason"] = ""
            continue

        hit = _trailing_value_and_composition_percent(raw)
        if hit is None:
            t["rejected_percentage_reason"] = "trailing_pattern_mismatch"
            t["percentage_reason"] = ""
            continue

        pen_val, last_val, sel_index = hit
        t["valor"] = pen_val
        t["composition_percent"] = last_val
        t["secondary_amount"] = last_val
        t["selected_amount_index"] = sel_index
        t["value_selection_reason"] = "trailing_composition_percent"
        t["percentage_detected"] = True
        t["percentage_reason"] = ctx_reason
        t["rejected_percentage_reason"] = ""
        t["value_selection_strategy"] = "penultimate_amount_trailing_percent"

    return tokens


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
