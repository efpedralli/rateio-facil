from __future__ import annotations

import importlib.util
import sys
from pathlib import Path

import pytest


_SCRIPTS = Path(__file__).resolve().parents[1]


def _load_text_repair():
    path = _SCRIPTS / "text_repair.py"
    spec = importlib.util.spec_from_file_location("text_repair_mod", path)
    mod = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = mod
    spec.loader.exec_module(mod)
    return mod


@pytest.fixture(scope="module")
def tr():
    return _load_text_repair()


def test_preserva_acentos(tr):
    s = "MANUTENÇÃO E CONSERVAÇÃO"
    out = tr.normalize_extracted_text(s)
    assert out == s
    assert "\ufffd" not in out


def test_repara_mojibake_duplo(tr):
    s = "MANUTENÃ‡ÃƒO E CONSERVAÃ‡ÃƒO"
    out = tr.normalize_extracted_text(s)
    assert "MANUTENÇÃO" in out
    assert "CONSERVAÇÃO" in out
    assert "\ufffd" not in out


def test_tenta_reparo_antes_de_seguir_quando_tem_replacement(tr):
    # Quando já existe '�', não há garantia de recuperação completa,
    # mas deve normalizar e registrar warning sem substituir silenciosamente.
    s = "MANUTEN\ufffd\ufffdO E CONSERVA\ufffd\ufffdO"
    out = tr.normalize_extracted_text(s)
    assert "\ufffd" in out


@pytest.mark.parametrize(
    "s",
    [
        "Serviços Públicos",
        "Abastecimento de Gás",
    ],
)
def test_acentos_comuns(tr, s: str):
    out = tr.normalize_extracted_text(s)
    assert out == s
    assert "\ufffd" not in out

