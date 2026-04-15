from __future__ import annotations

import re
from typing import Any, Dict, List

import unicodedata

from text_repair import normalize_extracted_text

# Linha de extrato numerado (ex.: "01 - Saldo Anterior 8.302,37")
_RE_CONTA_NUMERADA = re.compile(r"^\d{1,2}\s*-\s*")

# Totais de seção — evita "total" como substring de "Manutenção", nomes de empresa, etc.
_TOTAL_LINE_HINT = re.compile(
    r"(?is)^(total\s*[:\.]|total\s+de\s+receitas|total\s+de\s+despesas|"
    r"subtotal|total\s+geral|total\s+grupo|total\s*\(|"
    r"total\s+da\s+previs[aã]o\s+de\s+or[cç]amento)"
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

_KNOWN_SECTION_TITLES = (
    # Chelsea (casos reportados)
    "encargos sociais / impostos / taxas",
    "manutenção e conservação",
    "serviços públicos",
    "servicos publicos",
    "serviços financeiros",
    "servicos financeiros",
    "despesas administrativas",
    "despesas extraordinárias",
    "despesas extraordinarias",
    "outros",
    # comuns
    "receitas",
    "despesas",
    "resumo",
    "contas correntes",
    "contas poupança",
    "contas poupanca",
)

# Títulos curtos (sem valor) que tipicamente são cabeçalho de seção/grupo.
_RE_SECTION_HEADER_HINT = re.compile(
    r"(?is)^(?:"
    r"encargos\s+sociais|"
    r"manuten|"
    r"servi[cç]os?\s+p[úu]blic|"
    r"servi[cç]os?\s+financeir|"
    r"despesas?\s+administrativ|"
    r"despesas?\s+extraordin|"
    r"outros"
    r")\b"
)

_RE_BAD_GROUP_LINE = re.compile(
    r"(?is)^(?:"
    r"\(\-\)\s*DO\b|"
    r"(?:DO|DA|DE)\s+CONDOM[IÍ]NIO\)?\s*$|"
    r"CONDOM[IÍ]NIO\)?\s*$|"
    r"MERCADO\s+DO\s+CONDOM[IÍ]NIO\)?\s*$|"
    r"AUTOM[ÁA]TICO\)?\s*$|"
    r"D[ÉE]BITO\s+AUTOM[ÁA]TICO\)?\s*$|"
    r"FACIL\)?\s*$"
    r")"
)

_RE_MONEY_ONLY_RAW = re.compile(r"(?is)^\s*(?:R\$\s*)?[\d\.\-]+,\d{2}\s*$")

def _strip_accents(s: str) -> str:
    return "".join(c for c in unicodedata.normalize("NFD", s) if unicodedata.category(c) != "Mn")


def _loose_key(s: str) -> str:
    """
    Normalização tolerante para comparar títulos mesmo com caracteres quebrados:
    - normaliza/trim
    - remove '�'
    - remove acentos
    - baixa caixa e colapsa espaços
    """
    t = normalize_extracted_text(s or "", warn_context="loose_key")
    t = t.replace("\ufffd", "")
    t = _strip_accents(t).lower()
    t = " ".join(t.split()).strip()
    return t

def _looks_like_section_header_loose(tail: str) -> bool:
    """Detecção tolerante para título quando OCR/encoding quebra letras."""
    k = _loose_key(tail)
    if not k:
        return False
    return (
        k.startswith("encargos sociais")
        or k.startswith("manuten")  # manutençao/manuteno/manuten…
        or k.startswith("servicos public")
        or k.startswith("servicos financeir")
        or k.startswith("despesas administr")
        or k.startswith("despesas extraord")
        or k.startswith("outros")
    )


def _strong_conta_indicators(clean: str) -> bool:
    low = (clean or "").lower()
    return any(k in low for k in _STRONG_CONTA_KEYS)


def _receita_financeira_like(clean: str, raw: str) -> bool:
    low = f"{clean or ''} {raw or ''}".lower()
    return any(k in low for k in _RECEITA_FINANCEIRA_KEYS)


def classify_lines(tokens: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """Define type: ITEM | CATEGORY | CONTINUATION | TOTAL | RESUMO | CONTA.

    Regras:
    - ITEM só quando houver valor monetário real (token['valor'] != None)
    - Linhas sem valor e que não sejam título de seção/subtotal/total viram CONTINUATION
    """
    for t in tokens:
        raw = t.get("raw") or ""
        clean = t.get("clean") or ""
        valor = t.get("valor")
        money_count = int(t.get("money_count") or 0)
        block = str(t.get("block") or "UNKNOWN")
        alpha_count = int(t.get("alpha_count") or 0)
        money_at_start = bool(t.get("money_at_start"))
        money_at_end = bool(t.get("money_at_end"))
        money_last_end = t.get("money_last_end")

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
            # Linha só com valor (muito comum em totais/subtotais do PDF):
            # não deve virar lançamento de item.
            raw_no_rs = re.sub(r"(?i)R\$\s*", "", str(raw)).strip()
            raw_letters = sum(1 for c in raw_no_rs if c.isalpha())
            if raw_letters == 0 and money_count == 1 and _RE_MONEY_ONLY_RAW.match(str(raw)):
                t["type"] = "TOTAL"
                continue

            # Padrão "valor ANTES do título" (Chelsea): "2.370,14 Manutenção e Conservação".
            # Se parece cabeçalho, descarta o valor e trata como CATEGORY.
            if money_at_start and (not money_at_end) and alpha_count >= 5 and money_count == 1:
                # avalia apenas o "resto" após o montante inicial
                tail = ""
                if isinstance(money_last_end, int) and money_last_end > 0:
                    tail = str(raw)[money_last_end:].strip()
                else:
                    # fallback simples: remove primeiro token numérico
                    tail = re.sub(r"^\s*(?:R\$\s*)?[\d\.\-]+,\d{2}\s+", "", str(raw), flags=re.I).strip()

                tail = normalize_extracted_text(tail, warn_context="leading_money_header_tail")
                tail_low = _loose_key(tail)

                if tail_low in {_loose_key(x) for x in _KNOWN_SECTION_TITLES} or _looks_like_section_header_loose(tail_low):
                    t["type"] = "CATEGORY"
                    t["valor"] = None
                    continue

            t["type"] = "ITEM"
            continue

        # Sem valor: decidir se é título de seção/grupo ou continuação de descrição.
        cln = " ".join(str(clean).split()).strip()
        low = cln.lower()
        is_bold = bool(t.get("is_bold"))

        # Bloqueio explícito: linhas típicas de continuação/ruído do Chelsea não podem virar CATEGORY.
        if cln and _RE_BAD_GROUP_LINE.match(cln):
            t["type"] = "CONTINUATION"
            continue

        # Título de seção/grupo: texto conhecido e/ou bold, sem valor monetário
        if cln and len(cln) < 140:
            if low in _KNOWN_SECTION_TITLES:
                t["type"] = "CATEGORY"
                continue
            if is_bold and len(cln) < 120:
                t["type"] = "CATEGORY"
                continue
            # Orçamento/previsão: cabeçalho com percentual no fim (ex.: "Taxas Mensais - 39%")
            if "%" in str(raw) and alpha_count >= 5 and len(cln) < 120:
                t["type"] = "CATEGORY"
                continue
            if t.get("is_upper") and len(cln) < 80:
                # CAIXA ALTA curta costuma ser cabeçalho (grupo)
                t["type"] = "CATEGORY"
                continue
            if _RE_SECTION_HEADER_HINT.match(low) and len(cln) < 120:
                t["type"] = "CATEGORY"
                continue

        # Caso geral: linha sem valor e sem sinais fortes de cabeçalho ⇒ continuação
        if cln:
            t["type"] = "CONTINUATION"
        else:
            t["type"] = "CATEGORY"

    return tokens
