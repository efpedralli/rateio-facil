from __future__ import annotations

import re
from pathlib import Path
from typing import List, Optional

import pandas as pd

from .models import LinhaNormalizada
from .money import RE_BRL_TOKEN, brl_to_float

TABLE_BLOCK_LABELS = {
    "CONTAS_CORRENTES": "contas correntes",
    "CONTAS_POUPANCA": "contas poupanca/aplicacao",
}

DEFAULT_TABLE_COLUMNS = [
    "saldo anterior",
    "creditos",
    "debitos",
    "transf. (+)",
    "transf. (-)",
    "saldo final",
]

TABLE_HEADER_PATTERNS = [
    ("saldo anterior", re.compile(r"\bsaldo\s+anterior\b|\banterior\b", re.IGNORECASE)),
    ("creditos", re.compile(r"\bcr[eé]ditos?\b", re.IGNORECASE)),
    ("debitos", re.compile(r"\bd[eé]bitos?\b", re.IGNORECASE)),
    ("transf. (+)", re.compile(r"\btransf(?:er[êe]ncia)?\.?\s*\(\+\)", re.IGNORECASE)),
    ("transf. (-)", re.compile(r"\btransf(?:er[êe]ncia)?\.?\s*\(\-\)", re.IGNORECASE)),
    ("saldo final", re.compile(r"\bsaldo\s+final\b|\bsaldo\s+atual\b|\bfinal\b", re.IGNORECASE)),
]


def _norm(value: str) -> str:
    return re.sub(r"\s+", " ", value or "").strip()


def _clean_amount(value: float) -> float:
    return 0.0 if abs(value) < 0.000001 else value


def _money_values_from_line(desc: str, value: Optional[float]) -> List[float]:
    values = [_clean_amount(brl_to_float(m.group(0))) for m in RE_BRL_TOKEN.finditer(desc or "")]
    if value is not None:
        values.append(_clean_amount(float(value)))
    return values


def _label_before_money(desc: str) -> str:
    m = RE_BRL_TOKEN.search(desc or "")
    if not m:
        return _norm(desc)
    return _norm((desc or "")[: m.start()].strip(" :-"))


def _column_from_desc(desc: str) -> Optional[str]:
    low = _norm(desc).lower()
    if "saldo anterior" in low or low.startswith("01 -"):
        return "saldo anterior"
    if "credito" in low or "crédito" in low or low.startswith("02 -"):
        return "creditos"
    if "debito" in low or "débito" in low or low.startswith("03 -"):
        return "debitos"
    if "transferência (+)" in low or "transferencia (+)" in low:
        return "transf. (+)"
    if "transferência (-)" in low or "transferencia (-)" in low:
        return "transf. (-)"
    if "saldo final" in low or "saldo atual" in low or low.startswith("05 -"):
        return "saldo final"
    return None


def _extract_columns_from_header(desc: str) -> List[str]:
    found: List[tuple[int, str]] = []
    for column_name, pattern in TABLE_HEADER_PATTERNS:
        for match in pattern.finditer(desc or ""):
            found.append((match.start(), column_name))
            break
    found.sort(key=lambda item: item[0])

    columns: List[str] = []
    for _, column_name in found:
        if column_name not in columns:
            columns.append(column_name)
    return columns


def _pick_middle_columns(columns: List[str]) -> List[str]:
    return [c for c in columns if c not in ("saldo anterior", "saldo final")]


def _map_values_to_detected_columns(values: List[float], columns: List[str]) -> List[tuple[str, float]]:
    if not values:
        return []

    cols = columns or DEFAULT_TABLE_COLUMNS
    if len(values) >= len(cols):
        return list(zip(cols, values[-len(cols) :]))

    if len(values) == 1:
        if "saldo final" in cols:
            return [("saldo final", values[0])]
        return [(cols[-1], values[0])]

    first_col = "saldo anterior" if "saldo anterior" in cols else cols[0]
    last_col = "saldo final" if "saldo final" in cols else cols[-1]
    middle_cols = [c for c in _pick_middle_columns(cols) if c not in (first_col, last_col)]

    pairs: List[tuple[str, float]] = [(first_col, values[0])]
    middle_values = values[1:-1]

    if middle_values:
        if len(middle_values) == 1 and middle_cols:
            if middle_values[0] < 0:
                preferred_order = ["transf. (-)", "debitos", "transf. (+)", "creditos"]
            else:
                preferred_order = ["transf. (+)", "creditos", "debitos", "transf. (-)"]
            ordered_middle = [c for c in preferred_order if c in middle_cols] or middle_cols
            chosen = ordered_middle[0]
            pairs.append((chosen, middle_values[0]))
        else:
            for col_name, amount in zip(middle_cols, middle_values):
                pairs.append((col_name, amount))

    pairs.append((last_col, values[-1]))
    return pairs


def _map_inline_table_values(desc: str, value: Optional[float], columns: List[str]) -> List[tuple[str, float]]:
    values = _money_values_from_line(desc, value)
    if not values:
        return []
    return _map_values_to_detected_columns(values, columns)


def _flatten_table_rows(linhas: List[LinhaNormalizada]) -> List[LinhaNormalizada]:
    extras: List[LinhaNormalizada] = []
    current_account = {
        "CONTAS_CORRENTES": "",
        "CONTAS_POUPANCA": "",
    }
    current_schema = {
        "CONTAS_CORRENTES": list(DEFAULT_TABLE_COLUMNS),
        "CONTAS_POUPANCA": list(DEFAULT_TABLE_COLUMNS),
    }

    for row in linhas:
        block = (row.bloco or "").upper()
        if block not in TABLE_BLOCK_LABELS:
            continue

        kind = (row.tipo_linha or "").lower()
        desc = _norm(row.descricao)
        cat = _norm(row.categoria)
        detected_columns = _extract_columns_from_header(desc)

        if kind in ("secao", "texto") and len(detected_columns) >= 2:
            current_schema[block] = detected_columns

        if kind == "categoria":
            current_account[block] = cat or desc or current_account[block]
            continue

        if kind not in ("item", "total", "resumo", "secao", "texto"):
            continue

        money_matches = list(RE_BRL_TOKEN.finditer(desc))
        if row.valor is None and not money_matches:
            continue

        label = _label_before_money(desc) if money_matches else ""
        if not label:
            label = cat or current_account[block] or TABLE_BLOCK_LABELS[block]

        mappings: List[tuple[str, float]] = []
        if money_matches:
            mappings = _map_inline_table_values(desc, row.valor, current_schema[block])
        else:
            col = _column_from_desc(desc)
            if col and row.valor is not None:
                mappings = [(col, float(row.valor))]

        for column_name, amount in mappings:
            extras.append(
                LinhaNormalizada(
                    arquivo_origem=row.arquivo_origem,
                    condominio=row.condominio,
                    periodo=row.periodo,
                    bloco=block,
                    categoria="",
                    descricao=_norm(f"{label} {column_name}"),
                    valor=_clean_amount(amount),
                    tipo_linha="item",
                )
            )

    return extras


def _is_dynamic_table_header(row: LinhaNormalizada) -> bool:
    if (row.bloco or "").upper() not in TABLE_BLOCK_LABELS:
        return False
    if (row.tipo_linha or "").lower() not in ("secao", "texto"):
        return False
    return len(_extract_columns_from_header(_norm(row.descricao))) >= 2


def _is_compact_table_value_row(row: LinhaNormalizada) -> bool:
    block = (row.bloco or "").upper()
    kind = (row.tipo_linha or "").lower()
    if block not in TABLE_BLOCK_LABELS:
        return False
    if kind not in ("item", "total", "resumo"):
        return False
    desc = _norm(row.descricao)
    if row.valor is None and not desc:
        return False
    return bool(list(RE_BRL_TOKEN.finditer(desc))) or row.valor is not None


def _rows_for_normalized_exports(linhas: List[LinhaNormalizada]) -> List[LinhaNormalizada]:
    out: List[LinhaNormalizada] = []
    for row in linhas:
        block = (row.bloco or "").upper()
        if block in TABLE_BLOCK_LABELS:
            continue
        out.append(row)
    out.extend(_flatten_table_rows(linhas))
    return out


def linhas_to_dataframe(linhas: List[LinhaNormalizada]) -> pd.DataFrame:
    return pd.DataFrame([x.to_dict() for x in _rows_for_normalized_exports(linhas)])


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
    export_rows = _rows_for_normalized_exports(linhas)

    for L in export_rows:
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

    for L in export_rows:
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
