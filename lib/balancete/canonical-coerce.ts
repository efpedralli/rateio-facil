/**
 * Converte o objeto `canonical` do JSON Python em tipos TypeScript.
 */

import type {
  CanonicalBalanceteDocument,
  ParsedContaResumoRow,
  ParsedContaResumoTable,
  ParsedLancamento,
  ParsedLancamentoGroup,
  ParsedResumoItem,
  ParsedTotalGeral,
} from "./canonical-types";
import { repairMojibakeText } from "./text-repair";

function num(v: unknown): number | null {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

function str(v: unknown): string {
  return v == null ? "" : repairMojibakeText(String(v));
}

function coerceLancamento(raw: unknown): ParsedLancamento | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const valor = num(o.valor);
  if (valor == null) return null;
  return {
    descricao: str(o.descricao),
    fornecedor: o.fornecedor == null ? null : str(o.fornecedor),
    mesRef: o.mesRef == null ? null : str(o.mesRef),
    baixa: o.baixa == null ? null : str(o.baixa),
    tipoPgto: o.tipoPgto == null ? null : str(o.tipoPgto),
    notaFiscal: o.notaFiscal == null ? null : str(o.notaFiscal),
    valor: Math.abs(valor),
    rawLine: o.rawLine == null ? null : str(o.rawLine),
  };
}

function coerceGroup(raw: unknown): ParsedLancamentoGroup | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const entriesIn = Array.isArray(o.entries) ? o.entries : [];
  const entries: ParsedLancamento[] = [];
  for (const e of entriesIn) {
    const x = coerceLancamento(e);
    if (x) entries.push(x);
  }
  const st = o.subtotal == null ? null : num(o.subtotal);
  return {
    groupName: str(o.groupName) || "GERAL",
    entries,
    subtotal: st,
  };
}

function coerceResumoItem(raw: unknown): ParsedResumoItem | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const valor = num(o.valor);
  if (valor == null) return null;
  return { label: str(o.label), valor };
}

function coerceContaRow(raw: unknown): ParsedContaResumoRow | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  return {
    label: str(o.label) || "—",
    conta: o.conta == null ? undefined : str(o.conta),
    movimento: o.movimento == null ? undefined : str(o.movimento),
    saldoAnterior: o.saldoAnterior == null ? null : num(o.saldoAnterior),
    creditos: o.creditos == null ? null : num(o.creditos),
    debitos: o.debitos == null ? null : num(o.debitos),
    transfMais: o.transfMais == null ? null : num(o.transfMais),
    transfMenos: o.transfMenos == null ? null : num(o.transfMenos),
    saldoFinal: o.saldoFinal == null ? null : num(o.saldoFinal),
    valor: o.valor == null ? null : num(o.valor),
  };
}

function coerceTable(raw: unknown): ParsedContaResumoTable | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const rowsIn = Array.isArray(o.rows) ? o.rows : [];
  const rows: ParsedContaResumoRow[] = [];
  for (const r of rowsIn) {
    const x = coerceContaRow(r);
    if (x) rows.push(x);
  }
  const cols = Array.isArray(o.columns) ? o.columns.map((c) => str(c)) : [];
  return {
    tableName: str(o.tableName) || "Contas",
    columns: cols,
    rows,
    totalRow: null,
  };
}

function coerceTotalGeral(raw: unknown): ParsedTotalGeral | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const valor = num(o.valor);
  if (valor == null) return null;
  return { label: str(o.label), valor };
}

export function emptyCanonicalDocument(): CanonicalBalanceteDocument {
  return {
    receitas: [],
    despesas: [],
    resumo: [],
    contasCorrentes: null,
    contasPoupancaAplicacao: null,
    totalGeral: null,
  };
}

export function coerceCanonicalDocument(raw: unknown): CanonicalBalanceteDocument | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;

  const receitas: ParsedLancamentoGroup[] = [];
  for (const g of Array.isArray(o.receitas) ? o.receitas : []) {
    const x = coerceGroup(g);
    if (x) receitas.push(x);
  }
  const despesas: ParsedLancamentoGroup[] = [];
  for (const g of Array.isArray(o.despesas) ? o.despesas : []) {
    const x = coerceGroup(g);
    if (x) despesas.push(x);
  }
  const resumo: ParsedResumoItem[] = [];
  for (const it of Array.isArray(o.resumo) ? o.resumo : []) {
    const x = coerceResumoItem(it);
    if (x) resumo.push(x);
  }

  const contasCorrentes = o.contasCorrentes == null ? null : coerceTable(o.contasCorrentes);
  const contasPoupancaAplicacao =
    o.contasPoupancaAplicacao == null ? null : coerceTable(o.contasPoupancaAplicacao);
  const totalGeral = o.totalGeral == null ? null : coerceTotalGeral(o.totalGeral);

  return {
    receitas,
    despesas,
    resumo,
    contasCorrentes,
    contasPoupancaAplicacao,
    totalGeral,
  };
}
