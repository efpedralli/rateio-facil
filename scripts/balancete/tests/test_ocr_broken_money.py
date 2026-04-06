"""OCR: dígitos partidos por espaço após R$ (tokenizer._normalize_ocr_broken_money)."""

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
    _normalize_ocr_broken_money,
    pre_normalize_line_for_ocr,
    refine_trailing_composition_amounts,
    tokenize,
)


@pytest.mark.parametrize(
    "line,expected_val",
    [
        ("R$ 4 4,00", 44.00),
        ("R$ 9 0,52", 90.52),
        ("R$ 2 4,25", 24.25),
        ("R$ 6 4.681,71", 64681.71),
        ("R$ 1 0.828,12", 10828.12),
    ],
)
def test_tokenize_rs_digit_space_recomposed(line: str, expected_val: float):
    t = tokenize([pre_normalize_line_for_ocr(line)])[0]
    assert t["valor"] == pytest.approx(expected_val)


def test_normalize_function_idempotent_rs_examples():
    assert _normalize_ocr_broken_money("R$ 4 4,00") == "R$ 44,00"
    assert _normalize_ocr_broken_money("R$ 9 0,52") == "R$ 90,52"
    assert _normalize_ocr_broken_money("R$ 64.681,71") == "R$ 64.681,71"


def test_dates_and_slash_segments_not_altered():
    base = "19/02/2026 Serviço 02/26 ref 04/06 P. 04/06"
    assert _normalize_ocr_broken_money(base) == base
    line = f"{base} R$ 4 4,00"
    norm = _normalize_ocr_broken_money(line)
    assert "19/02/2026" in norm
    assert "02/26" in norm
    assert "04/06" in norm
    assert "R$ 44,00" in norm


def test_receita_percentual_sem_rs_inalterada():
    lines = [
        pre_normalize_line_for_ocr(x)
        for x in ("Receitas do período", "Taxa de Condomínio 20.818,90 55,70")
    ]
    tokens = tokenize(lines)
    tokens = detect_blocks(tokens)
    tokens = classify_lines(tokens)
    refine_trailing_composition_amounts(tokens)
    t = tokens[1]
    assert t["valor"] == pytest.approx(20818.90)
    assert t.get("composition_percent") == pytest.approx(55.70)


@pytest.mark.parametrize(
    "line,expected_val",
    [
        ("Portão - Ney Braga - ref Pix 492 310,00", 310.00),
        ("Materiais - Rodrigo Lazzarati - Boleto 37 956,46", 956.46),
        ("Boleto 6881 351,18", 351.18),
        ("Débito 867805 42,36", 42.36),
    ],
)
def test_payment_code_not_merged_with_trailing_amount(line: str, expected_val: float):
    """Código após meio de pagamento não vira milhar do valor (Dom Felipe / linhas Pix-Boleto)."""
    t = tokenize([pre_normalize_line_for_ocr(line)])[0]
    assert t["valor"] == pytest.approx(expected_val)


def test_ocr_merge_still_applies_after_rs():
    """Contexto R$: continua repondo dígitos partidos (pre_normalize + _normalize_ocr_broken_money)."""
    for line, expected in (
        ("R$ 4 4,00", 44.00),
        ("R$ 9 0,52", 90.52),
        ("R$ 6 4.681,71", 64681.71),
        ("R$ 1 0.828,12", 10828.12),
    ):
        t = tokenize([pre_normalize_line_for_ocr(line)])[0]
        assert t["valor"] == pytest.approx(expected), line


def test_playground_style_amount_still_merges_without_payment_hint():
    """Sem gatilho de pagamento: '2 300,00' continua virando milhar OCR."""
    line = "Playground área comum 2 300,00"
    t = tokenize([pre_normalize_line_for_ocr(line)])[0]
    assert t["valor"] == pytest.approx(2300.00)
