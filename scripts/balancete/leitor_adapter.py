"""
Converte linhas do `leitor_balancete.parse_pdf` (LinhaNormalizada) no mesmo JSON
esperado pelo engine Node (`entries`, `resumoContas`, `canonical`, `metadata`).
"""

from __future__ import annotations

import re
from typing import Any, Dict, List, Optional
from collections import defaultdict

from leitor_balancete.models import LinhaNormalizada
from leitor_balancete.money import RE_BRL_TOKEN, brl_to_float

ACCOUNT_COLUMNS = [
    "saldoAnterior",
    "creditos",
    "debitos",
    "transfMais",
    "transfMenos",
    "saldoFinal",
]


def _norm_text(value: str) -> str:
    return re.sub(r"\s+", " ", value or "").strip()


def _guess_movimento_conta(desc: str) -> str:
    d = _norm_text(desc).lower()
    if "total dispon" in d:
        return "TOTAL_DISPONIVEL"
    if "saldo a ser transferido" in d:
        return "TOTAL_DISPONIVEL"
    if "saldo anterior" in d or "sld ant" in d or d.startswith("01 -"):
        return "SALDO_ANTERIOR"
    if "saldo atual" in d or "saldo final" in d or "sld atual" in d:
        return "SALDO_ATUAL"
    if "débito" in d or "debito" in d or d.startswith("03 -"):
        return "SAIDA"
    if "transferência (-)" in d or "transferencia (-)" in d:
        return "SAIDA"
    if "crédito" in d or "credito" in d or d.startswith("02 -"):
        return "ENTRADA"
    if "transferência (+)" in d or "transferencia (+)" in d or d.startswith("04 -"):
        return "ENTRADA"
    if "entrada" in d and "total" not in d[:28]:
        return "ENTRADA"
    if "saída" in d or "saida" in d:
        return "SAIDA"
    if d.startswith("total"):
        return "TOTAL_DISPONIVEL"
    return "ENTRADA"


def _tipo_lancamento(tipo: str, desc: str) -> str:
    t = (tipo or "").lower()
    d = (desc or "").lower()
    if t == "total":
        return "TOTAL_GERAL"
    if "subtotal" in d:
        return "SUBTOTAL"
    return "ITEM"


def _is_resumo_mensal_label(desc: str) -> bool:
    d = _norm_text(desc).lower()
    return d.startswith(
        (
            "saldo anterior",
            "total de receitas",
            "total de despesas",
            "saldo do mês",
            "saldo do mes",
            "saldo atual",
            "saldo a ser transferido",
        )
    )


def _money_values_from_desc(desc: str, last_value: Optional[float]) -> List[float]:
    values = [brl_to_float(m.group(0)) for m in RE_BRL_TOKEN.finditer(desc or "")]
    if last_value is not None:
        values.append(float(last_value))
    return values


def _label_before_money(desc: str) -> str:
    m = RE_BRL_TOKEN.search(desc or "")
    if not m:
        return _norm_text(desc)
    return _norm_text((desc or "")[: m.start()].strip(" :-"))


def _parse_inline_account_row(conta: str, desc: str, value: float) -> Optional[Dict[str, Any]]:
    amounts = _money_values_from_desc(desc, value)
    if not amounts:
        return None

    label = _label_before_money(desc) or conta
    row: Dict[str, Any] = {
        "label": label,
        "conta": conta,
        "movimento": _guess_movimento_conta(label),
        "saldoAnterior": None,
        "creditos": None,
        "debitos": None,
        "transfMais": None,
        "transfMenos": None,
        "saldoFinal": None,
        "valor": float(value),
    }

    vals = amounts[-6:]
    if len(vals) >= 6:
        row["saldoAnterior"] = vals[0]
        row["creditos"] = vals[1]
        row["debitos"] = abs(vals[2])
        row["transfMais"] = vals[3]
        row["transfMenos"] = abs(vals[4])
        row["saldoFinal"] = vals[5]
    elif len(vals) == 5:
        row["saldoAnterior"] = vals[0]
        row["creditos"] = vals[1]
        row["debitos"] = abs(vals[2])
        row["transfMenos"] = abs(vals[3])
        row["saldoFinal"] = vals[4]
    elif len(vals) == 4:
        row["saldoAnterior"] = vals[0]
        row["creditos"] = vals[1]
        row["debitos"] = abs(vals[2])
        row["saldoFinal"] = vals[3]
    elif len(vals) == 3:
        row["saldoAnterior"] = vals[0]
        row["transfMais"] = vals[1]
        row["saldoFinal"] = vals[2]
    elif len(vals) == 2:
        row["saldoAnterior"] = vals[0]
        row["saldoFinal"] = vals[1]
    else:
        row["saldoFinal"] = vals[0]

    return row


def _merge_grouped_account_rows(conta: str, rows: List[Dict[str, Any]]) -> Dict[str, Any]:
    merged: Dict[str, Any] = {
        "label": conta,
        "conta": conta,
        "movimento": "SALDO_ATUAL",
        "saldoAnterior": None,
        "creditos": None,
        "debitos": None,
        "transfMais": None,
        "transfMenos": None,
        "saldoFinal": None,
        "valor": None,
    }

    for row in rows:
        desc = row["descricao"]
        value = abs(float(row["valor"]))
        mov = _guess_movimento_conta(desc)
        low = _norm_text(desc).lower()
        if mov == "SALDO_ANTERIOR":
            merged["saldoAnterior"] = value
        elif mov == "SALDO_ATUAL":
            merged["saldoFinal"] = value
        elif mov == "TOTAL_DISPONIVEL":
            merged["saldoFinal"] = value
        elif "transferência (+)" in low or "transferencia (+)" in low:
            merged["transfMais"] = value
        elif "transferência (-)" in low or "transferencia (-)" in low:
            merged["transfMenos"] = value
        elif mov == "SAIDA":
            merged["debitos"] = value
        else:
            merged["creditos"] = value

    merged["valor"] = merged["saldoFinal"]
    return merged


def _build_account_tables(rows: List[LinhaNormalizada]) -> Dict[str, Optional[Dict[str, Any]]]:
    grouped: Dict[str, Dict[str, List[Dict[str, Any]]]] = {
        "CONTAS_CORRENTES": {},
        "CONTAS_POUPANCA": {},
    }
    inline_rows: Dict[str, List[Dict[str, Any]]] = {
        "CONTAS_CORRENTES": [],
        "CONTAS_POUPANCA": [],
    }
    current_account = {
        "CONTAS_CORRENTES": "",
        "CONTAS_POUPANCA": "",
    }

    for r in rows:
        bl = (r.bloco or "").upper()
        if bl not in grouped:
            continue
        tipo = (r.tipo_linha or "").lower()
        desc = _norm_text(r.descricao)
        cat = _norm_text(r.categoria)

        if tipo == "categoria":
            current_account[bl] = cat or desc or current_account[bl]
            continue
        if r.valor is None or tipo not in ("item", "total", "resumo"):
            continue

        conta = cat or current_account[bl] or (
            "Contas correntes" if bl == "CONTAS_CORRENTES" else "Poupança/Aplicação"
        )
        money_count = len(list(RE_BRL_TOKEN.finditer(desc))) + 1
        if money_count >= 3 and not desc.startswith(("01 -", "02 -", "03 -", "04 -", "05 -")):
            parsed = _parse_inline_account_row(conta, desc, float(r.valor))
            if parsed:
                inline_rows[bl].append(parsed)
            continue

        bucket = grouped[bl].setdefault(conta, [])
        bucket.append({"descricao": desc, "valor": float(r.valor)})

    def _table(block: str, title: str) -> Optional[Dict[str, Any]]:
        rows_out: List[Dict[str, Any]] = []
        rows_out.extend(inline_rows[block])
        for conta, items in grouped[block].items():
            if items:
                rows_out.append(_merge_grouped_account_rows(conta, items))
        if not rows_out:
            return None
        return {
            "tableName": title,
            "columns": ACCOUNT_COLUMNS,
            "rows": rows_out,
            "totalRow": None,
        }

    return {
        "contasCorrentes": _table("CONTAS_CORRENTES", "Contas Correntes"),
        "contasPoupancaAplicacao": _table("CONTAS_POUPANCA", "Poupança / Aplicação"),
    }


def _build_canonical(
    entries: List[Dict[str, Any]],
    account_tables: Dict[str, Optional[Dict[str, Any]]],
) -> Dict[str, Any]:
    rec_g: Dict[str, List[Dict[str, Any]]] = defaultdict(list)
    des_g: Dict[str, List[Dict[str, Any]]] = defaultdict(list)
    resumo_items: List[Dict[str, Any]] = []

    for e in entries:
        fase = e.get("fase")
        sm = e.get("secaoMacro")
        grupo = str(e.get("grupoOrigem") or "GERAL")
        tl = e.get("tipoLinha")
        if tl == "TITULO":
            continue
        if fase == "RESUMO_MES":
            resumo_items.append(
                {"label": str(e.get("descricao") or ""), "valor": float(e.get("valor") or 0)}
            )
            continue
        if sm == "RECEITAS" and tl != "TITULO":
            rec_g[grupo].append(
                {
                    "descricao": str(e.get("descricao") or ""),
                    "valor": float(e.get("valor") or 0),
                    "rawLine": e.get("linhaOriginal"),
                }
            )
        elif sm == "DESPESAS" and tl != "TITULO":
            des_g[grupo].append(
                {
                    "descricao": str(e.get("descricao") or ""),
                    "valor": float(e.get("valor") or 0),
                    "rawLine": e.get("linhaOriginal"),
                }
            )

    receitas = [
        {"groupName": name, "entries": items, "subtotal": None} for name, items in rec_g.items()
    ]
    despesas = [
        {"groupName": name, "entries": items, "subtotal": None} for name, items in des_g.items()
    ]

    total_geral = None
    for item in reversed(resumo_items):
        if _norm_text(str(item.get("label") or "")).lower() in ("saldo a ser transferido", "saldo atual"):
            total_geral = {"label": str(item.get("label") or ""), "valor": float(item.get("valor") or 0)}
            break

    return {
        "receitas": receitas,
        "despesas": despesas,
        "resumo": resumo_items,
        "contasCorrentes": account_tables.get("contasCorrentes"),
        "contasPoupancaAplicacao": account_tables.get("contasPoupancaAplicacao"),
        "totalGeral": total_geral,
    }


def rows_to_parse_json(rows: List[LinhaNormalizada], file_name: str) -> Dict[str, Any]:
    entries: List[Dict[str, Any]] = []
    resumo_contas: List[Dict[str, Any]] = []
    issues: List[Dict[str, Any]] = []

    condominio = ""
    periodo = ""
    for r in rows:
        if r.condominio:
            condominio = r.condominio.strip()
        if r.periodo:
            periodo = r.periodo.strip()

    for r in rows:
        bl = (r.bloco or "").upper()
        tipo = (r.tipo_linha or "").lower()
        val = r.valor
        desc = _norm_text(r.descricao)
        cat = _norm_text(r.categoria)
        desc_money_count = len(list(RE_BRL_TOKEN.finditer(desc)))

        if (
            bl in ("CONTAS_CORRENTES", "CONTAS_POUPANCA")
            and val is not None
            and tipo in ("item", "resumo", "total")
            and desc_money_count == 0
        ):
            mov = _guess_movimento_conta(desc)
            conta = cat or ("Contas correntes" if "CORRENTE" in bl else "Poupança/Aplicação")
            resumo_contas.append(
                {
                    "conta": conta,
                    "movimento": mov,
                    "descricao": desc,
                    "valor": abs(float(val)),
                    "linhaOriginal": desc,
                }
            )
            continue

        if val is None:
            if tipo == "categoria" and desc and bl in ("RECEITAS", "DESPESAS"):
                entries.append(
                    {
                        "secaoMacro": "RECEITAS" if bl == "RECEITAS" else "DESPESAS",
                        "grupoOrigem": cat or "GERAL",
                        "descricao": desc,
                        "valor": 0,
                        "sinal": 1,
                        "tipoLinha": "TITULO",
                        "linhaOriginal": desc,
                        "fase": "LANCAMENTOS",
                    }
                )
            continue

        if bl == "RESUMO" and tipo in ("item", "total", "resumo"):
            if not _is_resumo_mensal_label(desc):
                continue
            du = desc.upper()
            if du.startswith("RECEITAS") or "TOTAL DE RECEITAS" in du:
                sm = "RECEITAS"
            elif du.startswith("DESPESAS") or "TOTAL DE DESPESAS" in du:
                sm = "DESPESAS"
            elif "TOTAL" in du and "RECEITAS" in du and "DESPESAS" in du:
                sm = "RECEITAS"
            else:
                sm = "RECEITAS"
            tl = _tipo_lancamento(tipo, desc)
            if tipo == "total":
                tl = "TOTAL_GERAL"
            entries.append(
                {
                    "secaoMacro": sm,
                    "grupoOrigem": "RESUMO_MES",
                    "descricao": desc,
                    "valor": float(val),
                    "sinal": 1,
                    "tipoLinha": tl,
                    "fase": "RESUMO_MES",
                    "linhaOriginal": desc,
                }
            )
            continue

        if bl == "RECEITAS" and tipo in ("item", "total"):
            tl = _tipo_lancamento(tipo, desc)
            if tipo == "total":
                tl = "TOTAL_GERAL"
            entries.append(
                {
                    "secaoMacro": "RECEITAS",
                    "grupoOrigem": cat or "GERAL",
                    "descricao": desc,
                    "valor": abs(float(val)),
                    "sinal": 1,
                    "tipoLinha": tl,
                    "fase": "LANCAMENTOS",
                    "linhaOriginal": desc,
                }
            )
            continue

        if bl == "DESPESAS" and tipo in ("item", "total"):
            tl = _tipo_lancamento(tipo, desc)
            if tipo == "total":
                tl = "TOTAL_GERAL"
            entries.append(
                {
                    "secaoMacro": "DESPESAS",
                    "grupoOrigem": cat or "GERAL",
                    "descricao": desc,
                    "valor": abs(float(val)),
                    "sinal": -1,
                    "tipoLinha": tl,
                    "fase": "LANCAMENTOS",
                    "linhaOriginal": desc,
                }
            )
            continue

        if tipo in ("item", "total") and val is not None:
            sm = "DESPESAS" if "DESPESA" in bl or bl == "DESPESAS" else "RECEITAS"
            sinal = -1 if sm == "DESPESAS" else 1
            entries.append(
                {
                    "secaoMacro": sm,
                    "grupoOrigem": cat or "GERAL",
                    "descricao": desc,
                    "valor": abs(float(val)),
                    "sinal": sinal,
                    "tipoLinha": "ITEM",
                    "fase": "LANCAMENTOS",
                    "linhaOriginal": desc,
                }
            )

    blocks_detected = sorted({(r.bloco or "") for r in rows if r.bloco})

    metadata: Dict[str, Any] = {
        "fileName": file_name,
        "competenceLabel": periodo or None,
        "condominiumName": condominio or None,
        "parserLayoutId": "leitor_balancete_v1",
        "blocksDetected": [b for b in blocks_detected if b],
    }

    account_tables = _build_account_tables(rows)
    canonical = _build_canonical(entries, account_tables)

    return {
        "schemaVersion": 2,
        "metadata": metadata,
        "canonical": canonical,
        "entries": entries,
        "resumoContas": resumo_contas,
        "issues": issues,
    }
