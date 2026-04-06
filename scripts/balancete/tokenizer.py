from __future__ import annotations

import re
from typing import Any, Dict, List, Optional, Tuple

# Datas com ano ou dia/mês/ano (exclui parcela curta 04/06 em "P. 04/06")
_RE_LINE_HAS_DATE = re.compile(
    r"\b\d{1,2}/\d{1,2}/\d{4}\b|\b\d{1,2}/\d{4}\b|\b\d{4}-\d{2}-\d{2}\b",
)

_RE_LANCAMENTO_HINT = re.compile(
    r"(débito|debito|boleto|\bpix\b|transferência|transferencia|"
    r"guia\b|doc\.|documento|nf-?e|\bnf\b|aut\.|\baut\b)",
    re.IGNORECASE,
)

# Montante BR com vírgula decimal obrigatória (rejeita inteiros tipo 8301)
_RE_REL_MONEY = re.compile(
    r"(?:R\$\s*)?(\d{1,3}(?:\.\d{3})+,\d{2}|\d+,\d{2})\b",
    re.IGNORECASE,
)

# Código de pagamento/documento + valor BR (não juntar com heurística de milhar OCR).
_RE_PAYMENT_CODE_THEN_BR_MONEY = re.compile(
    r"(?i)\b(?:pix|boleto|guia|débito|debito|transferência|transferencia|"
    r"aut\.?|nf|nota)\b\s+(\d+)\s+(\d{1,3}(?:\.\d{3})*,\d{2})\b",
)

# Caractere PUA: não é \s; impede merge "492 310,00" -> "492.310,00" durante pre_normalize.
_PAYMENT_CODE_VALUE_MERGE_GUARD = "\ue000"


def _shield_payment_code_value_splits(s: str) -> str:
    """Evita fundir código numérico do meio de pagamento com o valor real na mesma linha."""
    out: List[str] = []
    pos = 0
    for m in _RE_PAYMENT_CODE_THEN_BR_MONEY.finditer(s):
        out.append(s[pos : m.start()])
        out.append(s[m.start() : m.start(1)])
        out.append(m.group(1))
        out.append(_PAYMENT_CODE_VALUE_MERGE_GUARD)
        out.append(m.group(2))
        pos = m.end()
    out.append(s[pos:])
    return "".join(out)


def _unshield_payment_code_value_splits(s: str) -> str:
    return s.replace(_PAYMENT_CODE_VALUE_MERGE_GUARD, " ")


def _normalize_ocr_broken_money(raw: str) -> str:
    """
    Recompõe dígitos partidos por espaço logo após R$ (OCR).
    Só altera trechos `R$ …`; datas e códigos fora desse contexto permanecem iguais.
    Ex.: R$ 4 4,00 -> R$ 44,00 ; R$ 6 4.681,71 -> R$ 64.681,71
    """
    s = raw
    while True:
        prev = s
        # Mais específico primeiro (milhares com pontos, depois xxx,dd, depois x,dd)
        s = re.sub(
            r"(R\$\s*)(\d)\s+(\d{1,3}\.\d{3},\d{2}\b)",
            r"\1\2\3",
            s,
            flags=re.IGNORECASE,
        )
        s = re.sub(
            r"(R\$\s*)(\d)\s+(\d{3},\d{2}\b)",
            r"\1\2\3",
            s,
            flags=re.IGNORECASE,
        )
        s = re.sub(
            r"(R\$\s*)(\d)\s+(\d,\d{2}\b)",
            r"\1\2\3",
            s,
            flags=re.IGNORECASE,
        )
        if s == prev:
            break
    return s


def pre_normalize_line_for_ocr(line: str) -> str:
    """
    Recompõe valores quebrados por OCR (espaço antes do separador de milhar).
    Preserva datas com barras.
    """
    s = line
    s = _shield_payment_code_value_splits(s)
    s = re.sub(
        r"(R\$\s*)(\d{1,3})\s+\.(\d{3},\d{2}\b)",
        r"\1\2.\3",
        s,
        flags=re.IGNORECASE,
    )
    s = re.sub(
        r"(R\$\s*)(\d{1,3})\s+(\d{3},\d{2}\b)",
        r"\1\2.\3",
        s,
        flags=re.IGNORECASE,
    )
    # Não juntar se vier após vírgula (centavos do valor anterior), barra (data) ou dígito:
    # evita "...,10 100,00" -> "10.100,00" ou "2026 820,02" -> "6.820,02".
    _no_merge_before = r"(?<![,/\d])"
    s = re.sub(
        _no_merge_before + r"(\d{1,3})\s+\.(\d{3},\d{2}\b)",
        r"\1.\2",
        s,
    )
    s = re.sub(
        _no_merge_before + r"(\d{1,3})\s+(\d{3},\d{2}\b)",
        r"\1.\2",
        s,
    )
    s = _unshield_payment_code_value_splits(s)
    return s


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


def reliable_comma_money_spans(line: str) -> List[Tuple[float, int, int, str]]:
    """
    Candidatos monetários com vírgula decimal (1.234,56 ou 123,45 ou R$ ...).
    Ignora trechos imediatamente precedidos por '/' (evita ruído colado a datas).
    """
    out: List[Tuple[float, int, int, str]] = []
    for m in _RE_REL_MONEY.finditer(line):
        start, end = m.start(), m.end()
        if start > 0 and line[start - 1] == "/":
            continue
        g1 = m.group(1)
        val = _parse_br_float(g1)
        if val is None:
            continue
        out.append((val, start, end, g1))
    return out


def _select_initial_valor_from_spans(
    raw: str, spans: List[Tuple[float, int, int, str]]
) -> Tuple[Optional[float], str]:
    """Estratégia padrão: último candidato confiável (evita datas/refs no início)."""
    if not spans:
        return None, "no_reliable_span"
    if len(spans) == 1:
        return float(spans[0][0]), "single_reliable_comma_amount"
    return float(spans[-1][0]), "last_reliable_comma_amount"


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


def _money_spans_with_comma_decimal(line: str) -> List[Tuple[float, int, int, str]]:
    return reliable_comma_money_spans(line)


def _trailing_value_and_composition_percent(
    raw: str,
) -> Optional[Tuple[float, float, int]]:
    spans = _money_spans_with_comma_decimal(raw)
    if len(spans) < 2:
        return None
    if "R$" in raw or "r$" in raw:
        return None
    pen_val, pen_start, pen_end, _ = spans[-2]
    last_val, last_start, last_end, _ = spans[-1]
    if raw[last_end:].strip():
        return None
    between = raw[pen_end:last_start]
    if between.strip():
        return None
    if last_val < -1e-9 or last_val > 100.0 + 1e-6:
        return None
    if not (pen_val > last_val + 1e-9 or last_val >= 99.0 - 1e-9):
        return None
    if last_val < 99.0 - 1e-9:
        if pen_val + 1e-9 < last_val * 3.0:
            return None
    sel_index = len(spans) - 2
    return (pen_val, last_val, sel_index)


def refine_trailing_composition_amounts(tokens: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    for t in tokens:
        raw = str(t.get("raw") or "")
        block = str(t.get("block") or "")
        typ = str(t.get("type") or "").upper()

        t["percentage_detected"] = False
        t["percentage_reason"] = ""
        t["rejected_percentage_reason"] = ""
        t["value_selection_strategy"] = str(
            t.get("value_selection_strategy") or "last_reliable_comma"
        )

        # Despesas: sempre último montante confiável (vírgula), nunca %.
        if block == "DESPESAS" and typ == "ITEM":
            spans = reliable_comma_money_spans(raw)
            if spans:
                t["valor"] = float(spans[-1][0])
                t["value_selection_strategy"] = "despesa_last_reliable_amount"
                t["rejected_percentage_reason"] = "despesa_forca_ultimo_montante"
            else:
                t["rejected_percentage_reason"] = "despesa_sem_montante_com_virgula"
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
    """Linhas já pré-normalizadas (OCR) em parse_balancete; extrai valor por candidatos confiáveis."""
    out: List[Dict[str, Any]] = []
    for raw in lines:
        if not raw or not str(raw).strip():
            continue
        raw = str(raw).strip()
        raw = _normalize_ocr_broken_money(raw)
        clean = " ".join(raw.lower().split())
        spans = reliable_comma_money_spans(raw)
        valor, strat = _select_initial_valor_from_spans(raw, spans)
        has_currency = "R$" in raw or "r$" in raw
        out.append(
            {
                "raw": raw,
                "clean": clean,
                "valor": valor,
                "money_count": len(spans),
                "has_currency": has_currency,
                "is_upper": _is_mostly_upper(raw),
                "block": "UNKNOWN",
                "type": None,
                "value_selection_strategy": strat,
            }
        )
    return out
