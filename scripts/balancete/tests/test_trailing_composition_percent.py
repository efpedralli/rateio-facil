"""Testes da heurística [valor][%] no fim da linha (receitas tabulares)."""

from __future__ import annotations

import sys
from pathlib import Path

import pytest

BALANCETE_DIR = Path(__file__).resolve().parents[1]
if str(BALANCETE_DIR) not in sys.path:
    sys.path.insert(0, str(BALANCETE_DIR))

from block_detector import detect_blocks  # noqa: E402
from line_classifier import classify_lines  # noqa: E402
from tokenizer import (  # noqa: E402
    pre_normalize_line_for_ocr,
    refine_trailing_composition_amounts,
    tokenize,
)


def _pipeline_one(raw: str, block: str = "RECEITAS") -> dict:
    tokens = tokenize([pre_normalize_line_for_ocr(raw)])
    tokens[0]["block"] = block
    tokens = classify_lines(tokens)
    refine_trailing_composition_amounts(tokens)
    return tokens[0]


def test_receita_taxa_condominio_valor_e_percentual():
    t = _pipeline_one("Taxa de Condomínio 20.818,90 55,70")
    assert t["valor"] == pytest.approx(20818.90)
    assert t["composition_percent"] == pytest.approx(55.70)
    assert t.get("value_selection_reason") == "trailing_composition_percent"
    assert t.get("percentage_detected") is True
    assert t.get("value_selection_strategy") == "penultimate_amount_trailing_percent"
    assert t.get("percentage_reason") == "ok"


def test_receita_fundo_reserva_valor_e_percentual():
    t = _pipeline_one("Fundo de Reserva 2.081,89 5,57")
    assert t["valor"] == pytest.approx(2081.89)
    assert t["composition_percent"] == pytest.approx(5.57)


def test_receita_apenas_totais_na_linha_valor_e_percentual():
    t = _pipeline_one("37.379,10 100,00")
    assert t["valor"] == pytest.approx(37379.10)
    assert t["composition_percent"] == pytest.approx(100.00)


def test_receita_com_rs_sem_composition_percent():
    t = _pipeline_one("Receita Mensal - Fundo de Obra R$ 4.840,00")
    assert t["valor"] == pytest.approx(4840.00)
    assert "composition_percent" not in t


def test_despesa_irrf_sem_composition_percent_linha_completa():
    """Heurística de % não deve ativar em DESPESAS; linha tem só um valor com vírgula (14,11)."""
    t = _pipeline_one(
        "Despesas Bancárias - Sicredi - IRRF 02/2026 27/02/2026 Débito Aut. 14,11",
        block="DESPESAS",
    )
    assert "composition_percent" not in t
    assert t.get("value_selection_reason") is None
    assert t["valor"] == pytest.approx(14.11)
    assert t.get("value_selection_strategy") == "despesa_last_reliable_amount"
    assert t.get("percentage_detected") is False


def test_despesa_valor_unico_no_fim():
    """Uma despesa com único valor monetário explícito permanece interpretável (regressão)."""
    t = _pipeline_one("Despesas Bancárias - Sicredi Débito Aut. 14,11", block="DESPESAS")
    assert t["valor"] == pytest.approx(14.11)
    assert "composition_percent" not in t


def test_despesa_material_limpeza_sem_composition():
    t = _pipeline_one("Material de Limpeza - Condor - Mercado 42,36", block="DESPESAS")
    assert t["valor"] == pytest.approx(42.36)
    assert t.get("percentage_detected") is False
    assert "composition_percent" not in t


def test_despesa_jardim_valor_unico():
    t = _pipeline_one("Jardim - Flores Estação - Manutenção 125,00", block="DESPESAS")
    assert t["valor"] == pytest.approx(125.00)
    assert t.get("percentage_detected") is False


def test_despesa_seguro_predial_valor_unico():
    # Evitar ano solto (ex.: 2026) ser capturado como "202" pelo regex monetário largo.
    t = _pipeline_one("Seguro Predial - Apólice ref 01/2026 820,02", block="DESPESAS")
    assert t["valor"] == pytest.approx(820.02)
    assert t.get("percentage_detected") is False


def test_receita_mal_classificada_despesa_dois_valores_nao_pega_percentual():
    """Dois montantes pequenos não seguem razão valor/%; não deve tratar último como %."""
    t = _pipeline_one("Material de Limpeza - Condor 1,00 42,36", block="RECEITAS")
    assert t.get("percentage_detected") is False
    assert "composition_percent" not in t


def test_simula_pdf_coluna_percentual_primeiro_receitas_corrige():
    """% antes do valor com texto no meio: não é par [valor][%] colado; montante é o maior no fim."""
    raw = "55,70 Taxa de Condomínio 20.818,90"
    tokens = tokenize([pre_normalize_line_for_ocr(raw)])
    tokens[0]["block"] = "RECEITAS"
    tokens = classify_lines(tokens)
    refine_trailing_composition_amounts(tokens)
    t = tokens[0]
    assert t["valor"] == pytest.approx(20818.90)
    assert "composition_percent" not in t


def test_receitas_com_cabecalho_sticky_block():
    lines = [
        pre_normalize_line_for_ocr(x)
        for x in (
            "Receitas do período",
            "Taxa de Condomínio 20.818,90 55,70",
            "37.379,10 100,00",
        )
    ]
    tokens = tokenize(lines)
    tokens = detect_blocks(tokens)
    tokens = classify_lines(tokens)
    refine_trailing_composition_amounts(tokens)
    assert tokens[1]["valor"] == pytest.approx(20818.90)
    assert tokens[1]["composition_percent"] == pytest.approx(55.70)
    assert tokens[2]["valor"] == pytest.approx(37379.10)
    assert tokens[2]["composition_percent"] == pytest.approx(100.00)


@pytest.mark.skipif(
    not (Path(__file__).resolve().parents[3] / "models" / "belle_chateau.pdf").is_file(),
    reason="PDF BELLE ausente",
)
def test_belle_pdf_regression_parse_sem_erro():
    from parse_balancete import parse_pdf

    pdf = Path(__file__).resolve().parents[3] / "models" / "belle_chateau.pdf"
    out = parse_pdf(pdf)
    assert out.get("status") in ("OK", "LOW_CONFIDENCE")
    data = (out.get("data") or {})
    entries = data.get("entries") or []
    assert len(entries) > 0
