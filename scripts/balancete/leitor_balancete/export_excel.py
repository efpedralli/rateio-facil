from __future__ import annotations

from pathlib import Path
from typing import List, Optional

import pandas as pd

from .models import LinhaNormalizada


def linhas_to_dataframe(linhas: List[LinhaNormalizada]) -> pd.DataFrame:
    return pd.DataFrame([x.to_dict() for x in linhas])


def save_csv(linhas: List[LinhaNormalizada], path: Path, encoding: str = "utf-8-sig") -> None:
    df = linhas_to_dataframe(linhas)
    path.parent.mkdir(parents=True, exist_ok=True)
    df.to_csv(path, index=False, encoding=encoding, sep=";")


def linhas_to_sheet12(
    linhas: List[LinhaNormalizada],
    nome_condominio: Optional[str] = None,
    titulo: Optional[str] = None,
) -> pd.DataFrame:
    """
    Monta grade 12 colunas compatível com os .xls de exemplo:
    col0 título; col1 categoria; col2 descrição; col11 valor.
    """
    rows_out: List[List[object]] = []
    for _ in range(7):
        rows_out.append([None] * 12)

    meta = nome_condominio or ""
    per = ""
    for L in linhas:
        if L.condominio:
            meta = L.condominio
        if L.periodo:
            per = L.periodo
            break
    if not meta:
        meta = ""

    rows_out.append([meta, None, None, None, None, None, None, None, None, None, None, None])
    sub = titulo or (f"BALANCETE DEMONSTRATIVO {per}" if per else "BALANCETE DEMONSTRATIVO")
    rows_out.append([sub, None, None, None, None, None, None, None, None, None, None, None])

    for L in linhas:
        row = [None] * 12
        if L.valor is None:
            if L.tipo_linha == "categoria" and L.categoria:
                row[1] = L.categoria
                rows_out.append(row)
                continue
            if L.tipo_linha == "secao" and L.descricao:
                row[2] = L.descricao
                rows_out.append(row)
                continue
            if L.tipo_linha == "texto" and L.descricao and len(L.descricao) < 120:
                row[2] = L.descricao
                rows_out.append(row)
                continue
            continue
        row[2] = L.descricao or ""
        row[11] = L.valor
        rows_out.append(row)

    return pd.DataFrame(rows_out)


def save_xlsx12(
    linhas: List[LinhaNormalizada],
    path: Path,
    sheet_name: str = "Sheet1",
) -> None:
    df = linhas_to_sheet12(linhas)
    path.parent.mkdir(parents=True, exist_ok=True)
    with pd.ExcelWriter(path, engine="openpyxl") as w:
        df.to_excel(w, sheet_name=sheet_name, index=False, header=False)
