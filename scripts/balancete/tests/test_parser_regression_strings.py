"""Regressão: cabeçalhos de bloco, OCR R$, valores em linhas com data/ref, Dom Felipe, Dourados."""

from __future__ import annotations

import sys
from pathlib import Path

import pytest

BALANCETE_DIR = Path(__file__).resolve().parents[1]
if str(BALANCETE_DIR) not in sys.path:
    sys.path.insert(0, str(BALANCETE_DIR))

from block_detector import detect_blocks, is_strong_block_header  # noqa: E402
from line_classifier import classify_lines  # noqa: E402
from tokenizer import (  # noqa: E402
    pre_normalize_line_for_ocr,
    refine_trailing_composition_amounts,
    tokenize,
)


def _run_pipeline(lines: list[str]) -> list[dict]:
    norm = [pre_normalize_line_for_ocr(x.strip()) for x in lines if x.strip()]
    tokens = tokenize(norm)
    tokens = detect_blocks(tokens)
    tokens = classify_lines(tokens)
    tokens = refine_trailing_composition_amounts(tokens)
    return tokens


def _find_line_token(tokens: list[dict], substr: str) -> dict:
    for t in tokens:
        if substr in (t.get("raw") or ""):
            return t
    raise AssertionError(f"linha com {substr!r} não encontrada")


# --- Belle / cabeçalho forte ---


def test_belle_fundo_obra_rs_ocr_espaco():
    raw = "19/02/2026 FUNDO DE OBRA R$ 4 .840,00"
    t = _run_pipeline([raw])[0]
    assert t["valor"] == pytest.approx(4840.00)


def test_belle_poupanca_rs_ocr_espaco():
    raw = "19/02/2026 POUPANÇA PERMANENTE R$ 2 .200,00"
    t = _run_pipeline([raw])[0]
    assert t["valor"] == pytest.approx(2200.00)


def test_belle_receitas_mensais_total_grupo():
    raw = "Receitas Mensais - Total Grupo R$ 8 .800,00"
    t = _run_pipeline([raw])[0]
    assert t["valor"] == pytest.approx(8800.00)


def test_belle_receitas_financeiras_total_grupo():
    raw = "Receitas Financeiras - Total Grupo R$ 8.777,32"
    t = _run_pipeline([raw])[0]
    assert t["valor"] == pytest.approx(8777.32)


def test_belle_linha_com_despesas_no_meio_permance_receitas():
    lines = [
        "Receitas do período",
        "10/02/2026 CONDÔMINOS DO CONDOMÍNIO DESPESAS ORDINÁRIAS - MÊS ANTERIOR R$ 11.405,68",
    ]
    tokens = _run_pipeline(lines)
    row = tokens[1]
    assert row["block"] == "RECEITAS"
    assert row["valor"] == pytest.approx(11405.68)


# --- Dom Felipe (precisam de bloco RECEITAS explícito no PDF) ---


def test_dom_felipe_taxa_composicao():
    tokens = _run_pipeline(["Receitas do período", "Taxa de Condomínio 20.818,90 55,70"])
    t = tokens[1]
    assert t["valor"] == pytest.approx(20818.90)
    assert t.get("composition_percent") == pytest.approx(55.70)


def test_dom_felipe_seguro_parcela_e_composicao():
    tokens = _run_pipeline(["Receitas do período", "Seguro - P. 04/06 819,96 2,19"])
    t = tokens[1]
    assert t["valor"] == pytest.approx(819.96)
    assert t.get("composition_percent") == pytest.approx(2.19)


def test_dom_felipe_total_linha():
    tokens = _run_pipeline(["Receitas do período", "37.379,10 100,00"])
    t = tokens[1]
    assert t["valor"] == pytest.approx(37379.10)
    assert t.get("composition_percent") == pytest.approx(100.00)


# --- Dourados ---


def test_dourados_taxa_ref_mm_yy():
    t = _run_pipeline(["Taxa de Condomínio - Ref: 02/26 16.713,53"])[0]
    assert t["valor"] == pytest.approx(16713.53)


def test_dourados_darf_receita_federal_bloco_despesas():
    lines = [
        "Despesas do período",
        "DARF - Receita Federal - PIS (8301) 01/2026 19/02/2026 Guia 456,64",
    ]
    tokens = _run_pipeline(lines)
    row = _find_line_token(tokens, "DARF")
    assert row["block"] == "DESPESAS"
    assert row["valor"] == pytest.approx(456.64)


def test_dourados_assist_medica():
    t = _run_pipeline(["Assist. Médica - Secovimed - Plano 169,09"])[0]
    assert t["valor"] == pytest.approx(169.09)


def test_dourados_vale_transporte_imperial():
    t = _run_pipeline(["Vale Transporte - Imperial - Bilhetes 22,00"])[0]
    assert t["valor"] == pytest.approx(22.00)


def test_dourados_vale_transporte_metrocard():
    t = _run_pipeline(["Vale Transporte - Metrocard - Recarga 272,69"])[0]
    assert t["valor"] == pytest.approx(272.69)


# --- block_detector ---


def test_is_strong_block_header_receita_federal_nao_eh_header():
    raw = "DARF - Receita Federal - PIS (8301) 01/2026 Guia 456,64"
    clean = " ".join(raw.lower().split())
    assert is_strong_block_header(raw, clean) is None


def test_is_strong_block_header_despesas_no_meio():
    raw = "10/02/2026 ALGO DESPESAS ORDINÁRIAS R$ 100,00"
    clean = " ".join(raw.lower().split())
    assert is_strong_block_header(raw, clean) is None


def test_is_strong_block_header_receitas_inicio():
    raw = "Receitas do período"
    clean = " ".join(raw.lower().split())
    assert is_strong_block_header(raw, clean) == "RECEITAS"


# --- PDFs (totais esperados pelo usuário; skip se arquivos ausentes) ---

ROOT = Path(__file__).resolve().parents[3]


def _sum_items(data: dict, bloco: str) -> float:
    total = 0.0
    for e in data.get("entries") or []:
        if e.get("bloco") != bloco or e.get("tipo") != "item":
            continue
        v = e.get("valor")
        if v is not None:
            total += float(v)
    return total


def _find_resumo_val(desc_substr: str, data: dict) -> float | None:
    for r in data.get("resumo") or []:
        d = str(r.get("descricao") or "").lower()
        if desc_substr in d and r.get("valor") is not None:
            return float(r["valor"])
    return None


@pytest.mark.parametrize(
    "pdf_name,exp_rec,exp_desp,exp_saldo",
    [
        ("belle_chateau.pdf", 34369.51, 24834.41, 9535.10),
        ("dom_felipe.pdf", 37379.10, 32373.62, 5005.48),
        ("dourados.pdf", 16818.77, 16806.59, 12.18),
    ],
)
def test_pdf_totals_when_file_present(
    pdf_name: str, exp_rec: float, exp_desp: float, exp_saldo: float
):
    import os

    if os.environ.get("BALANCETE_STRICT_TOTALS") != "1":
        pytest.skip(
            "Defina BALANCETE_STRICT_TOTALS=1 para validar somas dos PDFs em models/."
        )

    pdf = ROOT / "models" / pdf_name
    if not pdf.is_file():
        pytest.skip(f"PDF ausente: {pdf}")

    from parse_balancete import parse_pdf

    out = parse_pdf(pdf)
    data = out.get("data") or {}
    assert out.get("status") in ("OK", "LOW_CONFIDENCE")
    assert len(data.get("entries") or []) > 0

    sum_r = _sum_items(data, "RECEITAS")
    sum_d = _sum_items(data, "DESPESAS")
    assert sum_r == pytest.approx(exp_rec, abs=15.0)
    assert sum_d == pytest.approx(exp_desp, abs=15.0)
    saldo = _find_resumo_val("saldo", data)
    if saldo is not None:
        assert saldo == pytest.approx(exp_saldo, abs=15.0)
