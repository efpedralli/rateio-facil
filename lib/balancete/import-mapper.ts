/**
 * Constrói o documento lógico de importação a partir do parse canônico (para resumo na API / UI).
 * O XLSX final é gerado por `scripts/balancete/export_xlsx.py` a partir do payload canônico.
 */

import type { BalanceteImportDocument, BalanceteImportRow } from "./import-types";
import type { BalanceteParseResult } from "./types";

function mapTipo(
  tipoLinha: string
): "ITEM" | "SUBTOTAL" | "TOTAL" {
  if (tipoLinha === "SUBTOTAL") return "SUBTOTAL";
  if (tipoLinha === "TOTAL_GERAL") return "TOTAL";
  return "ITEM";
}

/**
 * Transforma parse canônico em linhas do modelo de importação (sem índices de planilha).
 */
export function mapParsedBalanceteToImportDocument(parse: BalanceteParseResult): BalanceteImportDocument {
  const rows: BalanceteImportRow[] = [];
  let ordem = 1;

  rows.push({
    layer: "CABECALHO",
    secao: "Cabeçalho",
    descricao: parse.metadata.condominiumName ?? "",
    valor: null,
    tipo: "HEADER",
    ordem: ordem++,
  });
  rows.push({
    layer: "CABECALHO",
    secao: "Cabeçalho",
    descricao: parse.metadata.competenceLabel ?? "",
    valor: null,
    tipo: "HEADER",
    ordem: ordem++,
  });

  for (const e of parse.entries) {
    if (e.tipoLinha === "TITULO") continue;
    const layer = e.fase === "RESUMO_MES" ? "RESUMO_MES" : "LANCAMENTOS";
    rows.push({
      layer,
      secao: e.grupoOrigem,
      descricao: e.descricao,
      valor: e.valor,
      tipo: mapTipo(e.tipoLinha),
      ordem: ordem++,
    });
  }

  for (const r of parse.resumoContas) {
    rows.push({
      layer: "RESUMO_CONTAS",
      secao: r.conta,
      descricao: r.descricao,
      valor: r.valor,
      tipo: "ITEM",
      ordem: ordem++,
    });
  }

  return {
    rows,
    metadata: {
      condominiumName: parse.metadata.condominiumName,
      competenceLabel: parse.metadata.competenceLabel,
      sourceFileName: parse.metadata.fileName,
      parserLayoutId: parse.metadata.parserLayoutId,
    },
  };
}
