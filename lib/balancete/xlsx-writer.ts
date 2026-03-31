/**
 * Geração de XLSX com exceljs. Suporta template externo (opcional) ou layout padrão embutido.
 */

import fs from "fs/promises";
import path from "path";
import ExcelJS from "exceljs";
import type { BalanceteTemplateRow } from "./types";
import {
  defaultTemplateColumnSpec,
  type BalanceteTemplateColumnSpec,
} from "./rules/default-balancete-rules";

const HEADERS = [
  "Data",
  "Descrição",
  "Valor",
  "Categoria",
  "Grupo origem",
  "Conta (resumo)",
  "Linha original (auditoria)",
];

function colLetterToIndex(letter: string): number {
  let n = 0;
  for (let i = 0; i < letter.length; i++) {
    n = n * 26 + (letter.charCodeAt(i) - 64);
  }
  return n;
}

async function loadWorkbookFromTemplate(templateAbs: string): Promise<ExcelJS.Workbook> {
  const wb = new ExcelJS.Workbook();
  const buf = await fs.readFile(templateAbs);
  // Tipos duplicados de Buffer entre exceljs e @types/node.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await wb.xlsx.load(buf as any);
  return wb;
}

function ensureSheet(wb: ExcelJS.Workbook, spec: BalanceteTemplateColumnSpec): ExcelJS.Worksheet {
  let ws = wb.getWorksheet(spec.sheetName);
  if (!ws) {
    ws = wb.addWorksheet(spec.sheetName, {
      properties: { defaultRowHeight: 18 },
    });
    const c = spec.columns;
    ws.getCell(`${c.data}${spec.headerRow}`).value = HEADERS[0];
    ws.getCell(`${c.descricao}${spec.headerRow}`).value = HEADERS[1];
    ws.getCell(`${c.valor}${spec.headerRow}`).value = HEADERS[2];
    ws.getCell(`${c.categoria}${spec.headerRow}`).value = HEADERS[3];
    ws.getCell(`${c.grupo}${spec.headerRow}`).value = HEADERS[4];
    ws.getCell(`${c.conta}${spec.headerRow}`).value = HEADERS[5];
    ws.getCell(`${c.auditoria}${spec.headerRow}`).value = HEADERS[6];
  }
  return ws;
}

function writeRows(
  ws: ExcelJS.Worksheet,
  spec: BalanceteTemplateColumnSpec,
  rows: BalanceteTemplateRow[]
): void {
  const c = spec.columns;
  let r = spec.firstDataRow;
  for (const row of rows) {
    ws.getCell(`${c.data}${r}`).value = row.data ?? "";
    ws.getCell(`${c.descricao}${r}`).value = row.descricao;
    ws.getCell(`${c.valor}${r}`).value = row.valor;
    ws.getCell(`${c.valor}${r}`).numFmt = "#,##0.00";
    ws.getCell(`${c.categoria}${r}`).value = row.categoriaImportacao;
    ws.getCell(`${c.grupo}${r}`).value = row.grupoOrigem;
    ws.getCell(`${c.conta}${r}`).value = row.contaResumo ?? "";
    ws.getCell(`${c.auditoria}${r}`).value = row.linhaAuditoria ?? "";
    r += 1;
  }
}

/**
 * Escreve o arquivo XLSX. Se `templatePath` existir, carrega e preenche a aba configurada;
 * caso contrário cria workbook novo com layout padrão.
 */
export async function writeBalanceteXlsx(
  outputAbsPath: string,
  rows: BalanceteTemplateRow[],
  options?: { templatePath?: string | null; columnSpec?: BalanceteTemplateColumnSpec }
): Promise<void> {
  const spec = options?.columnSpec ?? defaultTemplateColumnSpec;
  let wb: ExcelJS.Workbook;

  const envTemplate = process.env.BALANCETE_IMPORT_TEMPLATE;
  const templateCandidate =
    options?.templatePath ??
    (envTemplate ? path.isAbsolute(envTemplate) ? envTemplate : path.join(process.cwd(), envTemplate) : null);

  if (templateCandidate) {
    try {
      await fs.access(templateCandidate);
      wb = await loadWorkbookFromTemplate(templateCandidate);
    } catch {
      wb = new ExcelJS.Workbook();
    }
  } else {
    wb = new ExcelJS.Workbook();
  }

  const ws = ensureSheet(wb, spec);
  writeRows(ws, spec, rows);

  // Larguras mínimas para leitura humana
  const maxCol = Math.max(
    colLetterToIndex(spec.columns.auditoria),
    colLetterToIndex(spec.columns.descricao)
  );
  for (let i = 1; i <= maxCol; i++) {
    const col = ws.getColumn(i);
    if (!col.width) {
      col.width = i === colLetterToIndex(spec.columns.descricao) ? 42 : 14;
    }
  }

  await fs.mkdir(path.dirname(outputAbsPath), { recursive: true });
  await wb.xlsx.writeFile(outputAbsPath);
}
