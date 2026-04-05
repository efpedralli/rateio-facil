/**
 * Monta o JSON consumido por `scripts/balancete/export_xlsx.py` (formato estável para importação).
 */

import type { CanonicalBalanceteDocument, ParsedResumoItem } from "./canonical-types";
import type {
  BalanceteParseResult,
  BalanceteResumoConta,
} from "./types";
import { entriesLancamentos } from "./validators";

export type CanonicalExportEntry = {
  section: string;
  group: string;
  descricao: string;
  valor: number;
  ordem: number;
};

export type CanonicalExportAccount = {
  nome: string;
  saldo_anterior: number;
  creditos: number;
  debitos: number;
  transferencias_mais: number;
  transferencias_menos: number;
  saldo_final: number;
};

export type CanonicalBalanceteExportPayload = {
  metadata: {
    condominio: string;
    competencia: string;
    periodo_inicio: string;
    periodo_fim: string;
    parser_type: string;
    source_file: string;
  };
  entries: CanonicalExportEntry[];
  summary: Record<string, number>;
  accounts: CanonicalExportAccount[];
};

function normalizeLabel(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function signedItemValue(
  e: BalanceteParseResult["entries"][number]
): number {
  if (e.tipoLinha !== "ITEM") return 0;
  return e.valor * e.sinal;
}

function summaryFromResumoAndEntries(
  resumo: ParsedResumoItem[],
  parse: BalanceteParseResult
): Record<string, number> {
  const out: Record<string, number> = {};
  const L = (label: string) => normalizeLabel(label);

  for (const it of resumo) {
    const l = L(it.label);
    if (l.includes("total") && l.includes("receit")) {
      out.total_receitas = it.valor;
    } else if (l.includes("total") && l.includes("despes")) {
      out.total_despesas = it.valor;
    } else if (l.includes("saldo") && l.includes("anterior")) {
      out.saldo_anterior = it.valor;
    } else if (
      l.includes("resultado") ||
      (l.includes("saldo") && l.includes("mes")) ||
      l.includes("resultado do mes")
    ) {
      out.saldo_mes = it.valor;
    } else if (
      l.includes("saldo") &&
      (l.includes("atual") || l.includes("final"))
    ) {
      out.saldo_atual = it.valor;
    }
  }

  const lan = entriesLancamentos(parse.entries);
  const sumRec = lan
    .filter((e) => e.secaoMacro === "RECEITAS" && e.tipoLinha === "ITEM")
    .reduce((a, e) => a + signedItemValue(e), 0);
  const sumDesp = lan
    .filter((e) => e.secaoMacro === "DESPESAS" && e.tipoLinha === "ITEM")
    .reduce((a, e) => a + Math.abs(signedItemValue(e)), 0);

  if (out.total_receitas === undefined && sumRec > 0) {
    out.total_receitas = sumRec;
  }
  if (out.total_despesas === undefined && sumDesp > 0) {
    out.total_despesas = sumDesp;
  }
  if (
    out.saldo_mes === undefined &&
    out.total_receitas !== undefined &&
    out.total_despesas !== undefined
  ) {
    out.saldo_mes = out.total_receitas - out.total_despesas;
  }

  return out;
}

function tryAccountsFromCanonical(
  canonical: CanonicalBalanceteDocument
): CanonicalExportAccount[] {
  const acc: CanonicalExportAccount[] = [];
  for (const table of [
    canonical.contasCorrentes,
    canonical.contasPoupancaAplicacao,
  ]) {
    if (!table?.rows?.length) continue;
    for (const row of table.rows) {
      const hasStructured =
        row.saldoAnterior != null ||
        row.creditos != null ||
        row.debitos != null ||
        row.saldoFinal != null;
      if (!hasStructured) continue;
      acc.push({
        nome: (row.conta || row.label || "Conta").trim() || "Conta",
        saldo_anterior: row.saldoAnterior ?? 0,
        creditos: row.creditos ?? 0,
        debitos: row.debitos ?? 0,
        transferencias_mais: row.transfMais ?? 0,
        transferencias_menos: row.transfMenos ?? 0,
        saldo_final: row.saldoFinal ?? row.valor ?? 0,
      });
    }
  }
  return acc;
}

function pivotResumoContas(
  rows: BalanceteResumoConta[]
): CanonicalExportAccount[] {
  type Agg = {
    nome: string;
    saldo_anterior: number;
    creditos: number;
    debitos: number;
    transferencias_mais: number;
    transferencias_menos: number;
    saldo_final: number;
  };
  const m = new Map<string, Agg>();

  for (const r of rows) {
    const nome = (r.conta || "").trim() || (r.descricao || "").trim() || "Conta";
    let a = m.get(nome);
    if (!a) {
      a = {
        nome,
        saldo_anterior: 0,
        creditos: 0,
        debitos: 0,
        transferencias_mais: 0,
        transferencias_menos: 0,
        saldo_final: 0,
      };
      m.set(nome, a);
    }
    const v = Math.abs(r.valor);
    switch (r.movimento) {
      case "SALDO_ANTERIOR":
        a.saldo_anterior = v;
        break;
      case "ENTRADA":
        a.creditos += v;
        break;
      case "SAIDA":
        a.debitos += v;
        break;
      case "SALDO_ATUAL":
        a.saldo_final = v;
        break;
      case "TOTAL_DISPONIVEL":
        a.saldo_final = v;
        break;
      default:
        break;
    }
  }

  return Array.from(m.values());
}

function buildExportAccounts(
  parse: BalanceteParseResult
): CanonicalExportAccount[] {
  if (parse.resumoContas.length > 0) {
    return pivotResumoContas(parse.resumoContas);
  }
  const fromCanon = tryAccountsFromCanonical(parse.canonical);
  return fromCanon;
}

function buildExportEntries(parse: BalanceteParseResult): CanonicalExportEntry[] {
  const out: CanonicalExportEntry[] = [];
  let ordem = 1;
  for (const e of parse.entries) {
    if (e.tipoLinha === "TITULO") continue;
    if (e.secaoMacro !== "RECEITAS" && e.secaoMacro !== "DESPESAS") continue;
    out.push({
      section: e.secaoMacro,
      group: e.grupoOrigem || "GERAL",
      descricao: e.descricao,
      valor: e.valor,
      ordem: ordem++,
    });
  }
  return out;
}

export function buildCanonicalExportPayload(
  parse: BalanceteParseResult
): CanonicalBalanceteExportPayload {
  const md = parse.metadata;
  return {
    metadata: {
      condominio: md.condominiumName ?? "",
      competencia: md.competenceLabel ?? "",
      periodo_inicio: md.competenceStart ?? "",
      periodo_fim: md.competenceEnd ?? "",
      parser_type: md.parserLayoutId ?? "",
      source_file: md.fileName ?? "",
    },
    entries: buildExportEntries(parse),
    summary: summaryFromResumoAndEntries(parse.canonical.resumo, parse),
    accounts: buildExportAccounts(parse),
  };
}
