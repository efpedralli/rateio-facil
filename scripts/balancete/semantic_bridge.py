from __future__ import annotations

from typing import Any, Dict, List

from leitor_balancete.metadata import extract_condominio_principal, extract_periodo
from leitor_balancete.models import LinhaNormalizada


def validated_to_rows(
    validated: Dict[str, Any],
    *,
    file_name: str,
    full_text: str,
) -> List[LinhaNormalizada]:
    """Converte saída do pipeline semântico em `LinhaNormalizada` para o adapter JSON."""
    data: Dict[str, Any] = validated.get("data") or {}
    cond = extract_condominio_principal(full_text)
    per = extract_periodo(full_text)
    rows: List[LinhaNormalizada] = []

    for e in data.get("entries") or []:
        bl = str(e.get("bloco") or "")
        tipo = str(e.get("tipo") or "item").lower()
        if tipo == "categoria":
            tl = "categoria"
        elif tipo == "total":
            tl = "total"
        else:
            tl = "item"
        rows.append(
            LinhaNormalizada(
                arquivo_origem=file_name,
                condominio=cond,
                periodo=per,
                bloco=bl,
                categoria=str(e.get("categoria") or "GERAL"),
                descricao=str(e.get("descricao") or ""),
                valor=e.get("valor"),
                tipo_linha=tl,
            )
        )

    for r in data.get("resumo") or []:
        desc = str(r.get("descricao") or "")
        v = r.get("valor")
        low = desc.lower()
        if v is not None and "total" in low:
            tl = "total"
        elif v is not None:
            tl = "item"
        else:
            tl = "resumo"
        rows.append(
            LinhaNormalizada(
                arquivo_origem=file_name,
                condominio=cond,
                periodo=per,
                bloco="RESUMO",
                categoria="RESUMO",
                descricao=desc,
                valor=v,
                tipo_linha=tl,
            )
        )

    for c in data.get("contas") or []:
        desc = str(c.get("descricao") or "")
        block = (
            "CONTAS_POUPANCA" if "poupan" in desc.lower() else "CONTAS_CORRENTES"
        )
        rows.append(
            LinhaNormalizada(
                arquivo_origem=file_name,
                condominio=cond,
                periodo=per,
                bloco=block,
                categoria="Contas correntes"
                if block == "CONTAS_CORRENTES"
                else "Poupança",
                descricao=desc,
                valor=float(c["valor"]) if c.get("valor") is not None else None,
                tipo_linha="item",
            )
        )

    return rows
