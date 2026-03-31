"""
Layout Belle Chateau / Superlógica: blocos 'Data Fornecedor (+/-) ... Valor', valores após R$
(com espaços quebrados). Três camadas no JSON:

- entries com fase LANCAMENTOS: receitas/despesas do mês (não inclui resumo das contas).
- entries com fase RESUMO_MES: totais do resumo do mês no PDF.
- resumoContas: somente bloco RESUMO DAS CONTAS (separado de despesas comuns).
"""

from __future__ import annotations

import re
import unicodedata
from typing import Any, Dict, List, Literal, Optional

Fase = Literal["LANCAMENTOS", "RESUMO_MES"]
TipoLinha = Literal["ITEM", "SUBTOTAL", "TOTAL_GERAL", "TITULO"]
Movimento = Literal[
    "SALDO_ANTERIOR",
    "ENTRADA",
    "SAIDA",
    "SALDO_ATUAL",
    "TOTAL_DISPONIVEL",
]

DATE_PREFIX_RE = re.compile(r"^(\d{1,2}/\d{1,2}/\d{2,4})\s+(.+)$")
DATA_FORN_HEAD = re.compile(
    r"Data\s+Fornecedor\s*\(\s*([+-])\s*\)\s*(.+?)\s+Valor\s*$",
    re.I,
)


def strip_accents(s: str) -> str:
    return "".join(
        c for c in unicodedata.normalize("NFD", s) if unicodedata.category(c) != "Mn"
    )


def repair_pdf_mojibake(s: str) -> str:
    """Corrige '?' no lugar de acentos (comum em extração PDF) e U+FFFD."""
    if not s:
        return s
    t = s.replace("\ufffd", "")
    repl = (
        (r"COND\?MINOS", "CONDÔMINOS"),
        (r"CONDOM\?NIO", "CONDOMÍNIO"),
        (r"\?GUA", "ÁGUA"),
        (r"ORDIN\?RIAS", "ORDINÁRIAS"),
        (r"MANUTEN\?\?O", "MANUTENÇÃO"),
        (r"ARRECADA\?\?O", "ARRECADAÇÃO"),
        (r"POUPAN\?A", "POUPANÇA"),
        (r"TAXA DE UTILIZA\?\?O", "TAXA DE UTILIZAÇÃO"),
        (r"SAL\?O", "SALÃO"),
        (r"\bM\?S\b", "MÊS"),
        (r"COMPET\?NCIA", "COMPETÊNCIA"),
        (r"MANUTEN\?O", "MANUTENÇÃO"),
        (r"RENDIMENTO\?O", "RENDIMENTO"),
    )
    for pat, b in repl:
        t = re.sub(pat, b, t, flags=re.I)
    return t


def normalize_text_line(line: str) -> str:
    t = (line or "").replace("\u00a0", " ")
    t = repair_pdf_mojibake(t)
    t = re.sub(r"\s+", " ", t).strip()
    return t


def br_money_collapsed(s: str) -> Optional[float]:
    s = s.strip().replace(" ", "")
    if not s or s == "-":
        return None
    neg = s.startswith("-")
    if neg:
        s = s[1:].strip()
    if "," not in s:
        return None
    main, cents = s.rsplit(",", 1)
    if len(cents) != 2 or not cents.isdigit():
        return None
    intpart = main.replace(".", "")
    if not intpart or not intpart.replace("-", "").isdigit():
        return None
    try:
        v = float(intpart + "." + cents)
    except ValueError:
        return None
    return -v if neg else v


def parse_rs_money_from_line(line: str) -> Optional[float]:
    idx = line.rfind("R$")
    if idx < 0:
        return None
    tail = line[idx + 2 :].strip()
    collapsed = re.sub(r"\s+", "", tail)
    return br_money_collapsed(collapsed)


def extract_desc_before_rs(line: str) -> str:
    idx = line.rfind("R$")
    if idx < 0:
        return line.strip()
    return line[:idx].strip()


def short_grupo_from_header(header_line: str) -> str:
    m = DATA_FORN_HEAD.match(header_line.strip())
    if m:
        return m.group(2).strip()
    return strip_accents(header_line)[:80]


def classify_resumo_movimento(desc: str) -> Movimento:
    u = strip_accents(desc).upper()
    if "TOTAL DISPONIVEL" in u or "TOTAL DISPON" in u:
        return "TOTAL_DISPONIVEL"
    if "SALDO ATUAL" in u:
        return "SALDO_ATUAL"
    if "ACUMULADO" in u and "ANTERIOR" in u:
        return "SALDO_ANTERIOR"
    if u.strip().startswith("SAIDAS") or u.strip().startswith("SAÍDAS"):
        return "SAIDA"
    if "DESPESAS ORDIN" in u or "DESPESAS AGUA" in u or "DESPESAS ÁGUA" in desc.upper():
        return "SAIDA"
    if "DESPESAS FUNDO" in u:
        return "SAIDA"
    if "RESGATE" in u and "RESUMO FINANCEIRO" in u:
        return "SAIDA"
    if "RESGATE" in u or "RECEITA" in u or "RENDIMENTO" in u:
        return "ENTRADA"
    return "ENTRADA"


def is_belle_layout(lines: List[str]) -> bool:
    head = "\n".join(lines[:18])
    return "Data Fornecedor" in head and ("(+)" in head or "(-)" in head)


def _entry(
    *,
    fase: Fase,
    secao_macro: str,
    grupo: str,
    data: Optional[str],
    descricao: str,
    valor: float,
    sinal: Literal[1, -1],
    tipo: TipoLinha,
    original: str,
) -> Dict[str, Any]:
    descricao = normalize_text_line(repair_pdf_mojibake(descricao))
    return {
        "fase": fase,
        "secaoMacro": secao_macro,
        "grupoOrigem": grupo,
        "data": data,
        "fornecedor": None,
        "descricao": descricao,
        "valor": abs(valor),
        "sinal": sinal,
        "tipoLinha": tipo,
        "linhaOriginal": original,
    }


def transform_belle_chateau_lines(lines: List[str], file_name: str) -> Dict[str, Any]:
    entries: List[Dict[str, Any]] = []
    resumo: List[Dict[str, Any]] = []
    issues: List[Dict[str, Any]] = []
    meta: Dict[str, Any] = {
        "fileName": file_name,
        "competenceLabel": None,
        "condominiumName": None,
        "parserLayoutId": "belle_chateau_v2",
    }

    in_resumo_contas = False
    fase_entries: Fase = "LANCAMENTOS"
    macro = ""
    grupo_header = "GERAL"
    resumo_banco = ""

    for raw in lines:
        clean = normalize_text_line(raw)
        u = clean.upper()

        if "BALANCETE MENSAL" in u and "COMPET" in u:
            meta["competenceLabel"] = clean
            continue
        if "BELLE CHATEAU" in u and "CNPJ" in u:
            meta["condominiumName"] = clean
            continue

        if "RESUMO DAS CONTAS" in u:
            in_resumo_contas = True
            fase_entries = "LANCAMENTOS"
            macro = ""
            resumo_banco = ""
            continue

        if in_resumo_contas:
            val = parse_rs_money_from_line(clean)
            if val is None:
                low = u
                if (
                    len(clean) > 12
                    and "VALOR" not in low
                    and "SALDO ANTERIOR" not in low
                    and not low.startswith("ENTRADAS")
                    and not low.startswith("SAÍDAS")
                    and not low.startswith("SAIDAS")
                ):
                    resumo_banco = clean.strip()
                continue

            desc = normalize_text_line(repair_pdf_mojibake(extract_desc_before_rs(clean)))
            mov = classify_resumo_movimento(desc)
            resumo.append(
                {
                    "conta": resumo_banco or "GERAL",
                    "movimento": mov,
                    "descricao": desc,
                    "valor": float(val),
                    "linhaOriginal": clean,
                }
            )
            continue

        if ("RESUMO DO MÊS" in u or "RESUMO DO MES" in u) and "RESUMO DAS CONTAS" not in u:
            in_resumo_contas = False
            fase_entries = "RESUMO_MES"
            macro = ""
            continue

        if "RECEITAS X DESPESAS" in u:
            continue

        mhead = DATA_FORN_HEAD.match(clean)
        if mhead:
            in_resumo_contas = False
            fase_entries = "LANCAMENTOS"
            sign = mhead.group(1)
            macro = "RECEITAS" if sign == "+" else "DESPESAS"
            grupo_header = short_grupo_from_header(clean)
            continue

        if fase_entries == "RESUMO_MES":
            val = parse_rs_money_from_line(clean)
            if val is None:
                continue
            desc = extract_desc_before_rs(clean).strip()
            du = desc.upper()
            sm = "DESPESAS" if du.startswith("DESPESAS") else "RECEITAS"
            entries.append(
                _entry(
                    fase="RESUMO_MES",
                    secao_macro=sm,
                    grupo="RESUMO_DO_MES",
                    data=None,
                    descricao=desc,
                    valor=val,
                    sinal=1,
                    tipo="ITEM",
                    original=clean,
                )
            )
            continue

        if macro in ("RECEITAS", "DESPESAS") and fase_entries == "LANCAMENTOS":
            val = parse_rs_money_from_line(clean)
            if val is None:
                continue

            dm = DATE_PREFIX_RE.match(clean)
            data = dm.group(1) if dm else None
            rest = dm.group(2).strip() if dm else clean
            ul = clean.upper()

            if "TOTAL GERAL" in ul:
                tipo: TipoLinha = "TOTAL_GERAL"
            elif "TOTAL GRUPO" in ul:
                tipo = "SUBTOTAL"
            elif dm:
                tipo = "ITEM"
            else:
                tipo = "SUBTOTAL"

            desc = extract_desc_before_rs(rest).strip()
            sinal: Literal[1, -1] = 1 if macro == "RECEITAS" else -1

            entries.append(
                _entry(
                    fase="LANCAMENTOS",
                    secao_macro=macro,
                    grupo=grupo_header,
                    data=data,
                    descricao=desc,
                    valor=val,
                    sinal=sinal,
                    tipo=tipo,
                    original=clean,
                )
            )
            continue

        if (
            len(clean) > 8
            and not in_resumo_contas
            and fase_entries == "LANCAMENTOS"
            and macro == "NONE"
        ):
            issues.append(
                {
                    "type": "WARNING",
                    "code": "BELLE_UNCLASSIFIED",
                    "message": "Linha não classificada.",
                    "details": {"line": clean[:240]},
                }
            )

    return {
        "entries": entries,
        "resumoContas": resumo,
        "issues": issues,
        "metadata": meta,
    }
