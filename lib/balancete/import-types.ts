/**
 * Modelo da planilha FINAL de importação do balancete (não confundir com o canônico do parser).
 */

export type BalanceteImportRowType = "HEADER" | "ITEM" | "SUBTOTAL" | "TOTAL" | "BLANK";

/** Camada contábil no documento de importação. */
export type BalanceteImportLayer = "CABECALHO" | "LANCAMENTOS" | "RESUMO_MES" | "RESUMO_CONTAS";

export type BalanceteImportRow = {
  /** Camada lógica (lançamentos / resumo mês / resumo contas). */
  layer: BalanceteImportLayer;
  secao: string;
  descricao: string;
  valor: number | null;
  tipo: BalanceteImportRowType;
  /** Ordem estável no arquivo final (1-based). */
  ordem: number;
};

export type BalanceteImportDocument = {
  rows: BalanceteImportRow[];
  metadata: {
    condominiumName?: string | null;
    competenceLabel?: string | null;
    sourceFileName: string;
    parserLayoutId?: string | null;
  };
};

export type BalanceteValidationSummary = {
  groupSubtotalsOk: boolean;
  receitasTotalOk: boolean;
  despesasTotalOk: boolean;
  resultadoMesOk: boolean;
  resumoContasOk: boolean;
  totalDisponivelOk: boolean;
  unmatchedTemplateRows: number;
};
