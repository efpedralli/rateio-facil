/**
 * Modelo canônico semântico do balancete (independente do PDF de origem).
 * Espelha o JSON `canonical` produzido pelo parser Python.
 */

export type ParsedLancamento = {
  descricao: string;
  fornecedor?: string | null;
  mesRef?: string | null;
  baixa?: string | null;
  tipoPgto?: string | null;
  notaFiscal?: string | null;
  valor: number;
  rawLine?: string | null;
};

export type ParsedLancamentoGroup = {
  groupName: string;
  entries: ParsedLancamento[];
  subtotal: number | null;
};

export type ParsedResumoItem = {
  label: string;
  valor: number;
};

export type ParsedContaResumoRow = {
  label: string;
  conta?: string;
  movimento?: string;
  saldoAnterior?: number | null;
  creditos?: number | null;
  debitos?: number | null;
  transfMais?: number | null;
  transfMenos?: number | null;
  saldoFinal?: number | null;
  valor?: number | null;
};

export type ParsedContaResumoTable = {
  tableName: string;
  columns: string[];
  rows: ParsedContaResumoRow[];
  totalRow?: ParsedContaResumoRow | null;
};

export type ParsedTotalGeral = {
  label: string;
  valor: number;
};

export type CanonicalBalanceteDocument = {
  receitas: ParsedLancamentoGroup[];
  despesas: ParsedLancamentoGroup[];
  resumo: ParsedResumoItem[];
  contasCorrentes: ParsedContaResumoTable | null;
  contasPoupancaAplicacao: ParsedContaResumoTable | null;
  totalGeral: ParsedTotalGeral | null;
};
