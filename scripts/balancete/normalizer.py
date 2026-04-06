from __future__ import annotations

from typing import Any, Dict, List, Optional, Tuple


def _llm_to_block_type(
    token: Dict[str, Any],
) -> Tuple[Optional[str], Optional[str], bool]:
    """
    Retorna (bloco, tipo, skip).
    skip=True → ignorar linha na saída.
    """
    lt = token.get("llm_type")
    if not lt:
        return None, None, False
    lt = str(lt).upper().strip()
    if lt == "IGNORAR":
        return None, None, True
    valor = token.get("valor")
    if lt == "RECEITA":
        return "RECEITAS", "ITEM" if valor is not None else "CATEGORY", False
    if lt == "DESPESA":
        return "DESPESAS", "ITEM" if valor is not None else "CATEGORY", False
    if lt == "RESUMO":
        return "RESUMO", "RESUMO", False
    if lt == "CONTA":
        return "CONTAS", "CONTA", False
    return None, None, False


def _effective_block_and_type(token: Dict[str, Any]) -> Tuple[str, str, bool]:
    lb, lt_type, skip = _llm_to_block_type(token)
    if skip:
        return "", "", True
    if lb and lt_type:
        return lb, lt_type, False
    block = str(token.get("block") or "UNKNOWN")
    typ = str(token.get("type") or "CATEGORY").upper()
    return block, typ, False


def normalize(tokens: List[Dict[str, Any]]) -> Dict[str, Any]:
    """
    Estrutura semântica: entries (lançamentos), resumo (lista), contas.
    Respeita token['llm_type'] no lugar de type quando existir.
    """
    entries: List[Dict[str, Any]] = []
    resumo: List[Dict[str, Any]] = []
    contas: List[Dict[str, Any]] = []

    last_cat: Dict[str, str] = {
        "RECEITAS": "GERAL",
        "DESPESAS": "GERAL",
    }

    for t in tokens:
        block, typ, skip = _effective_block_and_type(t)
        if skip:
            continue

        raw = str(t.get("raw") or "").strip()
        valor = t.get("valor")
        clean = str(t.get("clean") or "")

        if block == "CONTAS" and typ in ("CONTA", "ITEM", "TOTAL", "RESUMO"):
            if valor is not None:
                contas.append(
                    {
                        "descricao": raw,
                        "valor": float(valor),
                        "tipo": "conta",
                    }
                )
            continue

        if block == "RESUMO" or typ == "RESUMO":
            if valor is not None:
                resumo.append(
                    {
                        "descricao": raw,
                        "valor": float(valor),
                    }
                )
            elif typ == "RESUMO" and raw:
                resumo.append({"descricao": raw, "valor": None})
            continue

        if block == "RECEITAS":
            if typ == "CATEGORY" and raw:
                last_cat["RECEITAS"] = raw
                entries.append(
                    {
                        "bloco": "RECEITAS",
                        "categoria": last_cat["RECEITAS"],
                        "descricao": raw,
                        "valor": None,
                        "tipo": "categoria",
                    }
                )
            elif typ in ("ITEM", "TOTAL") and valor is not None:
                desc = raw
                entries.append(
                    {
                        "bloco": "RECEITAS",
                        "categoria": last_cat["RECEITAS"],
                        "descricao": desc,
                        "valor": float(valor),
                        "tipo": "item" if typ == "ITEM" else "total",
                    }
                )
            continue

        if block == "DESPESAS":
            if typ == "CATEGORY" and raw:
                last_cat["DESPESAS"] = raw
                entries.append(
                    {
                        "bloco": "DESPESAS",
                        "categoria": last_cat["DESPESAS"],
                        "descricao": raw,
                        "valor": None,
                        "tipo": "categoria",
                    }
                )
            elif typ in ("ITEM", "TOTAL") and valor is not None:
                entries.append(
                    {
                        "bloco": "DESPESAS",
                        "categoria": last_cat["DESPESAS"],
                        "descricao": raw,
                        "valor": float(valor),
                        "tipo": "item" if typ == "ITEM" else "total",
                    }
                )
            continue

        # UNKNOWN / fallback: linha com valor vira item conforme heurística de palavras
        if valor is not None and any(
            x in clean for x in ("despesa", "débito", "debito", "saída", "saida")
        ):
            entries.append(
                {
                    "bloco": "DESPESAS",
                    "categoria": last_cat["DESPESAS"],
                    "descricao": raw,
                    "valor": float(valor),
                    "tipo": "item",
                }
            )
        elif valor is not None and any(
            x in clean for x in ("receita", "crédito", "credito", "entrada")
        ):
            entries.append(
                {
                    "bloco": "RECEITAS",
                    "categoria": last_cat["RECEITAS"],
                    "descricao": raw,
                    "valor": float(valor),
                    "tipo": "item",
                }
            )

    return {
        "entries": entries,
        "resumo": resumo,
        "contas": contas,
    }
