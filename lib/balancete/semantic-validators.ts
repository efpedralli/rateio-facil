/**
 * Validações contábeis sobre o documento canônico semântico (além das validações em entries legadas).
 */

import type { CanonicalBalanceteDocument } from "./canonical-types";
import type { BalanceteValidationIssue } from "./types";

const TOLERANCE = 0.05;

function nearlyEqual(a: number, b: number): boolean {
  return Math.abs(a - b) <= TOLERANCE;
}

export function validateCanonicalBalancete(canonical: CanonicalBalanceteDocument): BalanceteValidationIssue[] {
  const issues: BalanceteValidationIssue[] = [];

  for (const macro of canonical.receitas) {
    const sum = macro.entries.reduce((a, e) => a + e.valor, 0);
    if (macro.subtotal != null && !nearlyEqual(sum, macro.subtotal)) {
      issues.push({
        type: "WARNING",
        code: "CANON_RECEITAS_GROUP_SUBTOTAL",
        message: `Receitas "${macro.groupName}": soma dos itens (${sum.toFixed(2)}) difere do subtotal (${macro.subtotal.toFixed(2)}).`,
        details: { groupName: macro.groupName },
      });
    }
  }

  for (const macro of canonical.despesas) {
    const sum = macro.entries.reduce((a, e) => a + e.valor, 0);
    if (macro.subtotal != null && !nearlyEqual(sum, macro.subtotal)) {
      issues.push({
        type: "WARNING",
        code: "CANON_DESPESAS_GROUP_SUBTOTAL",
        message: `Despesas "${macro.groupName}": soma dos itens (${sum.toFixed(2)}) difere do subtotal (${macro.subtotal.toFixed(2)}).`,
        details: { groupName: macro.groupName },
      });
    }
  }

  for (const table of [canonical.contasCorrentes, canonical.contasPoupancaAplicacao]) {
    if (!table) continue;
    for (const row of table.rows) {
      const sa = row.saldoAnterior;
      const cr = row.creditos;
      const db = row.debitos;
      const sf = row.saldoFinal;
      if (
        sa != null &&
        cr != null &&
        db != null &&
        sf != null &&
        Number.isFinite(sa) &&
        Number.isFinite(cr) &&
        Number.isFinite(db) &&
        Number.isFinite(sf)
      ) {
        const expected = sa + cr - db + (row.transfMais ?? 0) - (row.transfMenos ?? 0);
        if (!nearlyEqual(expected, sf)) {
          issues.push({
            type: "WARNING",
            code: "CANON_CONTA_ROW_EQUATION",
            message: `Linha "${row.label}" (${table.tableName}): saldo anterior + créditos - débitos ≠ saldo final.`,
            details: { tableName: table.tableName, expected, saldoFinal: sf },
          });
        }
      }
    }
  }

  return issues;
}
