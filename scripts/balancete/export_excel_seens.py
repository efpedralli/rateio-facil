"""
Exporta balancete canônico (mesmo JSON de `canonical_export.json`) para layout XLSX exigido pelo sistema Seens.
Usa apenas valores gravados nas células (sem fórmulas).
"""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path
from typing import Any, Dict, List, Mapping, Optional, Tuple

from openpyxl import Workbook

DEC_FMT = "0.00"

_MESES = (
    "",
    "janeiro",
    "fevereiro",
    "março",
    "abril",
    "maio",
    "junho",
    "julho",
    "agosto",
    "setembro",
    "outubro",
    "novembro",
    "dezembro",
)


def format_competencia(competencia: int) -> str:
    """
    Converte competência no formato YYYYMM (ex.: 202604) em texto para a célula A10.
    Ex.: 202604 -> "Competência abril de 2026"
    """
    if competencia <= 0:
        return "Competência —"
    year = competencia // 100
    month = competencia % 100
    if year < 1900 or year > 2100 or month < 1 or month > 12:
        return f"Competência {competencia}"
    return f"Competência {_MESES[month]} de {year}"


def _num(v: Any) -> Optional[float]:
    if v is None:
        return None
    if isinstance(v, (int, float)) and not isinstance(v, bool):
        return float(v)
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


def _str(v: Any) -> str:
    if v is None:
        return ""
    return str(v).strip()


def _entries_list(data: Mapping[str, Any]) -> List[Dict[str, Any]]:
    e = data.get("entries")
    return list(e) if isinstance(e, list) else []


def _metadata_dict(data: Mapping[str, Any]) -> Dict[str, Any]:
    m = data.get("metadata")
    return dict(m) if isinstance(m, dict) else {}


def _norm_section(raw: Any) -> str:
    s = _str(raw).upper()
    if s in ("RECEITAS", "RECEITA"):
        return "RECEITAS"
    if s in ("DESPESAS", "DESPESA"):
        return "DESPESAS"
    return s


def _infer_competencia_int(data: Mapping[str, Any]) -> int:
    md = _metadata_dict(data)
    raw_ym = md.get("competencia_ym")
    if isinstance(raw_ym, int) and raw_ym > 0:
        return raw_ym
    if isinstance(raw_ym, str) and raw_ym.isdigit() and len(raw_ym) == 6:
        return int(raw_ym)

    label = _str(md.get("competencia"))
    m = re.match(r"^(\d{1,2})\s*/\s*(\d{4})\s*$", label)
    if m:
        mes = int(m.group(1))
        ano = int(m.group(2))
        return ano * 100 + mes

    ini = _str(md.get("periodo_inicio"))
    m2 = re.search(r"(\d{4})-(\d{2})", ini)
    if m2:
        return int(m2.group(1)) * 100 + int(m2.group(2))

    return 0


def _is_aggregate_line(desc: str) -> bool:
    t = desc.strip().lower()
    if not t:
        return True
    if re.match(r"^total\b", t):
        return True
    if "subtotal" in t:
        return True
    return False


def _group_header(section: str, group: str) -> str:
    g = group.strip() or "GERAL"
    if section == "RECEITAS":
        return f"(+) RECEITAS — {g}"
    if section == "DESPESAS":
        return f"(-) DESPESAS — {g}"
    return f"{section} — {g}"


def _ordered_groups(
    entries: List[Dict[str, Any]],
) -> Tuple[List[Tuple[str, str]], Dict[Tuple[str, str], List[Dict[str, Any]]]]:
    order: List[Tuple[str, str]] = []
    groups: Dict[Tuple[str, str], List[Dict[str, Any]]] = {}
    for ent in entries:
        if not isinstance(ent, Mapping):
            continue
        sec = _norm_section(ent.get("section") or ent.get("Section") or ent.get("secao"))
        if sec not in ("RECEITAS", "DESPESAS"):
            continue
        grp = _str(ent.get("group") or ent.get("Group") or ent.get("grupo")) or "GERAL"
        key = (sec, grp)
        if key not in groups:
            groups[key] = []
            order.append(key)
        groups[key].append(dict(ent))
    # Seens: todas as receitas primeiro, depois todas as despesas; ordem relativa preservada.
    receitas_keys = [k for k in order if k[0] == "RECEITAS"]
    despesas_keys = [k for k in order if k[0] == "DESPESAS"]
    sorted_order = receitas_keys + despesas_keys
    return sorted_order, groups


def export_to_excel(data: dict, output_path: str) -> str:
    """
    Gera workbook Seens: cabeçalho fixo até linha 10, dados a partir da 11 (C=descrição, L=valor).
    Retorna o caminho absoluto salvo.
    """
    if not isinstance(data, Mapping):
        data = {}

    out = Path(output_path)
    out.parent.mkdir(parents=True, exist_ok=True)

    md = _metadata_dict(data)
    condominio = _str(md.get("condominio")) or "Condomínio"
    competencia_int = _infer_competencia_int(data)

    wb = Workbook()
    ws = wb.active
    ws.title = "Balancete"

    # A1:L4 vazio (nada a fazer)
    for r in (5, 6, 7):
        ws.merge_cells(start_row=r, start_column=1, end_row=r, end_column=12)

    ws["A8"] = condominio
    ws["A9"] = "Balancete mensal"
    ws["A10"] = format_competencia(competencia_int)

    entries = _entries_list(data)
    key_order, groups = _ordered_groups(entries)
    row = 11

    for key in key_order:
        sec, grp = key
        block = groups.get(key, [])
        ws.cell(row=row, column=3, value=_group_header(sec, grp))
        row += 1

        item_rows = [
            e
            for e in block
            if isinstance(e, Mapping) and not _is_aggregate_line(_str(e.get("descricao") or e.get("Descricao") or e.get("description")))
        ]
        total = 0.0
        for e in item_rows:
            desc = _str(e.get("descricao") or e.get("Descricao") or e.get("description"))
            val = _num(e.get("valor") or e.get("Valor"))
            if val is None:
                val = 0.0
            total += val
            ws.cell(row=row, column=3, value=desc or None)
            vcell = ws.cell(row=row, column=12, value=float(val))
            vcell.number_format = DEC_FMT
            row += 1

        ws.cell(row=row, column=3, value="TOTAL")
        tcell = ws.cell(row=row, column=12, value=float(total))
        tcell.number_format = DEC_FMT
        row += 1

    wb.save(out)

    print("[INFO] Export Seens (openpyxl)", file=sys.stderr)
    print(f"[INFO] Linha inicial dados: 11 | grupos: {len(key_order)}", file=sys.stderr)
    print(f"[INFO] Arquivo salvo em: {out.resolve()}", file=sys.stderr)

    return str(out.resolve())


def _load_json(path: str) -> Dict[str, Any]:
    with open(path, "r", encoding="utf-8") as f:
        raw = json.load(f)
    return raw if isinstance(raw, dict) else {}


if __name__ == "__main__":
    sample = {
        "metadata": {
            "condominio": "Residencial Exemplo",
            "competencia": "04/2026",
            "periodo_inicio": "2026-04-01",
            "periodo_fim": "2026-04-30",
        },
        "entries": [
            {
                "section": "RECEITAS",
                "group": "Taxas",
                "descricao": "Taxa condominial",
                "valor": 15000.0,
                "ordem": 1,
            },
            {
                "section": "RECEITAS",
                "group": "Taxas",
                "descricao": "Multas e juros",
                "valor": 120.5,
                "ordem": 2,
            },
            {
                "section": "DESPESAS",
                "group": "Pessoal",
                "descricao": "Salários",
                "valor": 8000.0,
                "ordem": 3,
            },
            {
                "section": "DESPESAS",
                "group": "Manutenção",
                "descricao": "Elevadores",
                "valor": 450.0,
                "ordem": 4,
            },
        ],
        "summary": {},
        "accounts": [],
    }

    if len(sys.argv) >= 3:
        payload = _load_json(sys.argv[1])
        export_to_excel(payload, sys.argv[2])
    else:
        out_default = Path("outputs") / "Residencial_Exemplo_202604_seens.xlsx"
        export_to_excel(sample, str(out_default))
        print(f"Exemplo salvo em: {out_default.resolve()}", file=sys.stderr)
