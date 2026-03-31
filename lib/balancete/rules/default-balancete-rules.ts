/**
 * Regras configuráveis: mapeamento de grupos/descrições para o template de importação.
 * Para um novo condomínio ou software de balancete, duplique e ajuste este arquivo
 * ou carregue JSON equivalente no futuro.
 */

import type { BalanceteTemplateRow } from "../types";

export type BalanceteImportSection = "RECEITA" | "DESPESA";

export type BalanceteGroupMappingRule = {
  /** Padrão case-insensitive contra grupoOrigem normalizado. */
  match: RegExp;
  targetSection: BalanceteImportSection;
  /** Prioridade maior vence em conflitos. */
  priority: number;
};

export type BalanceteDescriptionAlias = {
  /** Texto normalizado (sem acento, lower) ou substring. */
  whenIncludes: string;
  replaceWith: string;
};

export const defaultGroupMappingRules: BalanceteGroupMappingRule[] = [
  { match: /receita/i, targetSection: "RECEITA", priority: 10 },
  { match: /despesa|despesas|pagamento|fornecedor/i, targetSection: "DESPESA", priority: 10 },
  { match: /manutenc|limpeza|segur|energia|agua|luz/i, targetSection: "DESPESA", priority: 5 },
];

export const defaultDescriptionAliases: BalanceteDescriptionAlias[] = [
  { whenIncludes: "condominio", replaceWith: "Taxa de condomínio" },
  { whenIncludes: "agua e esgoto", replaceWith: "Água e esgoto" },
  { whenIncludes: "fundo de reserva", replaceWith: "Fundo de reserva" },
];

export type BalanceteTemplateColumnSpec = {
  sheetName: string;
  headerRow: number;
  firstDataRow: number;
  columns: {
    data: string;
    descricao: string;
    valor: string;
    categoria: string;
    grupo: string;
    conta: string;
    auditoria: string;
  };
};

/** Layout padrão da aba gerada pelo sistema (1ª linha = cabeçalhos). */
export const defaultTemplateColumnSpec: BalanceteTemplateColumnSpec = {
  sheetName: "Importacao_Balancete",
  headerRow: 1,
  firstDataRow: 2,
  columns: {
    data: "A",
    descricao: "B",
    valor: "C",
    categoria: "D",
    grupo: "E",
    conta: "F",
    auditoria: "G",
  },
};

export function resolveSectionForGroup(
  grupoOrigem: string,
  fallbackFromMacro: "RECEITAS" | "DESPESAS"
): BalanceteImportSection {
  const g = grupoOrigem.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  const sorted = [...defaultGroupMappingRules].sort((a, b) => b.priority - a.priority);
  for (const rule of sorted) {
    if (rule.match.test(grupoOrigem) || rule.match.test(g)) {
      return rule.targetSection;
    }
  }
  return fallbackFromMacro === "RECEITAS" ? "RECEITA" : "DESPESA";
}

export function applyDescriptionAliases(descricao: string): string {
  const n = descricao
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
  for (const alias of defaultDescriptionAliases) {
    const key = alias.whenIncludes
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "");
    if (n.includes(key)) {
      return alias.replaceWith;
    }
  }
  return descricao;
}

export function buildTemplateRowFromEntry(
  entry: import("../types").BalanceteEntry
): BalanceteTemplateRow | null {
  if (entry.tipoLinha !== "ITEM") return null;
  if (entry.secaoMacro === "RESUMO_CONTAS") return null;

  const categoriaImportacao = resolveSectionForGroup(
    entry.grupoOrigem,
    entry.secaoMacro === "RECEITAS" ? "RECEITAS" : "DESPESAS"
  );

  const valorEfetivo = entry.valor * entry.sinal;
  const descricao = applyDescriptionAliases(entry.descricao.trim());

  return {
    data: entry.data ?? null,
    descricao,
    valor: valorEfetivo,
    categoriaImportacao,
    grupoOrigem: entry.grupoOrigem,
    contaResumo: null,
    linhaAuditoria: entry.linhaOriginal ?? null,
  };
}
