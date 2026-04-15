/**
 * Exportação do balancete para XLSX em layout padronizado inspirado no modelo
 * de referência do condomínio Dom Felipe. O objetivo é manter uma estrutura
 * fixa por seções, independentemente do PDF de origem.
 */

import fs from "fs";
import path from "path";
import ExcelJS from "exceljs";
import type { CanonicalBalanceteDocument, ParsedContaResumoRow, ParsedContaResumoTable } from "./canonical-types";
import type { BalanceteParseMetadata, BalanceteParseResult, BalanceteResumoConta } from "./types";

const COL_A = 1;
const COL_B = 2;
const COL_C = 3;
const COL_L = 12;

export type SemanticExportStats = {
  dataRowsWritten: number;
  sectionCount: number;
};

type SummaryRow = {
  label: string;
  value: number;
};

type AccountGroup = {
  conta: string;
  rows: BalanceteResumoConta[];
};

function normalizeSpaces(value: string): string {
  return (value ?? "").replace(/\s+/g, " ").trim();
}

function toLowerLabel(value: string): string {
  return normalizeSpaces(value).toLocaleLowerCase("pt-BR");
}

function formatDateBr(input?: string | null): string | null {
  if (!input) return null;
  const raw = input.trim();
  if (!raw) return null;

  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw);
  if (iso) return `${iso[3]}/${iso[2]}/${iso[1]}`;

  const br = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(raw);
  if (br) return raw;

  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat("pt-BR").format(date);
}

function formatCompetenceLine(metadata: BalanceteParseMetadata): string {
  const start = formatDateBr(metadata.competenceStart);
  const end = formatDateBr(metadata.competenceEnd);

  if (start && end) {
    const [, month, year] = start.split("/");
    const monthName = new Intl.DateTimeFormat("pt-BR", {
      month: "long",
      year: "numeric",
      timeZone: "UTC",
    }).format(new Date(`${year}-${month}-01T00:00:00Z`));

    return `${monthName.replace(" de ", "/")} - período: ${start} a ${end}`;
  }

  return toLowerLabel(metadata.competenceLabel || "período não informado");
}

function groupNameIsGeneric(name: string): boolean {
  const norm = toLowerLabel(name);
  return !norm || norm === "geral" || norm === "receitas" || norm === "despesas" || norm === "resumo_mes";
}

function styleTextCell(cell: ExcelJS.Cell, bold = false) {
  cell.font = { name: "Arial", size: 10, bold };
  cell.alignment = { vertical: "middle" };
}

function styleCurrencyCell(cell: ExcelJS.Cell, bold = false) {
  cell.font = { name: "Arial", size: 10, bold };
  cell.alignment = { vertical: "middle", horizontal: "right" };
  cell.numFmt = "#,##0.00";
}

function addBottomBorder(ws: ExcelJS.Worksheet, rowNumber: number) {
  const row = ws.getRow(rowNumber);
  for (let c = COL_B; c <= COL_L; c++) {
    row.getCell(c).border = {
      bottom: { style: "thin", color: { argb: "FFBDBDBD" } },
    };
  }
}

function writeTitleRow(ws: ExcelJS.Worksheet, rowNumber: number, col: number, text: string, fontSize = 10) {
  const cell = ws.getRow(rowNumber).getCell(col);
  cell.value = text;
  cell.font = { name: "Arial", size: fontSize, bold: true };
}

function firstSummaryValue(canonical: CanonicalBalanceteDocument, pattern: RegExp): number | null {
  for (const item of canonical.resumo) {
    if (pattern.test(toLowerLabel(item.label)) && Number.isFinite(item.valor)) {
      return item.valor;
    }
  }
  return null;
}

function groupResumoContas(rows: BalanceteResumoConta[]): AccountGroup[] {
  const out = new Map<string, AccountGroup>();

  for (const row of rows) {
    const conta = normalizeSpaces(row.conta || "conta");
    const key = conta.toLocaleLowerCase("pt-BR");
    const group = out.get(key) ?? { conta, rows: [] };
    group.rows.push(row);
    out.set(key, group);
  }

  return [...out.values()];
}

function toAccountRowLabel(row: BalanceteResumoConta): string {
  const desc = toLowerLabel(row.descricao || "");
  if (row.movimento === "SALDO_ATUAL" || row.movimento === "TOTAL_DISPONIVEL") {
    return "total";
  }
  return desc || "total";
}

function toAccountRowValue(row: BalanceteResumoConta): number {
  const label = toAccountRowLabel(row);
  if (row.movimento === "SAIDA" || label.includes("débito") || label.includes("debito")) {
    return -Math.abs(row.valor);
  }
  if (label.includes("transferência (-)") || label.includes("transferencia (-)")) {
    return -Math.abs(row.valor);
  }
  return row.valor;
}

function canonicalAccountRowLabel(row: ParsedContaResumoRow): string {
  return toLowerLabel(row.label || row.conta || "conta");
}

function canonicalAccountRowValue(row: ParsedContaResumoRow): number {
  if (typeof row.saldoFinal === "number") return row.saldoFinal;
  if (typeof row.valor === "number") return row.valor;
  return Number.NaN;
}

function computeSummaryRows(parse: BalanceteParseResult): SummaryRow[] {
  return parse.canonical.resumo
    .filter((item) => Number.isFinite(item.valor))
    .map((item) => ({
      label: toLowerLabel(item.label),
      value: item.valor,
    }));
}

function writeLine(ws: ExcelJS.Worksheet, rowNumber: number, description: string, value?: number, bold = false) {
  const row = ws.getRow(rowNumber);
  const descCell = row.getCell(COL_C);
  descCell.value = description;
  styleTextCell(descCell, bold);

  if (typeof value === "number" && Number.isFinite(value)) {
    const valueCell = row.getCell(COL_L);
    valueCell.value = value;
    styleCurrencyCell(valueCell, bold);
  }

  addBottomBorder(ws, rowNumber);
}

function writeMacroSection(
  ws: ExcelJS.Worksheet,
  startRow: number,
  sectionTitle: string,
  groups: CanonicalBalanceteDocument["receitas"],
  withGroupTotals: boolean,
  explicitTotal?: number | null
): { nextRow: number; rowsWritten: number } {
  let row = startRow;
  let rowsWritten = 0;

  writeTitleRow(ws, row++, COL_B, toLowerLabel(sectionTitle));
  rowsWritten++;

  const showGroupHeaders = groups.filter((group) => group.entries.length > 0).length > 1;

  for (const group of groups) {
    if (group.entries.length === 0) continue;

    if (showGroupHeaders || !groupNameIsGeneric(group.groupName)) {
      writeTitleRow(ws, row++, COL_B, toLowerLabel(group.groupName));
      rowsWritten++;
    }

    for (const entry of group.entries) {
      writeLine(ws, row++, toLowerLabel(entry.descricao), Math.abs(entry.valor));
      rowsWritten++;
    }

    if (
      withGroupTotals &&
      group.subtotal != null &&
      (showGroupHeaders || !groupNameIsGeneric(group.groupName))
    ) {
      writeLine(ws, row++, "total", group.subtotal, true);
      rowsWritten++;
    }
  }

  if (typeof explicitTotal === "number" && Number.isFinite(explicitTotal)) {
    writeLine(
      ws,
      row++,
      sectionTitle.toLocaleLowerCase("pt-BR") === "receitas" ? "total de receitas" : "total de despesas",
      explicitTotal,
      true
    );
    rowsWritten++;
  }

  return { nextRow: row, rowsWritten };
}

export async function exportSemanticBalanceteXlsx(
  parse: BalanceteParseResult,
  outAbsPath: string
): Promise<SemanticExportStats> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "Rateio Facil";

  const ws = wb.addWorksheet("Sheet1", {
    views: [{ showGridLines: false }],
    pageSetup: { paperSize: 9, orientation: "portrait" },
  });

  ws.getColumn(COL_A).width = 20;
  ws.getColumn(COL_B).width = 24;
  ws.getColumn(COL_C).width = 68;
  ws.getColumn(COL_L).width = 16;

  for (let c = 4; c < COL_L; c++) ws.getColumn(c).width = 12;
  for (let c = COL_L + 1; c <= 17; c++) ws.getColumn(c).width = 10;

  writeTitleRow(ws, 8, COL_A, "demonstrativo de receitas e despesas", 11);
  writeTitleRow(ws, 8, COL_C, "receitas e despesas", 10);
  writeTitleRow(ws, 9, COL_A, toLowerLabel(parse.metadata.condominiumName || "condomínio não identificado"), 10);
  writeTitleRow(ws, 10, COL_A, formatCompetenceLine(parse.metadata), 10);

  let row = 11;
  let dataRowsWritten = 0;
  let sectionCount = 0;

  const receitasSection = writeMacroSection(
    ws,
    row,
    "receitas",
    parse.canonical.receitas,
    false,
    firstSummaryValue(parse.canonical, /total de receitas|^receitas$/)
  );
  row = receitasSection.nextRow + 1;
  dataRowsWritten += receitasSection.rowsWritten;
  sectionCount++;

  const despesasSection = writeMacroSection(
    ws,
    row,
    "despesas",
    parse.canonical.despesas,
    true,
    firstSummaryValue(parse.canonical, /total de despesas|^despesas$/)
  );
  row = despesasSection.nextRow + 1;
  dataRowsWritten += despesasSection.rowsWritten;
  sectionCount++;

  writeTitleRow(ws, row++, COL_B, "resumo");
  sectionCount++;
  dataRowsWritten++;
  for (const summaryRow of computeSummaryRows(parse)) {
    writeLine(ws, row++, summaryRow.label, summaryRow.value);
    dataRowsWritten++;
  }

  const canonicalTables: ParsedContaResumoTable[] = [
    parse.canonical.contasCorrentes,
    parse.canonical.contasPoupancaAplicacao,
  ].filter((table): table is ParsedContaResumoTable => Boolean(table && table.rows.length));

  const accountGroups = groupResumoContas(parse.resumoContas);
  if (canonicalTables.length || accountGroups.length) {
    row++;
    writeTitleRow(ws, row++, COL_B, "contas correntes");
    sectionCount++;
    dataRowsWritten++;

    if (canonicalTables.length) {
      for (const table of canonicalTables) {
        writeTitleRow(ws, row++, COL_B, toLowerLabel(table.tableName));
        dataRowsWritten++;

        for (const accountRow of table.rows) {
          writeLine(ws, row++, canonicalAccountRowLabel(accountRow), canonicalAccountRowValue(accountRow));
          dataRowsWritten++;
        }
      }
    } else {
      for (const group of accountGroups) {
        writeTitleRow(ws, row++, COL_B, toLowerLabel(group.conta));
        dataRowsWritten++;

        for (const accountRow of group.rows) {
          writeLine(ws, row++, toAccountRowLabel(accountRow), toAccountRowValue(accountRow));
          dataRowsWritten++;
        }
      }
    }
  }

  ws.eachRow((currentRow) => {
    currentRow.height = 18;
  });

  await fs.promises.mkdir(path.dirname(outAbsPath), { recursive: true });
  await wb.xlsx.writeFile(outAbsPath);

  return { dataRowsWritten, sectionCount };
}
