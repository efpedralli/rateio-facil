"""
Regressão: export Seens e classificação devem suportar Belle (tabular) e layouts simples
(Dom Felipe, Dourados) — grupos por nome, linhas sem data inicial, secaoMacro no JSON.
"""

from __future__ import annotations

import importlib.util
import sys
from pathlib import Path

import pytest

_SCRIPTS = Path(__file__).resolve().parents[1]


def _load_export_seens():
    path = _SCRIPTS / "export_excel_seens.py"
    spec = importlib.util.spec_from_file_location("export_excel_seens_mod", path)
    mod = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = mod
    spec.loader.exec_module(mod)
    return mod


def _load_line_classifier():
    path = _SCRIPTS / "line_classifier.py"
    spec = importlib.util.spec_from_file_location("line_classifier_mod", path)
    mod = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = mod
    spec.loader.exec_module(mod)
    return mod


@pytest.fixture(scope="module")
def seens():
    return _load_export_seens()


@pytest.fixture(scope="module")
def lc():
    return _load_line_classifier()


class TestNormalizeGroupTitle:
    def test_tabular_belle(self, seens):
        g = "Data Fornecedor (+) Receitas Mensais Valor"
        assert seens.normalize_group_title("RECEITAS", g) == "(+) RECEITAS MENSAIS"

    def test_simple_receitas(self, seens):
        assert seens.normalize_group_title("RECEITAS", "Receitas") == "(+) RECEITAS"

    def test_simple_receitas_extras(self, seens):
        assert seens.normalize_group_title("RECEITAS", "Receitas Extras") == (
            "(+) RECEITAS EXTRAS"
        )

    def test_simple_despesa_group(self, seens):
        t = seens.normalize_group_title("DESPESAS", "Conservação e Manutenção")
        assert t.startswith("(-)")
        assert "CONSERVAÇÃO" in t
        assert "MANUTENÇÃO" in t

    def test_revenue_name_overrides_section_hint(self, seens):
        """Nome começando com Receita → (+) mesmo se seção vier errada."""
        t = seens.normalize_group_title("DESPESAS", "Receitas Extras")
        assert t.startswith("(+)")


class TestOrderedGroupsSecaoMacro:
    def test_accepts_secao_macro_key(self, seens):
        entries = [
            {
                "secaoMacro": "RECEITAS",
                "grupoOrigem": "Receitas",
                "descricao": "Taxa de Condomínio 1.000,00 10,00",
                "valor": 1000.0,
                "tipoLinha": "ITEM",
            },
            {
                "secaoMacro": "DESPESAS",
                "grupoOrigem": "Conservação e Manutenção",
                "descricao": "Serviços de limpeza 500,00",
                "valor": 500.0,
                "tipoLinha": "ITEM",
            },
        ]
        order, groups = seens._ordered_groups(entries)
        assert ("RECEITAS", "Receitas") in order
        assert ("DESPESAS", "Conservação e Manutenção") in order
        assert len(groups[("RECEITAS", "Receitas")]) == 1


DOM_FELIPE_GROUPS = (
    "Receitas",
    "Conservação e Manutenção",
    "Despesas Administrativas",
    "Despesas por Consumo",
    "Despesas Não Rateadas",
    "Móveis e Utensílios",
    "Contratos Fixos",
    "Despesas Bancárias",
)

DOURADOS_GROUPS = (
    "Receitas",
    "Receitas Extras",
    "Despesa com Pessoal",
    "Conservação e Manutenção",
    "Despesas Administrativas",
    "Despesas com Obras e Benfeitorias",
    "Despesas por Consumo",
    "Despesas Não Rateadas",
    "Contratos Fixos",
    "Despesas Bancárias",
)


@pytest.mark.parametrize("name", DOM_FELIPE_GROUPS)
def test_dom_felipe_group_preserved_in_order(name: str, seens):
    sec = "RECEITAS" if name == "Receitas" else "DESPESAS"
    entries = [
        {
            "section": sec,
            "group": name,
            "descricao": "Item exemplo 123,45",
            "valor": 123.45,
            "tipo_linha": "ITEM",
        }
    ]
    order, _ = seens._ordered_groups(entries)
    assert (sec, name) in order


@pytest.mark.parametrize("name", DOURADOS_GROUPS)
def test_dourados_group_preserved_in_order(name: str, seens):
    sec = "RECEITAS" if name.startswith("Receita") else "DESPESAS"
    entries = [
        {
            "section": sec,
            "group": name,
            "descricao": "Item exemplo 99,99",
            "valor": 99.99,
            "tipo_linha": "ITEM",
        }
    ]
    order, _ = seens._ordered_groups(entries)
    assert (sec, name) in order


class TestTotalLineClassifier:
    def test_manutencao_not_total(self, lc):
        assert lc._TOTAL_LINE_HINT.match("conservação e manutenção") is None

    def test_total_colon_is_total(self, lc):
        assert lc._TOTAL_LINE_HINT.match("Total: 16.818,77") is not None

    def test_total_de_receitas(self, lc):
        assert lc._TOTAL_LINE_HINT.match("TOTAL DE RECEITAS: 16.818,77") is not None

    def test_total_grupo_no_meio_da_linha_belle(self, lc):
        s = "Receitas Financeiras - Total Grupo R$ 8.777,32"
        assert lc._TOTAL_LINE_INLINE.search(s) is not None


class TestSyntheticResumoDoesNotDropSimpleDescriptions:
    def test_descricao_sem_data_nao_e_sintetica(self, seens):
        assert seens._is_synthetic_resumo_line("Taxa de Condomínio 20.818,90 55,70") is False

    def test_total_de_receitas_e_sintetico(self, seens):
        assert seens._is_synthetic_resumo_line("TOTAL DE RECEITAS: 16.818,77") is True
