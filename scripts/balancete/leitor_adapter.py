"""
Converte linhas do `leitor_balancete.parse_pdf` (LinhaNormalizada) no mesmo JSON
esperado pelo engine Node (`entries`, `resumoContas`, `canonical`, `metadata`).
"""

from __future__ import annotations

from typing import Any, Dict, List
from collections import defaultdict

from leitor_balancete.models import LinhaNormalizada


def _guess_movimento_conta(desc: str) -> str:
    d = (desc or "").lower()
    if "total dispon" in d:
        return "TOTAL_DISPONIVEL"
    if "saldo anterior" in d or "sld ant" in d:
        return "SALDO_ANTERIOR"
    if "entrada" in d and "total" not in d[:28]:
        return "ENTRADA"
    if "saída" in d or "saida" in d:
        return "SAIDA"
    if "saldo atual" in d or "sld atual" in d:
        return "SALDO_ATUAL"
    return "ENTRADA"


def _tipo_lancamento(tipo: str, desc: str) -> str:
    t = (tipo or "").lower()
    d = (desc or "").lower()
    if t == "total":
        return "TOTAL_GERAL"
    if "subtotal" in d:
        return "SUBTOTAL"
    return "ITEM"


def _build_canonical(entries: List[Dict[str, Any]]) -> Dict[str, Any]:
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

    return {
        "receitas": receitas,
        "despesas": despesas,
        "resumo": resumo_items,
        "contasCorrentes": None,
        "contasPoupancaAplicacao": None,
        "totalGeral": None,
    }


def rows_to_parse_json(
    rows: List[LinhaNormalizada],
    file_name: str,
    *,
    parser_layout_id: str = "leitor_balancete_v1",
) -> Dict[str, Any]:
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
        desc = (r.descricao or "").strip()
        cat = (r.categoria or "").strip()

        if bl in ("CONTAS_CORRENTES", "CONTAS_POUPANCA") and val is not None and tipo == "item":
            mov = _guess_movimento_conta(desc)
            conta = cat or ("Contas correntes" if "CORRENTE" in bl else "Poupança")
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
                    "valor": abs(float(val)),
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
        "parserLayoutId": parser_layout_id,
        "blocksDetected": [b for b in blocks_detected if b],
    }

    canonical = _build_canonical(entries)

    return {
        "schemaVersion": 2,
        "metadata": metadata,
        "canonical": canonical,
        "entries": entries,
        "resumoContas": resumo_contas,
        "issues": issues,
    }
