from __future__ import annotations

import importlib.util
import sys
from pathlib import Path

import pytest


_SCRIPTS = Path(__file__).resolve().parents[1]


def _load_mod(name: str, rel: str):
    path = _SCRIPTS / rel
    spec = importlib.util.spec_from_file_location(name, path)
    mod = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = mod
    spec.loader.exec_module(mod)
    return mod


@pytest.fixture(scope="module")
def norm():
    return _load_mod("normalizer_mod2", "normalizer.py")


@pytest.fixture(scope="module")
def lc():
    return _load_mod("line_classifier_mod2", "line_classifier.py")


def test_line_classifier_blocks_do_condominio_as_category(lc):
    tokens = [
        {"raw": "MERCADO XPTO 123,45", "clean": "mercado xpto 123,45", "valor": 123.45, "money_count": 1, "block": "DESPESAS", "is_upper": False},
        {"raw": "DO CONDOMINIO)", "clean": "DO CONDOMINIO)", "valor": None, "money_count": 0, "block": "DESPESAS", "is_upper": True},
    ]
    out = lc.classify_lines(tokens)
    assert out[1]["type"] == "CONTINUATION"


def test_money_only_line_becomes_total_not_item(lc):
    tokens = [
        {
            "raw": "R$2.370,14",
            "clean": "r$2.370,14",
            "valor": 2370.14,
            "money_count": 1,
            "block": "DESPESAS",
            "is_upper": False,
            "alpha_count": 0,
            "money_at_start": True,
            "money_at_end": True,
        }
    ]
    out = lc.classify_lines(tokens)
    assert out[0]["type"] == "TOTAL"


def test_leading_money_then_section_header_discards_value(lc):
    tokens = [
        {
            "raw": "2.370,14 Manuten��o e Conserva��o",
            "clean": "2.370,14 manuten��o e conserva��o",
            "valor": 2370.14,
            "money_count": 1,
            "block": "DESPESAS",
            "is_upper": False,
            "alpha_count": 20,
            "money_at_start": True,
            "money_at_end": False,
            "money_last_end": len("2.370,14"),
        }
    ]
    out = lc.classify_lines(tokens)
    assert out[0]["type"] == "CATEGORY"
    assert out[0]["valor"] is None


def test_normalizer_does_not_promote_do_condominio_to_group_and_appends(norm):
    tokens = [
        {"raw": "Item qualquer 100,00", "clean": "item qualquer 100,00", "valor": 100.0, "block": "DESPESAS", "type": "ITEM"},
        {"raw": "DO CONDOMINIO)", "clean": "do condominio)", "valor": None, "block": "DESPESAS", "type": "CATEGORY"},
        {"raw": "Outro item 50,00", "clean": "outro item 50,00", "valor": 50.0, "block": "DESPESAS", "type": "ITEM"},
    ]
    data = norm.normalize(tokens)
    # não deve existir categoria com "DO CONDOMINIO"
    cats = [e for e in data["entries"] if e.get("tipo") == "categoria"]
    assert not any("CONDOMINIO" in (c.get("descricao") or "").upper() for c in cats)
    # deve anexar ao item anterior
    assert "DO CONDOMINIO" in (data["entries"][0]["descricao"] or "").upper()


def test_known_group_outros_is_accepted(norm):
    tokens = [
        {"raw": "OUTROS", "clean": "outros", "valor": None, "block": "DESPESAS", "type": "CATEGORY"},
        {"raw": "Item 10,00", "clean": "item 10,00", "valor": 10.0, "block": "DESPESAS", "type": "ITEM"},
    ]
    data = norm.normalize(tokens)
    cats = [e for e in data["entries"] if e.get("tipo") == "categoria"]
    assert any((c.get("descricao") or "").strip().upper() == "OUTROS" for c in cats)

