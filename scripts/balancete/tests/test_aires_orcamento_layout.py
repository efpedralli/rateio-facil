from __future__ import annotations

from parse_balancete import parse_pdf


def test_aires_de_campos_parses_initial_groups_and_items():
    # Regressão: o layout de "Previsão/Composição de Orçamento" deve produzir grupos
    # desde as primeiras linhas ("Água e Esgoto", "Energia Elétrica", etc.).
    d = parse_pdf(r"..\..\models\aires_de_campos.pdf")
    data = d["data"]
    entries = data.get("entries") or []
    assert entries, "esperava entries no Aires"

    cats = [e.get("descricao") for e in entries if e.get("tipo") == "categoria"]
    assert any("Taxas Mensais" in (c or "") for c in cats)
    assert any("Manuten" in (c or "") for c in cats)
    assert any("Despesas Administrativas" in (c or "") for c in cats)

    # Deve conter itens antes de "Manutenção e Conservação" (ex.: Água/Energia)
    items = [e for e in entries if e.get("tipo") == "item"]
    assert any("Água" in (e.get("descricao") or "") or "Agua" in (e.get("descricao") or "") for e in items)
    assert any("Energia" in (e.get("descricao") or "") for e in items)

    # Total final de previsão não pode virar ITEM (senão dobra valor)
    assert not any(
        "Total da Previs" in (e.get("descricao") or "")
        and e.get("tipo") == "item"
        for e in entries
    )

