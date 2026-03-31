/**
 * Validações contábeis sobre o modelo canônico.
 * Lançamentos do mês (fase LANCAMENTOS ou sem fase) são separados de RESUMO_MES e de resumoContas.
 */

import type { BalanceteValidationSummary } from "./import-types";
import type {
  BalanceteEntry,
  BalanceteParseResult,
  BalanceteResumoConta,
  BalanceteValidationIssue,
  BalanceteValidationResult,
} from "./types";

const TOLERANCE = 0.02;

function nearlyEqual(a: number, b: number): boolean {
  return Math.abs(a - b) <= TOLERANCE;
}

function sumBy<T>(items: T[], pick: (t: T) => number): number {
  return items.reduce((acc, t) => acc + pick(t), 0);
}

/** Apenas itens de movimentação do mês (não resumo do mês nem resumo de contas). */
export function entriesLancamentos(entries: BalanceteEntry[]): BalanceteEntry[] {
  return entries.filter((e) => (e.fase ?? "LANCAMENTOS") === "LANCAMENTOS");
}

function signedItemValue(e: BalanceteEntry): number {
  if (e.tipoLinha !== "ITEM") return 0;
  return e.valor * e.sinal;
}

export function validateGroupSubtotals(entries: BalanceteEntry[]): BalanceteValidationIssue[] {
  const issues: BalanceteValidationIssue[] = [];
  const lan = entriesLancamentos(entries);
  const byKey = new Map<string, BalanceteEntry[]>();
  for (const e of lan) {
    if (e.secaoMacro === "RESUMO_CONTAS") continue;
    const key = `${e.secaoMacro}||${e.grupoOrigem}`;
    const list = byKey.get(key) ?? [];
    list.push(e);
    byKey.set(key, list);
  }

  for (const [, list] of byKey) {
    const sub = list.filter((x) => x.tipoLinha === "SUBTOTAL");
    if (!sub.length) continue;
    const itemSum = sumBy(list, (e) => signedItemValue(e));
    for (const s of sub) {
      const expected = s.valor * s.sinal;
      if (!nearlyEqual(itemSum, expected)) {
        issues.push({
          type: "WARNING",
          code: "GROUP_SUBTOTAL_MISMATCH",
          message: `Soma dos itens do grupo "${s.grupoOrigem}" (${itemSum.toFixed(2)}) difere do subtotal (${expected.toFixed(2)}).`,
          details: { grupoOrigem: s.grupoOrigem, secaoMacro: s.secaoMacro },
        });
      }
    }
  }
  return issues;
}

export function validateMacroTotals(entries: BalanceteEntry[]): BalanceteValidationIssue[] {
  const issues: BalanceteValidationIssue[] = [];
  const lan = entriesLancamentos(entries);

  for (const macro of ["RECEITAS", "DESPESAS"] as const) {
    const slice = lan.filter((e) => e.secaoMacro === macro);
    const totals = slice.filter((e) => e.tipoLinha === "TOTAL_GERAL");
    const itemSum = sumBy(slice, (e) => signedItemValue(e));
    for (const t of totals) {
      const expected = t.valor * t.sinal;
      if (!nearlyEqual(itemSum, expected)) {
        issues.push({
          type: "WARNING",
          code:
            macro === "RECEITAS"
              ? "MACRO_TOTAL_RECEITAS_MISMATCH"
              : "MACRO_TOTAL_DESPESAS_MISMATCH",
          message: `Total geral de ${macro} (${expected.toFixed(2)}) difere da soma dos itens (${itemSum.toFixed(2)}).`,
          details: { secaoMacro: macro },
        });
      }
    }
  }
  return issues;
}

/**
 * Resumo do mês no PDF: Receitas, Despesas, Total (R - D).
 */
export function validateResumoMes(entries: BalanceteEntry[]): BalanceteValidationIssue[] {
  const issues: BalanceteValidationIssue[] = [];
  const rm = entries.filter((e) => e.fase === "RESUMO_MES" && e.tipoLinha === "ITEM");
  if (rm.length < 2) return issues;

  let receitas: number | null = null;
  let despesas: number | null = null;
  let resultado: number | null = null;

  for (const e of rm) {
    const d = e.descricao.toUpperCase();
    if (d.includes("TOTAL") && d.includes("RECEITAS") && d.includes("DESPESAS")) {
      resultado = e.valor;
      continue;
    }
    if (d.startsWith("DESPESAS")) {
      despesas = e.valor;
    } else if (d.startsWith("RECEITAS") && !d.includes(" X ")) {
      receitas = e.valor;
    }
  }

  if (resultado != null && receitas != null && despesas != null) {
    if (!nearlyEqual(receitas - despesas, resultado)) {
      issues.push({
        type: "WARNING",
        code: "RESUMO_MES_RESULTADO",
        message: `Resumo do mês: receitas (${receitas.toFixed(2)}) menos despesas (${despesas.toFixed(2)}) difere do total informado (${resultado.toFixed(2)}).`,
        details: { receitas, despesas, resultado },
      });
    }
  }
  return issues;
}

export function validateResumoContas(resumo: BalanceteResumoConta[]): BalanceteValidationIssue[] {
  const issues: BalanceteValidationIssue[] = [];
  const byConta = new Map<string, BalanceteResumoConta[]>();

  for (const r of resumo) {
    const key = r.conta.trim() || "_sem_conta";
    const list = byConta.get(key) ?? [];
    list.push(r);
    byConta.set(key, list);
  }

  for (const [conta, list] of byConta) {
    const get = (m: BalanceteResumoConta["movimento"]) =>
      list.filter((x) => x.movimento === m).reduce((a, x) => a + x.valor, 0);

    const saldoAnt = get("SALDO_ANTERIOR");
    const ent = get("ENTRADA");
    const sai = get("SAIDA");
    const saldoAtu = get("SALDO_ATUAL");

    const hasMovements = list.some((x) =>
      ["SALDO_ANTERIOR", "ENTRADA", "SAIDA", "SALDO_ATUAL"].includes(x.movimento)
    );
    if (!hasMovements) continue;

    const expected = saldoAnt + ent - sai;
    const anyValue =
      Math.abs(saldoAnt) + Math.abs(ent) + Math.abs(sai) + Math.abs(saldoAtu) > TOLERANCE;
    if (anyValue && !nearlyEqual(expected, saldoAtu)) {
      issues.push({
        type: "WARNING",
        code: "RESUMO_CONTA_EQUATION",
        message: `Resumo da conta "${conta}": saldo anterior + entradas - saídas (${expected.toFixed(2)}) difere do saldo atual (${saldoAtu.toFixed(2)}).`,
        details: { conta, saldoAnt, ent, sai, saldoAtu, expected },
      });
    }
  }

  return issues;
}

/**
 * Quando há exatamente um "total disponível" no PDF, confere com a soma dos saldos atuais das contas.
 */
export function validateTotalDisponivel(resumo: BalanceteResumoConta[]): BalanceteValidationIssue[] {
  const td = resumo.filter((r) => r.movimento === "TOTAL_DISPONIVEL");
  if (td.length !== 1) return [];

  const totalDisponivel = td[0].valor;
  const saldoSum = sumBy(
    resumo.filter((r) => r.movimento === "SALDO_ATUAL"),
    (r) => r.valor
  );

  if (Math.abs(saldoSum) < TOLERANCE && Math.abs(totalDisponivel) < TOLERANCE) {
    return [];
  }
  if (!nearlyEqual(saldoSum, totalDisponivel)) {
    return [
      {
        type: "WARNING",
        code: "TOTAL_DISPONIVEL_MISMATCH",
        message: `Soma dos saldos atuais (${saldoSum.toFixed(2)}) difere do total disponível informado (${totalDisponivel.toFixed(2)}).`,
        details: { saldoSum, totalDisponivel },
      },
    ];
  }
  return [];
}

export function validateBalancete(parse: BalanceteParseResult): BalanceteValidationResult {
  const extra: BalanceteValidationIssue[] = [
    ...validateGroupSubtotals(parse.entries),
    ...validateMacroTotals(parse.entries),
    ...validateResumoMes(parse.entries),
    ...validateResumoContas(parse.resumoContas),
    ...validateTotalDisponivel(parse.resumoContas),
  ];

  const lancItems = entriesLancamentos(parse.entries).filter((e) => e.tipoLinha === "ITEM");
  const hasData = lancItems.length > 0 || parse.resumoContas.length > 0;

  if (!hasData) {
    extra.push({
      type: "ERROR",
      code: "NO_DATA_EXTRACTED",
      message:
        "Nenhum lançamento do mês nem linha de resumo de contas foi extraído. Verifique o PDF ou o layout.",
    });
  }

  const merged = [...parse.issues, ...extra];
  const errorCount = merged.filter((i) => i.type === "ERROR").length;
  const blocking = merged.some((i) => i.type === "ERROR" && i.code === "NO_DATA_EXTRACTED");

  return {
    issues: merged,
    blocking,
  };
}

export function buildBalanceteValidationSummary(
  issues: BalanceteValidationIssue[],
  exportStats?: { unusedTemplateSlots: number }
): BalanceteValidationSummary {
  const codes = new Set(issues.map((i) => i.code));
  return {
    groupSubtotalsOk: !codes.has("GROUP_SUBTOTAL_MISMATCH"),
    receitasTotalOk: !codes.has("MACRO_TOTAL_RECEITAS_MISMATCH"),
    despesasTotalOk: !codes.has("MACRO_TOTAL_DESPESAS_MISMATCH"),
    resultadoMesOk: !codes.has("RESUMO_MES_RESULTADO"),
    resumoContasOk: !codes.has("RESUMO_CONTA_EQUATION"),
    totalDisponivelOk: !codes.has("TOTAL_DISPONIVEL_MISMATCH"),
    unmatchedTemplateRows: exportStats?.unusedTemplateSlots ?? 0,
  };
}
