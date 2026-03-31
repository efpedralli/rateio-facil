"""
Parser semântico genérico de balancete (sem layout fixo nem regras por condomínio).

Fluxo: linhas de texto → segmentação por cabeçalhos/âncoras → parsers por bloco →
modelo canônico + entradas legadas (entries/resumoContas) para validação/export TS.
"""

from __future__ import annotations

import re
import unicodedata
from dataclasses import dataclass, field
from typing import Any, Dict, List, Literal, Optional, Tuple

# --- Texto / moeda (genérico, sem posição fixa de coluna) ---


def strip_accents(s: str) -> str:
    return "".join(
        c for c in unicodedata.normalize("NFD", s) if unicodedata.category(c) != "Mn"
    )


def repair_pdf_mojibake(s: str) -> str:
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


def normalize_line(line: str) -> str:
    t = (line or "").replace("\u00a0", " ")
    t = repair_pdf_mojibake(t)
    t = re.sub(r"\s+", " ", t).strip()
    return t


def clean_broken_digits_for_money(s: str) -> str:
    """Remove espaços indevidos entre dígitos antes de parsear (ex.: '7 .475,00')."""
    t = re.sub(r"(\d)\s+([\d.,])", r"\1\2", s)
    t = re.sub(r"([\d.,])\s+(\d)", r"\1\2", t)
    return t


# Valores monetários BR no fim da linha ou após R$
MONEY_TAIL_RE = re.compile(
    r"(?:R\$\s*)?(-?\s*\d[\d\s.,]*,\d{2})\s*$", re.I
)
DATE_PREFIX_RE = re.compile(r"^(\d{1,2}/\d{1,2}/\d{2,4})\s+(.+)$")
# Cabeçalho tipo planilha: Data + Fornecedor (+/-) … Valor (Superlógica e similares)
DATA_FORN_HEAD = re.compile(
    r"Data\s+Fornecedor\s*\(\s*([+-])\s*\)\s*(.+?)\s+Valor\s*$",
    re.I,
)


def parse_br_money_token(token: str) -> Optional[float]:
    t = clean_broken_digits_for_money(token.strip()).replace(" ", "")
    if not t or t == "-":
        return None
    neg = t.startswith("-")
    if neg:
        t = t[1:].strip()
    if "," not in t:
        return None
    main, cents = t.rsplit(",", 1)
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


def extract_trailing_money(line: str) -> Tuple[Optional[float], str]:
    m = MONEY_TAIL_RE.search(line)
    if not m:
        return None, line
    val = parse_br_money_token(m.group(1))
    rest = line[: m.start()].strip()
    return val, rest


def parse_rs_money_from_line(line: str) -> Optional[float]:
    idx = line.rfind("R$")
    if idx < 0:
        return None
    tail = clean_broken_digits_for_money(line[idx + 2 :].strip())
    collapsed = re.sub(r"\s+", "", tail)
    return parse_br_money_token(collapsed)


def extract_desc_before_rs(line: str) -> str:
    idx = line.rfind("R$")
    if idx < 0:
        return line.strip()
    return line[:idx].strip()


BlockKind = Literal[
    "DOCUMENT_HEADER",
    "RECEITAS",
    "DESPESAS",
    "RESUMO_MES",
    "RESUMO_CONTAS",
    "CONTAS_CORRENTES",
    "CONTAS_POUPANCA_APLICACAO",
    "TOTAL_GERAL",
    "FOOTER",
    "UNKNOWN",
]


def merge_wrapped_lines(lines: List[str]) -> List[str]:
    """Junta continuação sem valor monetário à linha anterior (descrição quebrada)."""
    out: List[str] = []
    for ln in lines:
        clean = normalize_line(ln)
        if not clean:
            continue
        v, _ = extract_trailing_money(clean)
        rs = parse_rs_money_from_line(clean)
        if out and v is None and rs is None and len(clean) < 120:
            if not re.match(r"^\d{1,2}/\d{1,2}/", clean):
                out[-1] = normalize_line(out[-1] + " " + clean)
                continue
        out.append(clean)
    return out


def classify_heading(line: str) -> Optional[BlockKind]:
    u = strip_accents(line).upper().strip()

    if re.search(r"RESUMO\s+DO\s+M[EÊ]S", u) and "CONTA" not in u:
        return "RESUMO_MES"
    if "RESUMO" in u and "CONTA" in u:
        return "RESUMO_CONTAS"
    if "MOVIMENTA" in u and "CONTA" in u:
        return "RESUMO_CONTAS"

    if re.search(r"CONTA\s+CORRENTE|CONTAS?\s+CORRENTES", u):
        return "CONTAS_CORRENTES"
    if any(
        x in u
        for x in (
            "POUPAN",
            "APLICACAO",
            "APLICAÇÃO",
            "RENDA FIXA",
            "CDB",
            "FUNDO",
        )
    ) and len(u) < 90:
        return "CONTAS_POUPANCA_APLICACAO"

    if "RECEITA" in u and "DESPESA" not in u and "X" not in u:
        if re.match(r"^RECEITAS?\b", u) or u.startswith("RECEITAS"):
            return "RECEITAS"
    if re.match(r"^DESPESAS?\b", u) or (u.startswith("DESPESA") and "TOTAL" not in u):
        return "DESPESAS"

    if "TOTAL" in u and "GERAL" in u and len(line) < 100:
        return "TOTAL_GERAL"

    if any(
        k in u
        for k in (
            "GERADO EM",
            "IMPRESSO EM",
            "PAGINA",
            "PÁGINA",
            "PAGE ",
            "WWW.",
            "HTTP",
        )
    ):
        return "FOOTER"

    return None


def split_document_into_semantic_blocks(merged_lines: List[str]) -> List[Tuple[BlockKind, List[str]]]:
    """Recebe linhas já unidas com `merge_wrapped_lines`."""
    blocks: List[Tuple[BlockKind, List[str]]] = []
    current: BlockKind = "DOCUMENT_HEADER"
    buf: List[str] = []

    def flush() -> None:
        nonlocal buf
        if buf:
            blocks.append((current, buf[:]))
            buf = []

    for ln in merged_lines:
        nh = classify_heading(ln)
        if nh and nh != current:
            flush()
            current = nh
            if nh in ("RECEITAS", "DESPESAS", "RESUMO_MES", "TOTAL_GERAL"):
                pass
            continue
        buf.append(ln)
    flush()

    if not blocks:
        return [("UNKNOWN", merged_lines)]
    return blocks


def sniff_metadata(lines: List[str], file_name: str) -> Dict[str, Any]:
    meta: Dict[str, Any] = {
        "fileName": file_name,
        "competenceLabel": None,
        "competenceStart": None,
        "competenceEnd": None,
        "condominiumName": None,
    }
    for ln in lines[:50]:
        ul = ln.upper()
        if "COMPETÊNCIA" in ln or "COMPETENCIA" in ln or "BALANCETE MENSAL" in ul:
            meta["competenceLabel"] = ln
        if "CONDOMÍNIO" in ln or "CONDOMINIO" in ul:
            meta["condominiumName"] = ln
    return meta


def detect_total_line(desc: str) -> bool:
    u = strip_accents(desc).upper()
    return ("TOTAL" in u and "GERAL" in u) or u.startswith("TOTAL GERAL")


def detect_subtotal_line(desc: str) -> bool:
    u = strip_accents(desc).upper()
    if detect_total_line(desc):
        return False
    return "SUBTOTAL" in u or "TOTAL PARCIAL" in u or "TOTAL GRUPO" in u


Movimento = Literal[
    "SALDO_ANTERIOR",
    "ENTRADA",
    "SAIDA",
    "SALDO_ATUAL",
    "TOTAL_DISPONIVEL",
]

_MOV_PATTERNS: List[Tuple[re.Pattern[str], Movimento]] = [
    (re.compile(r"saldo\s+anterior|acumulado\s+anterior", re.I), "SALDO_ANTERIOR"),
    (re.compile(r"\bentradas?\b|\bcreditos?\b|\bcr[eé]ditos?\b", re.I), "ENTRADA"),
    (re.compile(r"\bsa[ií]das?\b|\bdebitos?\b|\bd[eé]bitos?\b", re.I), "SAIDA"),
    (re.compile(r"transf.*\(\s*\+\s*\)|transf\.\s*\(\s*\+\s*\)", re.I), "ENTRADA"),
    (re.compile(r"transf.*\(\s*-\s*\)|transf\.\s*\(\s*-\s*\)", re.I), "SAIDA"),
    (re.compile(r"saldo\s+atual|saldo\s+final", re.I), "SALDO_ATUAL"),
    (re.compile(r"total\s+dispon[ií]vel", re.I), "TOTAL_DISPONIVEL"),
]


def classify_resumo_movimento(desc: str) -> Optional[Movimento]:
    u = strip_accents(desc).upper()
    if "TOTAL DISPONIVEL" in u or "TOTAL DISPON" in u:
        return "TOTAL_DISPONIVEL"
    if "SALDO ATUAL" in u or "SALDO FINAL" in u:
        return "SALDO_ATUAL"
    for pat, mov in _MOV_PATTERNS:
        if pat.search(desc):
            return mov
    return None


# --- Aliases de colunas para tabela financeira dinâmica ---

HEADER_ALIASES: List[Tuple[str, str]] = [
    ("SALDO ANTERIOR", "saldoAnterior"),
    ("SALDO ANT", "saldoAnterior"),
    ("CREDITO", "creditos"),
    ("CRÉDITO", "creditos"),
    ("DEBITO", "debitos"),
    ("DÉBITO", "debitos"),
    ("TRANSF", "transf"),
    ("SALDO FINAL", "saldoFinal"),
    ("SALDO ATUAL", "saldoFinal"),
]


def looks_like_financial_table_header(line: str) -> bool:
    u = strip_accents(line).upper()
    score = 0
    for alias, _ in HEADER_ALIASES:
        if strip_accents(alias).upper() in u:
            score += 1
    return score >= 2


def extract_all_money_values(line: str) -> List[float]:
    out: List[float] = []
    for m in re.finditer(r"-?\s*\d[\d\s.,]*,\d{2}", line):
        v = parse_br_money_token(m.group(0))
        if v is not None:
            out.append(float(v))
    return out


def map_numeric_row_to_canonical(nums: List[float]) -> Dict[str, float]:
    """Mapeia lista de valores na ordem visual típica (sem índices fixos de PDF)."""
    if len(nums) >= 4:
        return {
            "saldoAnterior": nums[0],
            "creditos": nums[1],
            "debitos": nums[2],
            "saldoFinal": nums[-1],
        }
    if len(nums) == 3:
        return {"creditos": nums[0], "debitos": nums[1], "saldoFinal": nums[2]}
    if len(nums) == 2:
        return {"creditos": nums[0], "saldoFinal": nums[1]}
    if len(nums) == 1:
        return {"saldoFinal": nums[0]}
    return {}


def parse_lancamentos_block(
    lines: List[str],
    macro: Literal["RECEITAS", "DESPESAS"],
    issues: List[Dict[str, Any]],
) -> Tuple[List[Dict[str, Any]], List[Dict[str, Any]]]:
    """
    Retorna (grupos canônicos, entries legados).
    grupos: {groupName, entries[], subtotal}
    """
    sinal: Literal[1, -1] = 1 if macro == "RECEITAS" else -1
    grupo = "GERAL"
    groups: List[Dict[str, Any]] = []
    current: Optional[Dict[str, Any]] = None
    legacy: List[Dict[str, Any]] = []

    def ensure_group(name: str) -> Dict[str, Any]:
        nonlocal current, groups
        for g in groups:
            if g["groupName"] == name:
                current = g
                return g
        g = {"groupName": name, "entries": [], "subtotal": None}
        groups.append(g)
        current = g
        return g

    ensure_group(grupo)

    for clean in lines:
        mhead = DATA_FORN_HEAD.match(clean)
        if mhead:
            sign = mhead.group(1)
            gname = mhead.group(2).strip()
            grupo = gname
            ensure_group(grupo)
            legacy.append(
                {
                    "secaoMacro": macro,
                    "grupoOrigem": grupo,
                    "data": None,
                    "fornecedor": None,
                    "descricao": gname,
                    "valor": 0.0,
                    "sinal": sinal,
                    "tipoLinha": "TITULO",
                    "fase": "LANCAMENTOS",
                    "linhaOriginal": clean,
                }
            )
            continue

        rs = parse_rs_money_from_line(clean)
        if rs is not None:
            desc = normalize_line(extract_desc_before_rs(clean))
            dm = DATE_PREFIX_RE.match(clean)
            data = dm.group(1) if dm else None
            body = dm.group(2).strip() if dm else clean
            desc = normalize_line(extract_desc_before_rs(body)) if "R$" in body else desc

            ul = strip_accents(desc).upper()
            tipo: Literal["ITEM", "SUBTOTAL", "TOTAL_GERAL"] = "ITEM"
            if detect_total_line(desc):
                tipo = "TOTAL_GERAL"
            elif detect_subtotal_line(desc):
                tipo = "SUBTOTAL"

            legacy.append(
                {
                    "secaoMacro": macro,
                    "grupoOrigem": grupo,
                    "data": data,
                    "fornecedor": None,
                    "descricao": desc,
                    "valor": abs(float(rs)),
                    "sinal": sinal,
                    "tipoLinha": tipo,
                    "fase": "LANCAMENTOS",
                    "linhaOriginal": clean,
                }
            )
            if tipo == "ITEM":
                ensure_group(grupo)["entries"].append(
                    {
                        "descricao": desc,
                        "fornecedor": None,
                        "mesRef": data,
                        "baixa": None,
                        "tipoPgto": None,
                        "notaFiscal": None,
                        "valor": abs(float(rs)),
                        "rawLine": clean,
                    }
                )
            continue

        money, rest = extract_trailing_money(clean)
        dm = DATE_PREFIX_RE.match(clean)
        data = dm.group(1) if dm else None
        body = dm.group(2).strip() if dm else clean
        money2, desc2 = extract_trailing_money(body)
        money = money2 if money2 is not None else money
        desc = desc2.strip() if desc2 else rest.strip()

        if not desc:
            continue

        if money is None:
            if len(desc) < 100:
                grupo = desc
                ensure_group(grupo)
                legacy.append(
                    {
                        "secaoMacro": macro,
                        "grupoOrigem": grupo,
                        "data": data,
                        "fornecedor": None,
                        "descricao": desc,
                        "valor": 0.0,
                        "sinal": sinal,
                        "tipoLinha": "TITULO",
                        "fase": "LANCAMENTOS",
                        "linhaOriginal": clean,
                    }
                )
            else:
                issues.append(
                    {
                        "type": "WARNING",
                        "code": "LANCAMENTO_UNPARSED",
                        "message": "Linha em bloco de lançamentos não classificada.",
                        "details": {"line": clean[:280], "macro": macro},
                    }
                )
            continue

        tipo = "ITEM"
        if detect_total_line(desc):
            tipo = "TOTAL_GERAL"
        elif detect_subtotal_line(desc):
            tipo = "SUBTOTAL"

        legacy.append(
            {
                "secaoMacro": macro,
                "grupoOrigem": grupo,
                "data": data,
                "fornecedor": None,
                "descricao": desc,
                "valor": abs(float(money)),
                "sinal": sinal,
                "tipoLinha": tipo,
                "fase": "LANCAMENTOS",
                "linhaOriginal": clean,
            }
        )
        if tipo == "ITEM":
            ensure_group(grupo)["entries"].append(
                {
                    "descricao": desc,
                    "fornecedor": None,
                    "mesRef": data,
                    "baixa": None,
                    "tipoPgto": None,
                    "notaFiscal": None,
                    "valor": abs(float(money)),
                    "rawLine": clean,
                }
            )

    return groups, legacy


def parse_resumo_mes_block(lines: List[str], issues: List[Dict[str, Any]]) -> Tuple[List[Dict[str, Any]], List[Dict[str, Any]]]:
    """Retorna (itens canônicos {label, valor}, entries legados fase RESUMO_MES)."""
    items: List[Dict[str, Any]] = []
    legacy: List[Dict[str, Any]] = []
    for clean in lines:
        val = parse_rs_money_from_line(clean)
        desc_src = extract_desc_before_rs(clean) if val is not None else clean
        if val is None:
            val, desc_src = extract_trailing_money(clean)
        if val is None:
            continue
        desc = desc_src.strip()
        if not desc:
            continue
        du = strip_accents(desc).upper()
        sm = "DESPESAS" if du.startswith("DESPESA") else "RECEITAS"
        items.append({"label": desc, "valor": float(val)})
        legacy.append(
            {
                "fase": "RESUMO_MES",
                "secaoMacro": sm,
                "grupoOrigem": "RESUMO_DO_MES",
                "data": None,
                "fornecedor": None,
                "descricao": desc,
                "valor": abs(float(val)),
                "sinal": 1,
                "tipoLinha": "ITEM",
                "linhaOriginal": clean,
            }
        )
    return items, legacy


def parse_resumo_contas_lines(
    lines: List[str],
    table_kind: Literal["CORRENTES", "POUPANCA"],
    issues: List[Dict[str, Any]],
) -> Tuple[Optional[Dict[str, Any]], List[Dict[str, Any]]]:
    """
    Tenta cabeçalho dinâmico; senão, modo linha-a-linha com R$ / trailing money (Belle-like).
    """
    legacy: List[Dict[str, Any]] = []
    table_name = "Contas correntes" if table_kind == "CORRENTES" else "Poupança / aplicação"
    columns: List[str] = []
    rows_out: List[Dict[str, Any]] = []

    header_idx: Optional[int] = None
    for i, ln in enumerate(lines):
        if looks_like_financial_table_header(ln):
            header_idx = i
            columns = ["saldoAnterior", "creditos", "debitos", "saldoFinal"]
            break

    if header_idx is not None:
        for ln in lines[header_idx + 1 :]:
            if looks_like_financial_table_header(ln):
                break
            nums = extract_all_money_values(ln)
            if len(nums) < 2:
                continue
            mapped = map_numeric_row_to_canonical(nums)
            money_pat = re.compile(r"-?\s*\d[\d\s.,]*,\d{2}")
            label = money_pat.sub("", ln).strip()
            label = re.sub(r"\s{2,}", " ", label)
            row = {"label": label or "—", **mapped}
            rows_out.append(row)
            legacy.extend(_legacy_from_dynamic_row(row, table_name))

        return (
            {
                "tableName": table_name,
                "columns": columns,
                "rows": rows_out,
                "totalRow": None,
            },
            legacy,
        )

    conta = "GERAL"
    for clean in lines:
        val_rs = parse_rs_money_from_line(clean)
        val = val_rs
        rest = extract_desc_before_rs(clean) if val_rs is not None else clean
        if val is None:
            val, rest = extract_trailing_money(clean)
        if val is None:
            low = strip_accents(clean).upper()
            if (
                len(clean) > 8
                and "VALOR" not in low
                and "SALDO ANTERIOR" not in low
                and not low.startswith("ENTRADAS")
                and not low.startswith("SAIDAS")
                and not low.startswith("SAÍDAS")
            ):
                conta = clean.strip()
            continue

        desc = normalize_line(rest)
        mov = classify_resumo_movimento(desc)
        if mov is None:
            issues.append(
                {
                    "type": "WARNING",
                    "code": "RESUMO_CONTA_ROW_UNKNOWN",
                    "message": "Linha financeira sem classificação de movimento.",
                    "details": {"line": clean[:240]},
                }
            )
            continue

        rows_out.append(
            {
                "label": desc,
                "conta": conta,
                "movimento": mov,
                "valor": float(val),
            }
        )
        legacy.append(
            {
                "conta": conta,
                "movimento": mov,
                "descricao": desc,
                "valor": float(val),
                "linhaOriginal": clean,
            }
        )

    if not rows_out:
        return None, legacy

    return (
        {
            "tableName": table_name,
            "columns": ["descricao", "valor", "movimento"],
            "rows": rows_out,
            "totalRow": None,
        },
        legacy,
    )


def _legacy_from_dynamic_row(row: Dict[str, Any], conta: str) -> List[Dict[str, Any]]:
    out: List[Dict[str, Any]] = []
    mapping = [
        ("saldoAnterior", "SALDO_ANTERIOR"),
        ("creditos", "ENTRADA"),
        ("debitos", "SAIDA"),
        ("saldoFinal", "SALDO_ATUAL"),
    ]
    for key, mov in mapping:
        v = row.get(key)
        if v is not None and isinstance(v, (int, float)):
            out.append(
                {
                    "conta": conta,
                    "movimento": mov,
                    "descricao": f"{row.get('label', '')} — {key}",
                    "valor": float(v),
                    "linhaOriginal": None,
                }
            )
    return out


def parse_total_geral_block(lines: List[str]) -> Optional[Dict[str, Any]]:
    for clean in lines:
        v, rest = extract_trailing_money(clean)
        if v is None:
            v = parse_rs_money_from_line(clean)
            rest = extract_desc_before_rs(clean)
        if v is not None and rest.strip():
            return {"label": rest.strip(), "valor": float(v)}
    return None


@dataclass
class SemanticAccum:
    metadata: Dict[str, Any]
    blocks_detected: List[str] = field(default_factory=list)
    receitas: List[Dict[str, Any]] = field(default_factory=list)
    despesas: List[Dict[str, Any]] = field(default_factory=list)
    resumo: List[Dict[str, Any]] = field(default_factory=list)
    contas_correntes: Optional[Dict[str, Any]] = None
    contas_poupanca: Optional[Dict[str, Any]] = None
    total_geral: Optional[Dict[str, Any]] = None
    entries: List[Dict[str, Any]] = field(default_factory=list)
    resumo_contas: List[Dict[str, Any]] = field(default_factory=list)
    issues: List[Dict[str, Any]] = field(default_factory=list)


def transform_semantic_document(lines: List[str], file_name: str) -> Dict[str, Any]:
    merged = merge_wrapped_lines(lines)
    meta = sniff_metadata(merged, file_name)
    blocks = split_document_into_semantic_blocks(merged)
    acc = SemanticAccum(metadata=meta)

    for kind, blines in blocks:
        acc.blocks_detected.append(kind)
        if kind == "DOCUMENT_HEADER":
            continue
        if kind == "FOOTER":
            continue
        if kind == "UNKNOWN":
            acc.issues.append(
                {
                    "type": "WARNING",
                    "code": "UNKNOWN_BLOCK",
                    "message": "Bloco não classificado semanticamente.",
                    "details": {"lines": len(blines)},
                }
            )
            continue

        if kind == "RECEITAS":
            groups, leg = parse_lancamentos_block(blines, "RECEITAS", acc.issues)
            acc.receitas = groups
            acc.entries.extend(leg)
            continue

        if kind == "DESPESAS":
            groups, leg = parse_lancamentos_block(blines, "DESPESAS", acc.issues)
            acc.despesas = groups
            acc.entries.extend(leg)
            continue

        if kind == "RESUMO_MES":
            items, leg = parse_resumo_mes_block(blines, acc.issues)
            acc.resumo.extend(items)
            acc.entries.extend(leg)
            continue

        if kind == "CONTAS_CORRENTES":
            tbl, leg = parse_resumo_contas_lines(blines, "CORRENTES", acc.issues)
            if tbl:
                acc.contas_correntes = tbl
            acc.resumo_contas.extend(leg)
            continue

        if kind == "CONTAS_POUPANCA_APLICACAO":
            tbl, leg = parse_resumo_contas_lines(blines, "POUPANCA", acc.issues)
            if tbl:
                acc.contas_poupanca = tbl
            acc.resumo_contas.extend(leg)
            continue

        if kind == "RESUMO_CONTAS":
            sub_correntes: List[str] = []
            sub_poupanca: List[str] = []
            mode: Optional[str] = None
            for ln in blines:
                ul = strip_accents(ln).upper()
                if re.search(r"CONTA\s+CORRENTE|CONTAS?\s+CORRENTES", ul):
                    mode = "C"
                    continue
                if any(x in ul for x in ("POUPAN", "APLICA", "CDB")) and len(ul) < 90:
                    mode = "P"
                    continue
                if mode == "C":
                    sub_correntes.append(ln)
                elif mode == "P":
                    sub_poupanca.append(ln)
                else:
                    sub_correntes.append(ln)

            if sub_correntes:
                tbl, leg = parse_resumo_contas_lines(sub_correntes, "CORRENTES", acc.issues)
                if tbl:
                    acc.contas_correntes = tbl
                acc.resumo_contas.extend(leg)
            if sub_poupanca:
                tbl2, leg2 = parse_resumo_contas_lines(sub_poupanca, "POUPANCA", acc.issues)
                if tbl2:
                    acc.contas_poupanca = tbl2
                acc.resumo_contas.extend(leg2)
            if not sub_correntes and not sub_poupanca:
                tbl, leg = parse_resumo_contas_lines(blines, "CORRENTES", acc.issues)
                if tbl:
                    acc.contas_correntes = tbl
                acc.resumo_contas.extend(leg)
            continue

        if kind == "TOTAL_GERAL":
            acc.total_geral = parse_total_geral_block(blines)
            continue

    canonical = {
        "receitas": acc.receitas,
        "despesas": acc.despesas,
        "resumo": acc.resumo,
        "contasCorrentes": acc.contas_correntes,
        "contasPoupancaAplicacao": acc.contas_poupanca,
        "totalGeral": acc.total_geral,
    }

    meta_out = {
        **acc.metadata,
        "parserLayoutId": "semantic_v1",
        "blocksDetected": acc.blocks_detected,
    }

    return {
        "schemaVersion": 2,
        "metadata": meta_out,
        "canonical": canonical,
        "entries": acc.entries,
        "resumoContas": acc.resumo_contas,
        "issues": acc.issues,
    }
