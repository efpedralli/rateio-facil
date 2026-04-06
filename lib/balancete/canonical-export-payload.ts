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

function roundMoney(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

function signedItemValue(
  e: BalanceteParseResult["entries"][number]
): number {
  if (e.tipoLinha !== "ITEM") return 0;
  return e.valor * e.sinal;
}

/** Linhas de grupo / resumo que não são lançamento (Belle pág. 2, totais macro, etc.). */
function isSyntheticResumoLine(desc: string): boolean {
  const l = normalizeLabel(desc);
  if (!l) return true;
  if (l === "receitas" || l === "despesas") return true;
  if (l.startsWith("receitas r$")) return true;
  if (l.startsWith("despesas r$")) return true;
  if (l.includes("total (receitas - despesas)")) return true;
  if (l.includes("total dispon")) return true;
  if (l.includes("saldo atual") && l.includes("fundo")) return true;
  if (l.includes("saldo atual") && l.includes("conta corrente")) return true;
  if (l.includes("saldo atual") && l.includes("fluxo")) return true;
  if (/^despesas\s+ordin/i.test(l)) return true;
  if (/^despesas\s+.*\bagua\b/.test(l) && l.includes("esgoto"))
    return true;
  if (/^despesas\s+fundo\s+de\s+manuten/.test(l)) return true;
  if (l.includes("receitas do mes") && l.includes("total geral")) return true;
  if (l.includes("despesas do mes") && l.includes("total geral")) return true;
  if (l.includes("total grupo")) return true;
  if (l.includes("total geral")) return true;
  if (l.includes("subtotal")) return true;
  if (/\btotal\s+de\s+receitas\b/.test(l)) return true;
  if (/\btotal\s+de\s+despesas\b/.test(l)) return true;
  if (/^total\s*[:.]/.test(l)) return true;
  if (/^total\s+\(/.test(l)) return true;
  return false;
}

function shouldSkipExportGroup(grupoOrigem: string): boolean {
  const g = normalizeLabel(grupoOrigem || "");
  if (!g) return false;
  if (g === "resumo_mes" || g === "resumo mes") return true;
  if (g === "receitas x despesas") return true;
  if (g.startsWith("resgates - fundo de obra")) return true;
  if (g === "entradas valor") return true;
  if (/^(saydas|saidas|sai\s*das)\s+valor$/.test(g)) return true;
  return false;
}

function extractMonthTotalsFromLancamentos(
  parse: BalanceteParseResult
): {
  total_receitas?: number;
  total_despesas?: number;
  saldo_mes?: number;
} {
  const out: {
    total_receitas?: number;
    total_despesas?: number;
    saldo_mes?: number;
  } = {};
  const lan = entriesLancamentos(parse.entries);
  for (const e of lan) {
    const l = normalizeLabel(e.descricao || "");
    const v = Math.abs(e.valor);
    if (
      l.includes("receitas") &&
      l.includes("total") &&
      l.includes("geral") &&
      !l.includes("despes")
    ) {
      out.total_receitas = v;
    }
    if (
      l.includes("despesas") &&
      l.includes("total") &&
      l.includes("geral")
    ) {
      out.total_despesas = v;
    }
    if (/\btotal\s+de\s+receitas\b/.test(l) && !l.includes("despes")) {
      out.total_receitas = v;
    }
    if (/\btotal\s+de\s+despesas\b/.test(l)) {
      out.total_despesas = v;
    }
    if (
      l.includes("total") &&
      l.includes("receitas") &&
      l.includes("despesas") &&
      (l.includes("-") || l.includes("menos"))
    ) {
      out.saldo_mes = v;
    }
  }
  return out;
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

  const fromLanc = extractMonthTotalsFromLancamentos(parse);
  if (out.total_receitas === undefined && fromLanc.total_receitas !== undefined) {
    out.total_receitas = fromLanc.total_receitas;
  }
  if (out.total_despesas === undefined && fromLanc.total_despesas !== undefined) {
    out.total_despesas = fromLanc.total_despesas;
  }
  if (out.saldo_mes === undefined && fromLanc.saldo_mes !== undefined) {
    out.saldo_mes = fromLanc.saldo_mes;
  }

  const lan = entriesLancamentos(parse.entries);
  const sumRec = lan
    .filter(
      (e) =>
        e.secaoMacro === "RECEITAS" &&
        e.tipoLinha === "ITEM" &&
        !isSyntheticResumoLine(e.descricao || "")
    )
    .reduce((a, e) => a + signedItemValue(e), 0);
  const sumDesp = lan
    .filter(
      (e) =>
        e.secaoMacro === "DESPESAS" &&
        e.tipoLinha === "ITEM" &&
        !isSyntheticResumoLine(e.descricao || "")
    )
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
    out.saldo_mes = roundMoney(out.total_receitas - out.total_despesas);
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

type FundContaKey =
  | "FUNDO_DE_OBRA"
  | "FUNDO_RESERVA_POUPANCA"
  | "CONTA_CORRENTE_FLUXO";

const FUND_CONTA_NOME: Record<FundContaKey, string> = {
  FUNDO_DE_OBRA: "FUNDO DE OBRA",
  FUNDO_RESERVA_POUPANCA: "FUNDO DE RESERVA DE POUPANÇA PERMANENTE",
  CONTA_CORRENTE_FLUXO: "CONTA CORRENTE - FLUXO DE CAIXA DE MANUTENÇÃO",
};

function emptyExportAccount(nome: string): CanonicalExportAccount {
  return {
    nome,
    saldo_anterior: 0,
    creditos: 0,
    debitos: 0,
    transferencias_mais: 0,
    transferencias_menos: 0,
    saldo_final: 0,
  };
}

function fundKeyFromResumoContaDesc(desc: string): FundContaKey | null {
  const l = normalizeLabel(desc);
  if (l.includes("total dispon")) return null;
  if (
    l.includes("fundo de reserva") ||
    (l.includes("reserva") && l.includes("poup"))
  ) {
    return "FUNDO_RESERVA_POUPANCA";
  }
  if (l.includes("fundo de obra")) return "FUNDO_DE_OBRA";
  if (
    l.includes("conta corrente") ||
    l.includes("fluxo de caixa de manuten") ||
    l.includes("fluxo de caixa de manutencao") ||
    l.includes("receita de cotas") ||
    (l.includes("receita mensal") && l.includes("fluxo")) ||
    l.includes("aluguel salao") ||
    (l.includes("aluguel") && l.includes("salao"))
  ) {
    return "CONTA_CORRENTE_FLUXO";
  }
  return null;
}

function fundKeyFromSaldoAtualDesc(desc: string): FundContaKey | null {
  const l = normalizeLabel(desc);
  if (l.includes("fundo de obra") && !l.includes("reserva")) {
    return "FUNDO_DE_OBRA";
  }
  if (l.includes("reserva") && l.includes("poup")) {
    return "FUNDO_RESERVA_POUPANCA";
  }
  if (l.includes("conta corrente") || l.includes("fluxo de caixa")) {
    return "CONTA_CORRENTE_FLUXO";
  }
  return null;
}

function pivotResumoContasByFund(
  rows: BalanceteResumoConta[],
  summary: Record<string, number>,
  parse: BalanceteParseResult
): CanonicalExportAccount[] | null {
  const aggs = new Map<FundContaKey, CanonicalExportAccount>();
  for (const k of Object.keys(FUND_CONTA_NOME) as FundContaKey[]) {
    aggs.set(k, emptyExportAccount(FUND_CONTA_NOME[k]));
  }

  let resumoRowsClassified = 0;
  for (const r of rows) {
    const desc = r.descricao || "";
    const fk = fundKeyFromResumoContaDesc(desc);
    if (!fk) continue;
    resumoRowsClassified += 1;
    const a = aggs.get(fk)!;
    const l = normalizeLabel(desc);
    const v = Math.abs(r.valor);
    const mov = r.movimento;

    if (
      mov === "SALDO_ANTERIOR" ||
      (l.includes("acumulado") &&
        (l.includes("anterior") ||
          l.includes("competencia") ||
          l.includes("competência")))
    ) {
      a.saldo_anterior = v;
    } else if (mov === "SALDO_ATUAL" || l.includes("saldo atual")) {
      a.saldo_final = v;
    } else if (
      mov === "SAIDA" ||
      (fk === "FUNDO_RESERVA_POUPANCA" && l.includes("resgate"))
    ) {
      a.debitos += v;
    } else if (mov === "ENTRADA" || mov === "TOTAL_DISPONIVEL") {
      a.creditos += v;
    }
  }

  if (resumoRowsClassified === 0) {
    return null;
  }

  for (const e of parse.entries) {
    if (e.fase !== "RESUMO_MES") continue;
    const l = normalizeLabel(e.descricao || "");
    if (!l.includes("saldo atual")) continue;
    const fk = fundKeyFromSaldoAtualDesc(e.descricao || "");
    if (!fk) continue;
    aggs.get(fk)!.saldo_final = Math.abs(e.valor);
  }

  const tr = summary.total_receitas;
  const td = summary.total_despesas;
  const obra = aggs.get("FUNDO_DE_OBRA")!;
  const res = aggs.get("FUNDO_RESERVA_POUPANCA")!;
  const flux = aggs.get("CONTA_CORRENTE_FLUXO")!;
  const looksLikeMultiFundContaResumo =
    rows.length > 0 &&
    (obra.saldo_anterior > 0.01 ||
      res.saldo_anterior > 0.01 ||
      (obra.creditos > 0.01 && res.creditos > 0.01));
  if (tr !== undefined && td !== undefined && looksLikeMultiFundContaResumo) {
    flux.creditos = roundMoney(tr - obra.creditos - res.creditos);
    flux.debitos = roundMoney(td);
  }

  const order: FundContaKey[] = [
    "FUNDO_DE_OBRA",
    "FUNDO_RESERVA_POUPANCA",
    "CONTA_CORRENTE_FLUXO",
  ];
  return order.map((k) => aggs.get(k)!);
}

function buildExportAccounts(
  parse: BalanceteParseResult,
  summary: Record<string, number>
): CanonicalExportAccount[] {
  if (parse.resumoContas.length > 0) {
    const pivoted = pivotResumoContasByFund(
      parse.resumoContas,
      summary,
      parse
    );
    if (pivoted !== null) {
      return pivoted;
    }
  }
  return tryAccountsFromCanonical(parse.canonical);
}

function buildExportEntries(parse: BalanceteParseResult): CanonicalExportEntry[] {
  const out: CanonicalExportEntry[] = [];
  let ordem = 1;
  for (const e of entriesLancamentos(parse.entries)) {
    if (e.tipoLinha !== "ITEM") continue;
    if (e.secaoMacro !== "RECEITAS" && e.secaoMacro !== "DESPESAS") continue;
    if (shouldSkipExportGroup(e.grupoOrigem || "")) continue;
    if (isSyntheticResumoLine(e.descricao || "")) continue;
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
  const summary = summaryFromResumoAndEntries(
    parse.canonical.resumo,
    parse
  );
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
    summary,
    accounts: buildExportAccounts(parse, summary),
  };
}
