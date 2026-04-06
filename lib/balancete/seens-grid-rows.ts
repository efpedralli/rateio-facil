/**
 * Monta linhas de UI alinhadas ao fluxo de `export_excel_seens.py` (grupos, itens, totais, resumo, contas).
 */

import type {
  CanonicalBalanceteExportPayload,
  CanonicalExportEntry,
} from "./canonical-export-payload";

export type SeensGridRow =
  | { kind: "section"; id: string; section: string; group: string; title: string }
  | { kind: "entry"; id: string; entryIndex: number }
  | { kind: "group_total"; id: string; section: string; group: string }
  | { kind: "summary_break"; id: string }
  | { kind: "summary_header"; id: string; title: string }
  | { kind: "summary_row"; id: string; label: string; summaryKey: string }
  | { kind: "accounts_banner"; id: string; title: string }
  | { kind: "account_title"; id: string; accountIndex: number }
  | {
      kind: "account_line";
      id: string;
      accountIndex: number;
      field: "saldo_anterior" | "creditos" | "debitos" | "saldo_final";
      label: string;
    };

function normKey(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase();
}

function normSection(raw: string): string {
  const s = raw.toUpperCase().trim();
  if (s === "RECEITA" || s === "RECEITAS") return "RECEITAS";
  if (s === "DESPESA" || s === "DESPESAS") return "DESPESAS";
  return s;
}

const GROUP_SKIP = new Set([
  "entradas valor",
  "saidas valor",
  "saídas valor",
  "receitas x despesas",
  "resumo_mes",
  "resumo mes",
]);

function shouldSkipGroup(sec: string, grp: string): boolean {
  const g = normKey(grp);
  if (GROUP_SKIP.has(g)) return true;
  if (/^entradas\s+valor$/.test(g)) return true;
  if (/^(saydas|saidas|sa[ií]das)\s+valor$/.test(g)) return true;
  if (g.startsWith("resgates - fundo de obra")) return true;
  if (sec !== "RECEITAS" && sec !== "DESPESAS") return true;
  return false;
}

/** Espelha `_is_aggregate_line` do export Seens (subconjunto estável). */
export function isAggregateLineDesc(desc: string): boolean {
  const t = desc.trim();
  if (!t) return true;
  const low = normKey(t);
  const brMoney =
    /^(?:r\$\s*)?\(?\d{1,3}(?:\.\d{3})*,\d{2}\)?\s*$/i.test(
      t.replace(/\u00a0/g, " ")
    );
  if (brMoney) return true;
  const twoNums = /^\d{1,3}(?:\.\d{3})*,\d{2}\s+\d{1,3}(?:\.\d{3})*,\d{2}\s*$/.test(
    t.replace(/\u00a0/g, " ")
  );
  if (twoNums) return true;

  if (low === "receitas" || low === "despesas") return true;
  if (/^total\s*[:.]/.test(low)) return true;
  if (/\btotal\s+de\s+receitas\b/.test(low)) return true;
  if (/\btotal\s+de\s+despesas\b/.test(low)) return true;
  if (/^total\s*\(/.test(low)) return true;
  if (low.includes("subtotal")) return true;
  if (low.includes("total grupo")) return true;
  if (low.includes("total geral")) return true;
  if (low.includes("receitas do mes") || low.includes("receitas do mês")) return true;
  if (low.includes("despesas do mes") || low.includes("despesas do mês")) return true;
  if (/^receitas\s+r\$/.test(low)) return true;
  if (/^despesas\s+r\$/.test(low)) return true;
  if (/^despesas\s+ordin/.test(low)) return true;
  if (low.includes("despesas") && low.includes("agua") && low.includes("esgoto"))
    return true;
  if (/^despesas\s+fundo\s+de\s+manuten/.test(low)) return true;
  if (low.includes("total dispon")) return true;
  if (low.includes("total (receitas - despesas)")) return true;
  if (/^total\s*\(?\s*receitas\s*-\s*despesas/.test(low)) return true;
  return false;
}

const RE_GROUP_FROM_HEADER =
  /^\s*data\s+fornecedor\s*((?:\(\+\)|\(\-\)))\s*(.+?)\s*valor\s*$/i;

/** Remove (+)/(-) repetidos no início (ex.: título salvo após edição na UI já vinha com prefixo). */
function stripSeensGroupSignPrefixes(s: string): string {
  let t = s.replace(/\s+/g, " ").trim();
  for (let i = 0; i < 10; i++) {
    const next = t.replace(/^\(\+\)\s*/, "").replace(/^\(\-\)\s*/, "").trim();
    if (next === t) break;
    t = next;
  }
  return t;
}

export function normalizeGroupTitle(section: string, rawGroup: string): string {
  const g = rawGroup.trim();
  const m = RE_GROUP_FROM_HEADER.exec(g);
  if (m) {
    const sig = m[1];
    const body = m[2].replace(/\s+/g, " ").trim().toUpperCase();
    return `${sig} ${body}`;
  }
  const collapsed = stripSeensGroupSignPrefixes(g);
  const gl = normKey(collapsed);
  const revenueName = gl.startsWith("receita");
  if (revenueName || section === "RECEITAS") {
    return `(+) ${collapsed.toUpperCase()}`;
  }
  if (section === "DESPESAS") {
    return `(-) ${collapsed.toUpperCase()}`;
  }
  return collapsed.toUpperCase();
}

export function orderedGroupsFromPayload(entries: CanonicalExportEntry[]): {
  order: { sec: string; grp: string }[];
  groups: Map<string, CanonicalExportEntry[]>;
} {
  const order: { sec: string; grp: string }[] = [];
  const groups = new Map<string, CanonicalExportEntry[]>();
  const keyStr = (sec: string, grp: string) => `${sec}\n${grp}`;

  for (const ent of entries) {
    const sec = normSection(ent.section);
    const grp = (ent.group || "GERAL").trim() || "GERAL";
    if (shouldSkipGroup(sec, grp)) continue;
    const k = keyStr(sec, grp);
    if (!groups.has(k)) {
      groups.set(k, []);
      order.push({ sec, grp });
    }
    groups.get(k)!.push(ent);
  }

  const receitas = order.filter((o) => o.sec === "RECEITAS");
  const despesas = order.filter((o) => o.sec === "DESPESAS");
  return { order: [...receitas, ...despesas], groups };
}

export function filterItemEntriesForGroup(block: CanonicalExportEntry[]): CanonicalExportEntry[] {
  return block.filter((e) => !isAggregateLineDesc(e.descricao || ""));
}

export function sumEntryValues(entries: CanonicalExportEntry[]): number {
  let t = 0;
  for (const e of entries) {
    const v = Number(e.valor);
    if (Number.isFinite(v)) t += v;
  }
  return Math.round((t + Number.EPSILON) * 100) / 100;
}

export function entryIndexInPayload(
  payload: CanonicalBalanceteExportPayload,
  entry: CanonicalExportEntry
): number {
  return payload.entries.indexOf(entry);
}

export function buildSeensGridRows(payload: CanonicalBalanceteExportPayload): SeensGridRow[] {
  const rows: SeensGridRow[] = [];
  const { order, groups } = orderedGroupsFromPayload(payload.entries);

  for (const { sec, grp } of order) {
    const k = `${sec}\n${grp}`;
    const block = groups.get(k) ?? [];
    rows.push({
      kind: "section",
      id: `sec-${sec}-${normKey(grp)}`,
      section: sec,
      group: grp,
      title: normalizeGroupTitle(sec, grp),
    });

    const items = filterItemEntriesForGroup(block);
    for (const ent of items) {
      const idx = entryIndexInPayload(payload, ent);
      if (idx < 0) continue;
      rows.push({ kind: "entry", id: `e-${idx}`, entryIndex: idx });
    }

    rows.push({ kind: "group_total", id: `gt-${sec}-${normKey(grp)}`, section: sec, group: grp });
  }

  rows.push({ kind: "summary_break", id: "sb-month" });
  rows.push({
    kind: "summary_row",
    id: "sr-tr",
    label: "TOTAL RECEITAS DO MÊS",
    summaryKey: "total_receitas",
  });
  rows.push({
    kind: "summary_row",
    id: "sr-td",
    label: "TOTAL DESPESAS DO MÊS",
    summaryKey: "total_despesas",
  });
  rows.push({ kind: "summary_header", id: "sh-rm", title: "RESUMO DO MÊS" });
  rows.push({
    kind: "summary_row",
    id: "sr-rec",
    label: "RECEITAS",
    summaryKey: "total_receitas",
  });
  rows.push({
    kind: "summary_row",
    id: "sr-desp",
    label: "DESPESAS",
    summaryKey: "total_despesas",
  });
  rows.push({
    kind: "summary_row",
    id: "sr-diff",
    label: "TOTAL (RECEITAS - DESPESAS)",
    summaryKey: "saldo_mes",
  });

  if (payload.accounts?.length) {
    rows.push({
      kind: "accounts_banner",
      id: "acc-ban",
      title:
        "RESUMO DAS CONTAS - POSIÇÃO CONSOLIDADA DA CONTA PESSOA JURÍDICA - SICREDI",
    });
    payload.accounts.forEach((acc, accountIndex) => {
      rows.push({
        kind: "account_title",
        id: `at-${accountIndex}`,
        accountIndex,
      });
      const pairs: {
        field: "saldo_anterior" | "creditos" | "debitos" | "saldo_final";
        label: string;
      }[] = [
        { field: "saldo_anterior", label: "SALDO ANTERIOR" },
        { field: "creditos", label: "ENTRADAS" },
        { field: "debitos", label: "SAÍDAS" },
        { field: "saldo_final", label: "SALDO ATUAL" },
      ];
      for (const { field, label } of pairs) {
        rows.push({
          kind: "account_line",
          id: `al-${accountIndex}-${field}`,
          accountIndex,
          field,
          label,
        });
      }
    });
  }

  return rows;
}

export function rowIsBold(row: SeensGridRow): boolean {
  if (row.kind === "section") return true;
  if (row.kind === "group_total") return true;
  if (row.kind === "summary_header") return true;
  if (row.kind === "accounts_banner") return true;
  if (row.kind === "account_title") return true;
  if (row.kind === "summary_row") {
    return (
      row.label.includes("TOTAL") ||
      row.label === "RESUMO DO MÊS"
    );
  }
  return false;
}

export function updateSeensGroupName(
  payload: CanonicalBalanceteExportPayload,
  section: string,
  oldGroup: string,
  newGroup: string
): CanonicalBalanceteExportPayload {
  const trimmed = newGroup.trim();
  const ng = trimmed
    ? stripSeensGroupSignPrefixes(trimmed) || trimmed
    : oldGroup;
  const entries = payload.entries.map((e) => {
    if (normSection(e.section) !== section) return e;
    const g = (e.group || "GERAL").trim() || "GERAL";
    if (g !== oldGroup) return e;
    return { ...e, group: ng };
  });
  return { ...payload, entries };
}

export function updateSeensAccountName(
  payload: CanonicalBalanceteExportPayload,
  accountIndex: number,
  name: string
): CanonicalBalanceteExportPayload {
  const nextName = name.trim();
  const accounts = payload.accounts.map((a, i) =>
    i === accountIndex ? { ...a, nome: nextName || a.nome } : a
  );
  return { ...payload, accounts };
}

export function updateSeensMetaText(
  payload: CanonicalBalanceteExportPayload,
  key: "seens_accounts_banner" | "seens_month_summary_title",
  value: string
): CanonicalBalanceteExportPayload {
  const v = value.trim();
  return {
    ...payload,
    metadata: {
      ...(payload.metadata as Record<string, unknown>),
      [key]: v,
    } as CanonicalBalanceteExportPayload["metadata"],
  };
}

export function roundMoney2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

export function updateSeensEntry(
  payload: CanonicalBalanceteExportPayload,
  entryIndex: number,
  patch: Partial<Pick<CanonicalExportEntry, "descricao" | "valor">>
): CanonicalBalanceteExportPayload {
  const entries = payload.entries.map((e, i) =>
    i === entryIndex ? { ...e, ...patch } : e
  );
  return { ...payload, entries };
}

export function updateSeensSummary(
  payload: CanonicalBalanceteExportPayload,
  key: string,
  value: number
): CanonicalBalanceteExportPayload {
  return {
    ...payload,
    summary: { ...payload.summary, [key]: roundMoney2(value) },
  };
}

export function updateSeensAccount(
  payload: CanonicalBalanceteExportPayload,
  accountIndex: number,
  field: "saldo_anterior" | "creditos" | "debitos" | "saldo_final",
  value: number
): CanonicalBalanceteExportPayload {
  const accounts = payload.accounts.map((a, i) =>
    i === accountIndex ? { ...a, [field]: roundMoney2(value) } : a
  );
  return { ...payload, accounts };
}
