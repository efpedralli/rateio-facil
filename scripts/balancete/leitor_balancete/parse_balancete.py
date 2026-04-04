from __future__ import annotations

import re
from pathlib import Path
from typing import List

from .extract_pdf import extract_full_text
from .metadata import (
    extract_condominio,
    extract_condominio_principal,
    extract_periodo,
)
from .models import LinhaNormalizada
from .money import last_money_on_line

SKIP_LINE_SUBSTR = (
    "confiance administradora",
    "ernest gardemann",
    "endereço:",
    "fone:",
    "e-mail:",
    "corporate (sql server)",
    "group software",
    "www.",
    "http://",
    "https://",
)

RE_HEADER_NOISE = re.compile(
    r"^(DEMONSTRATIVO|Demonstrativo)\s+(PARCIAL|DE RECEITAS)",
    re.IGNORECASE,
)


def _clean_lines(text: str) -> List[str]:
    out: List[str] = []
    for raw in text.splitlines():
        line = raw.strip()
        if not line:
            continue
        low = line.lower()
        if any(x in low for x in SKIP_LINE_SUBSTR):
            continue
        if RE_HEADER_NOISE.match(line):
            continue
        out.append(line)
    return out


def _append(
    rows: List[LinhaNormalizada],
    *,
    arquivo: str,
    condominio: str,
    periodo: str,
    bloco: str,
    categoria: str,
    descricao: str,
    valor: Optional[float],
    tipo_linha: str,
) -> None:
    rows.append(
        LinhaNormalizada(
            arquivo_origem=arquivo,
            condominio=condominio,
            periodo=periodo,
            bloco=bloco,
            categoria=categoria,
            descricao=descricao,
            valor=valor,
            tipo_linha=tipo_linha,
        )
    )


def _is_pure_amount_label(desc: str) -> bool:
    """Linha que é só valor (subtotal duplicado), ex. 'R$44.490,39' ou '16.713,53'."""
    d = (desc or "").strip()
    if not d:
        return True
    if len(d) > 40:
        return False
    if re.match(r"^(?:R\$\s*)?[\d\.\-]+,\d{2}$", d):
        return True
    return bool(re.match(r"^R\$\s*[\d\.\-]+,\d{2}$", d))


def _looks_like_section_header(line: str, has_money: bool) -> bool:
    if has_money:
        return False
    s = line.strip()
    if len(s) < 3 or len(s) > 200:
        return False
    # Linhas só com palavras-chave de agrupamento
    up = s.upper()
    keys = (
        "RECEITA",
        "DESPESAS",
        "RESUMO",
        "CONTAS CORRENTES",
        "CONTAS POUPAN",
        "MANUTEN",
        "REFORMAS",
        "FUNDO SAL",
        "DEMONSTRATIVO",
        "BALANCETE",
        "RECEITAS/",
        "DESPESAS/",
    )
    if any(k in up for k in keys):
        # Evita frases longas de descrição sem número
        if len(s) < 90:
            return True
    # Tudo em maiúsculas (tolerante a acentos perdidos)
    letters = [c for c in s if c.isalpha()]
    if letters and sum(1 for c in letters if c.isupper()) / len(letters) > 0.85 and len(s) < 80:
        return True
    return False


def parse_confiance_layout(
    lines: List[str],
    arquivo: str,
    condominio: str,
    periodo: str,
) -> List[LinhaNormalizada]:
    rows: List[LinhaNormalizada] = []
    bloco = "GERAL"
    categoria = ""
    phase = "geral"

    for line in lines:
        low = line.lower()
        if "demonstrativo de receitas e despesas" in low and not periodo:
            # período pode estar na mesma linha
            periodo = extract_periodo(line) or periodo

        if (not condominio) and ("condomínio" in low or "condominio" in low):
            ex = extract_condominio(line)
            if ex:
                condominio = ex

        if line.strip().startswith("Receitas /") or "receitas / histórico" in low:
            phase = "receitas"
            bloco = "RECEITAS"
            _append(
                rows,
                arquivo=arquivo,
                condominio=condominio,
                periodo=periodo,
                bloco=bloco,
                categoria="",
                descricao=line.strip(),
                valor=None,
                tipo_linha="secao",
            )
            continue
        if line.strip().startswith("Despesas /") or "despesas / histórico" in low:
            phase = "despesas"
            bloco = "DESPESAS"
            _append(
                rows,
                arquivo=arquivo,
                condominio=condominio,
                periodo=periodo,
                bloco=bloco,
                categoria="",
                descricao=line.strip(),
                valor=None,
                tipo_linha="secao",
            )
            continue
        if line.strip().lower() == "resumo" or (
            line.strip().lower().startswith("resumo") and len(line) < 20
        ):
            phase = "resumo"
            bloco = "RESUMO"
            categoria = ""
            _append(
                rows,
                arquivo=arquivo,
                condominio=condominio,
                periodo=periodo,
                bloco=bloco,
                categoria="",
                descricao="RESUMO",
                valor=None,
                tipo_linha="secao",
            )
            continue
        if "contas correntes" in low and "saldo" not in low:
            phase = "contas"
            bloco = "CONTAS_CORRENTES"
            categoria = ""
            _append(
                rows,
                arquivo=arquivo,
                condominio=condominio,
                periodo=periodo,
                bloco=bloco,
                categoria="",
                descricao=line.strip(),
                valor=None,
                tipo_linha="secao",
            )
            continue
        if "contas poupan" in low or "poupança/aplicação" in low:
            phase = "poupanca"
            bloco = "CONTAS_POUPANCA"
            categoria = ""
            _append(
                rows,
                arquivo=arquivo,
                condominio=condominio,
                periodo=periodo,
                bloco=bloco,
                categoria="",
                descricao=line.strip(),
                valor=None,
                tipo_linha="secao",
            )
            continue

        lm = last_money_on_line(line)
        is_header = _looks_like_section_header(line, bool(lm))

        if is_header and not lm:
            categoria = line.strip()
            _append(
                rows,
                arquivo=arquivo,
                condominio=condominio,
                periodo=periodo,
                bloco=bloco,
                categoria=categoria,
                descricao="",
                valor=None,
                tipo_linha="categoria",
            )
            continue

        if lm:
            val, before = lm
            desc = before.strip()
            if _is_pure_amount_label(desc):
                continue
            low_before = desc.lower()
            tipo = "item"
            if "total" in low_before and (
                "total de" in low_before or low_before.startswith("total:")
            ):
                tipo = "total"
            if desc.lower().startswith("total contas"):
                tipo = "total"
            _append(
                rows,
                arquivo=arquivo,
                condominio=condominio,
                periodo=periodo,
                bloco=bloco,
                categoria=categoria,
                descricao=desc or line.strip(),
                valor=val,
                tipo_linha=tipo,
            )
            continue

        # Linha descritiva sem valor (subtítulo)
        if len(line) < 160:
            _append(
                rows,
                arquivo=arquivo,
                condominio=condominio,
                periodo=periodo,
                bloco=bloco,
                categoria=categoria,
                descricao=line.strip(),
                valor=None,
                tipo_linha="texto",
            )

    return rows


def parse_ernest_tabular(
    lines: List[str],
    arquivo: str,
    condominio: str,
    periodo: str,
) -> List[LinhaNormalizada]:
    """Layout tipo Condomínio21 / Ernest: colunas com datas e valor no fim."""
    rows: List[LinhaNormalizada] = []
    bloco = "GERAL"
    categoria = ""
    phase = "cabecalho"

    for line in lines:
        low = line.lower()
        if "condomínio" in low or "cond." in low[:20]:
            ex = extract_condominio(line)
            if ex:
                condominio = ex
            elif not condominio and len(line) < 100 and "demonstrativo" not in low:
                condominio = line.strip()

        if "receitas/histórico" in low or "receitas/historico" in low:
            phase = "receitas"
            bloco = "RECEITAS"
            _append(
                rows,
                arquivo=arquivo,
                condominio=condominio,
                periodo=periodo,
                bloco=bloco,
                categoria="",
                descricao=line.strip(),
                valor=None,
                tipo_linha="secao",
            )
            continue

        if "despesas/histórico" in low or "despesas/historico" in low:
            phase = "despesas"
            bloco = "DESPESAS"
            _append(
                rows,
                arquivo=arquivo,
                condominio=condominio,
                periodo=periodo,
                bloco=bloco,
                categoria="",
                descricao=line.strip(),
                valor=None,
                tipo_linha="secao",
            )
            continue

        if line.strip().lower() == "resumo" or (
            line.strip().upper() == "RESUMO" and len(line) < 15
        ):
            phase = "resumo"
            bloco = "RESUMO"
            categoria = ""
            _append(
                rows,
                arquivo=arquivo,
                condominio=condominio,
                periodo=periodo,
                bloco=bloco,
                categoria="",
                descricao="RESUMO",
                valor=None,
                tipo_linha="secao",
            )
            continue

        if "contas correntes" in low and "valores" in low:
            phase = "contas"
            bloco = "CONTAS_CORRENTES"
            categoria = ""
            _append(
                rows,
                arquivo=arquivo,
                condominio=condominio,
                periodo=periodo,
                bloco=bloco,
                categoria="",
                descricao=line.strip(),
                valor=None,
                tipo_linha="secao",
            )
            continue

        lm = last_money_on_line(line)
        # Cabeçalho de tabela de despesas (colunas)
        if "parcela" in low and "mês ref" in low:
            continue
        if "valores em r$" in low and len(line) < 40:
            continue

        # Categoria sem valor: linha curta, title case ou caps
        if not lm:
            stripped = line.strip()
            if len(stripped) < 120 and len(stripped) > 2:
                # Ignora linhas de continuação muito longas sem valor (multiline item)
                if phase == "despesas" and not stripped[0].isdigit():
                    # Heurística: se parece nome de grupo (sem números no início)
                    if any(
                        x in stripped.lower()
                        for x in (
                            "despesa",
                            "conserva",
                            "contrato",
                            "obras",
                            "consumo",
                            "administrativ",
                            "bancári",
                            "bancari",
                            "móveis",
                            "moveis",
                            "receitas",
                        )
                    ):
                        categoria = stripped
                        _append(
                            rows,
                            arquivo=arquivo,
                            condominio=condominio,
                            periodo=periodo,
                            bloco=bloco,
                            categoria=categoria,
                            descricao="",
                            valor=None,
                            tipo_linha="categoria",
                        )
                        continue
                if stripped.lower() in ("receitas", "total:"):
                    if stripped.lower() == "receitas":
                        categoria = "Receitas"
                    continue

        if lm:
            val, before = lm
            desc = before.strip()
            if _is_pure_amount_label(desc):
                continue
            tipo = "item"
            ld = desc.lower()
            if "total de receitas" in ld or "total de despesas" in ld:
                tipo = "total"
            if ld.startswith("total:") and len(ld) < 40:
                tipo = "total"
            if "saldo anterior" in ld or "saldo atual" in ld or "saldo do mês" in ld:
                tipo = "resumo"
            if ld.startswith("total de receitas") or ld.startswith("total de despesas"):
                tipo = "total"
            cat = categoria if phase not in ("resumo", "contas") else ""
            _append(
                rows,
                arquivo=arquivo,
                condominio=condominio,
                periodo=periodo,
                bloco=bloco,
                categoria=cat,
                descricao=desc or line.strip(),
                valor=val,
                tipo_linha=tipo,
            )
            continue

    return rows


def detect_profile(text: str) -> str:
    t = text.lower()
    if "ernest gardemann" in t or "mês ref." in t or "mes ref." in t:
        return "ernest"
    if "confiance" in t or ("demonstrativo de receitas e despesas" in t and "parcela" not in t):
        return "confiance"
    if "receitas/histórico" in t or "receitas/historico" in t:
        return "ernest"
    return "confiance"


def parse_pdf(path: Path) -> List[LinhaNormalizada]:
    arquivo = path.name
    text = extract_full_text(path)
    periodo = extract_periodo(text)
    condominio = extract_condominio_principal(text)
    lines = _clean_lines(text)

    profile = detect_profile(text)
    if profile == "ernest":
        rows = parse_ernest_tabular(lines, arquivo, condominio, periodo)
    else:
        rows = parse_confiance_layout(lines, arquivo, condominio, periodo)

    # Preenche metadados em linhas vazias
    for r in rows:
        if not r.periodo and periodo:
            r.periodo = periodo
        if not r.condominio and condominio:
            r.condominio = condominio

    return rows


