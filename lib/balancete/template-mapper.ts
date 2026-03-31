/**
 * Converte o modelo canônico em linhas da planilha de importação,
 * aplicando regras de `rules/default-balancete-rules.ts`.
 */

import type { BalanceteParseResult, BalanceteTemplateRow } from "./types";
import { buildTemplateRowFromEntry } from "./rules/default-balancete-rules";

function resumoToTemplateRow(r: import("./types").BalanceteResumoConta): BalanceteTemplateRow {
  return {
    data: null,
    descricao: `${r.movimento}: ${r.descricao}`.trim(),
    valor: r.valor,
    categoriaImportacao: "RESUMO_CONTA",
    grupoOrigem: r.movimento,
    contaResumo: r.conta || null,
    linhaAuditoria: r.linhaOriginal ?? null,
  };
}

/**
 * Ordena: receitas, depois despesas, depois resumo de contas; dentro de cada bloco mantém ordem do PDF.
 */
export function mapParseResultToTemplateRows(parse: BalanceteParseResult): BalanceteTemplateRow[] {
  const rows: BalanceteTemplateRow[] = [];

  const entries = parse.entries.filter((e) => e.secaoMacro !== "RESUMO_CONTAS");
  for (const e of entries) {
    const row = buildTemplateRowFromEntry(e);
    if (row) rows.push(row);
  }

  for (const r of parse.resumoContas) {
    rows.push(resumoToTemplateRow(r));
  }

  return rows;
}
