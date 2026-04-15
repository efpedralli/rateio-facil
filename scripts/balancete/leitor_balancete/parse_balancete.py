from __future__ import annotations

import re
from pathlib import Path
from typing import List, Optional

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


def _looks_like_group_label_candidate(line: str) -> bool:
    s = (line or "").strip()
    if len(s) < 3 or len(s) > 80:
        return False
    if any(ch.isdigit() for ch in s):
        return False
    if s.lower().startswith(("r$", "página ", "pagina ", "relatório", "relatorio")):
        return False
    if re.search(r"[()]", s):
        return False
    words = [w for w in re.split(r"\s+", s) if w]
    if not words or len(words) > 6:
        return False
    allowed = re.fullmatch(r"[A-Za-zÀ-ÿ0-9/&.,\- ]+", s)
    if not allowed:
        return False
    if len(words) == 1:
        return words[0][0].isupper()
    capitals = sum(1 for w in words if w[:1].isupper())
    return capitals >= max(2, len(words) - 1)


def _is_account_table_header(line: str) -> bool:
    low = (line or "").lower()
    if "saldo anterior" not in low:
        return False
    if "saldo final" not in low:
        return False
    return "créditos" in low or "creditos" in low or "débitos" in low or "debitos" in low


def _looks_like_account_name(line: str) -> bool:
    s = (line or "").strip()
    if len(s) < 3 or len(s) > 120:
        return False
    if _is_account_table_header(s):
        return False
    if re.match(r"^0\d\s*[-–]\s*", s):
        return False
    if re.match(r"^\d+\s*[-–]\s*", s):
        return True
    if any(
        x in s.lower()
        for x in ("conta movimento", "fundo ", "poupança", "poupanca", "investimento")
    ):
        return True
    words = s.split()
    return s.isupper() and 1 <= len(words) <= 4


def _should_skip_text_line(line: str) -> bool:
    low = (line or "").lower().strip()
    if not low:
        return True
    if low.startswith("página ") or low.startswith("pagina "):
        return True
    if low.startswith("relatório emitido") or low.startswith("relatorio emitido"):
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
    expect_new_group = False

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
            expect_new_group = True
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
            expect_new_group = True
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
            expect_new_group = False
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
        if "contas correntes" in low:
            phase = "contas"
            bloco = "CONTAS_CORRENTES"
            categoria = ""
            expect_new_group = False
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
        if "contas poupan" in low or "poupança/aplicação" in low or "poupanca/aplicacao" in low:
            phase = "poupanca"
            bloco = "CONTAS_POUPANCA"
            categoria = ""
            expect_new_group = False
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

        if phase in ("contas", "poupanca") and _is_account_table_header(line):
            expect_new_group = False
            continue

        if phase in ("contas", "poupanca") and not lm and _looks_like_account_name(line):
            categoria = line.strip()
            expect_new_group = False
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

        if (
            phase in ("receitas", "despesas")
            and not lm
            and _looks_like_group_label_candidate(line)
            and (expect_new_group or not categoria)
        ):
            categoria = line.strip()
            expect_new_group = False
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

        if is_header and not lm:
            categoria = line.strip()
            expect_new_group = False
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
                if phase in ("contas", "poupanca"):
                    _append(
                        rows,
                        arquivo=arquivo,
                        condominio=condominio,
                        periodo=periodo,
                        bloco=bloco,
                        categoria=categoria,
                        descricao="Saldo Final",
                        valor=val,
                        tipo_linha="resumo",
                    )
                elif phase in ("receitas", "despesas"):
                    expect_new_group = True
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
            expect_new_group = tipo == "total"
            continue

        # Linha descritiva sem valor (subtítulo)
        if len(line) < 160:
            if _should_skip_text_line(line):
                continue
            expect_new_group = False
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
    expect_new_group = False

    for line in lines:
        low = line.lower()
        if "condomínio" in low or "cond." in low[:20]:
            ex = extract_condominio(line)
            if ex:
                condominio = ex
            elif not condominio and len(line) < 100 and "demonstrativo" not in low:
                condominio = line.strip()

        if (
            "receitas/histórico" in low
            or "receitas/historico" in low
            or "receitas / histórico" in low
            or "receitas / historico" in low
        ):
            phase = "receitas"
            bloco = "RECEITAS"
            expect_new_group = True
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

        if (
            "despesas/histórico" in low
            or "despesas/historico" in low
            or "despesas / histórico" in low
            or "despesas / historico" in low
        ):
            phase = "despesas"
            bloco = "DESPESAS"
            expect_new_group = True
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
            expect_new_group = False
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

        if "contas correntes" in low and (
            "valores" in low or "saldo anterior" in low or "créditos" in low or "creditos" in low
        ):
            phase = "contas"
            bloco = "CONTAS_CORRENTES"
            categoria = ""
            expect_new_group = False
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

        if "contas poupan" in low or "poupança/aplicação" in low or "poupanca/aplicacao" in low:
            phase = "poupanca"
            bloco = "CONTAS_POUPANCA"
            categoria = ""
            expect_new_group = False
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
            if phase in ("contas", "poupanca"):
                if _is_account_table_header(stripped) or _should_skip_text_line(stripped):
                    continue
                if _looks_like_account_name(stripped):
                    categoria = stripped
                    expect_new_group = False
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
            if (
                phase in ("receitas", "despesas")
                and _looks_like_group_label_candidate(stripped)
                and (expect_new_group or not categoria)
            ):
                categoria = stripped
                expect_new_group = False
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
                        expect_new_group = False
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
                if phase in ("contas", "poupanca"):
                    _append(
                        rows,
                        arquivo=arquivo,
                        condominio=condominio,
                        periodo=periodo,
                        bloco=bloco,
                        categoria=categoria,
                        descricao="Saldo Final",
                        valor=val,
                        tipo_linha="resumo",
                    )
                elif phase in ("receitas", "despesas"):
                    expect_new_group = True
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
            expect_new_group = tipo == "total"
            continue

    return rows


def _is_orcamento_previsao(text: str) -> bool:
    """Previsão / composição de orçamento (Concept e similares), não balancete demonstrativo."""
    t = text.lower()
    if "rateados na taxa" in t:
        return True
    if "previsão" in t and "orçamento" in t:
        return True
    if "previsao" in t and "orcamento" in t:
        return True
    if "composição" in t and "orçamento" in t:
        return True
    if "composicao" in t and "orcamento" in t:
        return True
    if "oramento mensal" in t:  # encoding quebrado de 'orçamento'
        return True
    return False


def parse_orcamento_previsao(
    lines: List[str],
    arquivo: str,
    condominio: str,
    periodo: str,
) -> List[LinhaNormalizada]:
    """
    Layout 'Previsão/Composição de Orçamento Mensal': blocos com percentual (Taxas - 39%),
    linhas com valor ao fim; totais 'Total:'.
    Saída no mesmo modelo LinhaNormalizada (bloco DESPESAS como composição de gastos previstos).
    """
    rows: List[LinhaNormalizada] = []
    bloco = "DESPESAS"
    categoria = ""
    seen_tabela = False

    for line in lines:
        low = line.lower().strip()
        if "condomínio" in low or "condominio" in low:
            ex = extract_condominio(line)
            if ex:
                condominio = ex

        if "valores rateados" in low or "classe da conta" in low:
            seen_tabela = True
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

        # Cabeçalho de grupo: "Taxas Mensais - 39%" ou "Manutenção e Conservação - 41%"
        if re.search(r"\s-\s*\d{1,3}\s*%", line) and len(line) < 140:
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

        lm = last_money_on_line(line)
        if lm:
            val, before = lm
            desc = before.strip()
            if _is_pure_amount_label(desc):
                continue
            ld = desc.lower()
            tipo = "item"
            if ld.startswith("total") or low.startswith("total:"):
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

        if seen_tabela and len(line.strip()) < 200:
            if "emitido em" in low or "página" in low and "/" in line:
                continue
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


def detect_profile(text: str) -> str:
    """
    Ordem importa: administradoras Confiance usam o mesmo texto 'Receitas / Histórico'
    que o layout Ernest; por isso 'confiance' no PDF deve vir antes de receitas/histórico.
    """
    t = text.lower()
    if _is_orcamento_previsao(text):
        return "orcamento_previsao"
    if "ernest gardemann" in t or "mês ref." in t or "mes ref." in t:
        return "ernest"
    # Confiance no cabeçalho/rodapé (ex.: BAL 012026 resumido.pdf)
    if "confiance" in t:
        return "confiance"
    # G.K.B. e similares: sem Confiance, mas com colunas Ref/Baixa (Receitas / Histórico com espaços)
    if "g.k.b." in t or "gkbsindico" in t or "gkb sindicos" in t:
        return "ernest"
    if "receitas/histórico" in t or "receitas/historico" in t:
        return "ernest"
    if "receitas / histórico" in t or "receitas / historico" in t:
        return "ernest"
    if "demonstrativo de receitas e despesas" in t and "parcela" not in t:
        return "confiance"
    return "confiance"


def parse_pdf(path: Path) -> List[LinhaNormalizada]:
    arquivo = path.name
    text = extract_full_text(path)
    periodo = extract_periodo(text)
    condominio = extract_condominio_principal(text)
    lines = _clean_lines(text)

    profile = detect_profile(text)
    if profile == "orcamento_previsao":
        rows = parse_orcamento_previsao(lines, arquivo, condominio, periodo)
    elif profile == "ernest":
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


