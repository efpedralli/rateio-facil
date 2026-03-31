/**
 * Modelo canônico intermediário entre PDF (parser) e XLSX (importação).
 * Novos layouts de balancete devem convergir para estes tipos antes do mapeamento.
 */

import type { BalanceteValidationSummary } from "./import-types";
import type { CanonicalBalanceteDocument } from "./canonical-types";

export type BalanceteSecaoMacro = "RECEITAS" | "DESPESAS" | "RESUMO_CONTAS";

/** Fase do extrato (parser Belle); ausente em layouts genéricos (= lançamentos). */
export type BalanceteEntryFase = "LANCAMENTOS" | "RESUMO_MES";

export type BalanceteTipoLinha =
  | "ITEM"
  | "SUBTOTAL"
  | "TOTAL_GERAL"
  | "TITULO";

export type BalanceteEntry = {
  secaoMacro: BalanceteSecaoMacro;
  fase?: BalanceteEntryFase;
  /** Subseção detectada (ex.: grupo de despesas, título antes dos itens). */
  grupoOrigem: string;
  data?: string | null;
  fornecedor?: string | null;
  descricao: string;
  valor: number;
  /** Convenção: receitas +1, despesas normalmente -1 para totais coerentes no Excel. */
  sinal: 1 | -1;
  tipoLinha: BalanceteTipoLinha;
  linhaOriginal?: string | null;
};

export type BalanceteMovimentoConta =
  | "SALDO_ANTERIOR"
  | "ENTRADA"
  | "SAIDA"
  | "SALDO_ATUAL"
  | "TOTAL_DISPONIVEL";

export type BalanceteResumoConta = {
  conta: string;
  movimento: BalanceteMovimentoConta;
  descricao: string;
  valor: number;
  linhaOriginal?: string | null;
};

export type BalanceteValidationSeverity = "WARNING" | "ERROR";

export type BalanceteValidationIssue = {
  type: BalanceteValidationSeverity;
  code: string;
  message: string;
  details?: Record<string, unknown>;
};

export type BalanceteParseMetadata = {
  fileName: string;
  competenceLabel?: string | null;
  competenceStart?: string | null;
  competenceEnd?: string | null;
  condominiumName?: string | null;
  /** Nome do layout/heurística usada no parser (extensível). */
  parserLayoutId?: string | null;
  /** Blocos lógicos detectados no PDF (parser semântico). */
  blocksDetected?: string[];
};

/**
 * Resultado bruto do parser (Python ou futuro parser TS).
 */
export type BalanceteParseResult = {
  entries: BalanceteEntry[];
  resumoContas: BalanceteResumoConta[];
  issues: BalanceteValidationIssue[];
  metadata: BalanceteParseMetadata;
  /** Schema 2+: documento contábil semântico (independente do layout do PDF). */
  schemaVersion: number;
  canonical: CanonicalBalanceteDocument;
};

export type BalanceteValidationResult = {
  issues: BalanceteValidationIssue[];
  /** true se houver ERROR que impede uso confiável do arquivo. */
  blocking: boolean;
};

/** Linha já mapeada para o modelo de importação (planilha). */
export type BalanceteTemplateRow = {
  data: string | null;
  descricao: string;
  valor: number;
  /** RECEITA/DESPESA para lançamentos; RESUMO_CONTA para linhas do resumo de contas. */
  categoriaImportacao: "RECEITA" | "DESPESA" | "RESUMO_CONTA";
  grupoOrigem: string;
  contaResumo: string | null;
  linhaAuditoria: string | null;
};

export type BalanceteJobSummary = {
  entryCount: number;
  itemCount: number;
  lancamentosItemCount: number;
  resumoMesLineCount: number;
  groupCount: number;
  resumoContaCount: number;
  issueCount: number;
  errorCount: number;
  warningCount: number;
  validationsOk: boolean;
  competenceLabel?: string | null;
  condominiumName?: string | null;
  parserLayoutId?: string | null;
  blocksDetected?: string[];
  receitasGroupCount?: number;
  despesasGroupCount?: number;
  contaTablesCount?: number;
  /** Preenchimento do modelo XLS (legado Belle) ou export semântico. */
  importFill?: {
    filledCells?: number;
    unmatchedPoolLines?: number;
    unusedTemplateSlots?: number;
    dataRowsWritten?: number;
    sectionCount?: number;
  };
  /** Resumo booleano das checagens contábeis (persistido em `BalanceteJob.summary`). */
  validationSummary?: BalanceteValidationSummary;
};
