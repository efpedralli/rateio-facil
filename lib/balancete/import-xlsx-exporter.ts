/**
 * Exporta o XLSX final de importação do balancete a partir do modelo .xls (Belle Chateau).
 * Preenche as células de valor (col. L) na mesma linha do modelo, sem colunas técnicas de auditoria.
 */

import fs from "fs";
import path from "path";
import * as XLSX from "xlsx";
import type { BalanceteParseResult } from "./types";
import { BELLE_PDF_DESC_TO_TEMPLATE_KEY } from "./rules/belle-import-aliases";

const COL_A = 0;
const COL_DESC = 2;
const COL_VAL = 11;
const ROW_CONDOMINIO = 7;
const ROW_BALANCETE = 8;
const ROW_COMPETENCIA = 9;

const SHORT_MATCH_KEYS = new Set(["TOTAL", "RECEITAS", "DESPESAS"]);

export type BelleExportStats = {
  filledCells: number;
  unmatchedPoolLines: number;
  unusedTemplateSlots: number;
};

export function resolveBelleTemplateXlsPath(): string | null {
  const dir = path.join(process.cwd(), "models");
  if (!fs.existsSync(dir)) return null;
  const hit = fs.readdirSync(dir).find(
    (n) =>
      /\.xls$/i.test(n) &&
      n.toLowerCase().includes("belle") &&
      (n.toLowerCase().includes("modelo") || n.toLowerCase().includes("import"))
  );
  return hit ? path.join(dir, hit) : null;
}

export function normMatchKey(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/\s+/g, " ")
    .replace(/[^\w\d\-/.% ]/g, "")
    .trim();
}

function cellAddr(r: number, c: number): string {
  return XLSX.utils.encode_cell({ r, c });
}

function getStrCell(ws: XLSX.WorkSheet, r: number, c: number): string {
  const cell = ws[cellAddr(r, c)];
  if (!cell) return "";
  return String(cell.w ?? cell.v ?? "").trim();
}

function hasNumericValueCell(ws: XLSX.WorkSheet, r: number): boolean {
  const cell = ws[cellAddr(r, COL_VAL)];
  return Boolean(cell && cell.t === "n");
}

type TemplateSlot = { row: number; key: string };

function collectTemplateSlots(ws: XLSX.WorkSheet): TemplateSlot[] {
  const ref = ws["!ref"];
  if (!ref) return [];
  const range = XLSX.utils.decode_range(ref);
  const out: TemplateSlot[] = [];
  for (let r = range.s.r; r <= range.e.r; r++) {
    const desc = getStrCell(ws, r, COL_DESC);
    if (!desc || !hasNumericValueCell(ws, r)) continue;
    const key = normMatchKey(desc);
    if (key) out.push({ row: r, key });
  }
  return out;
}

type PoolLine = { descricao: string; valor: number; idx: number };

function buildPool(parse: BalanceteParseResult): PoolLine[] {
  const lines: PoolLine[] = [];
  let idx = 0;
  for (const e of parse.entries) {
    if (e.tipoLinha === "TITULO") continue;
    lines.push({ descricao: e.descricao, valor: e.valor, idx: idx++ });
  }
  for (const r of parse.resumoContas) {
    lines.push({ descricao: r.descricao, valor: Math.abs(r.valor), idx: idx++ });
  }
  return lines;
}

function maxPdfLenForShortKey(slotKey: string): number {
  if (slotKey === "TOTAL") return 26;
  return 24;
}

function pdfMatchesSlot(pdfNorm: string, slotKey: string): boolean {
  if (!pdfNorm.includes(slotKey)) return false;
  if (SHORT_MATCH_KEYS.has(slotKey) && pdfNorm.length > maxPdfLenForShortKey(slotKey)) {
    return false;
  }
  return true;
}

function pickPoolLineForSlot(
  pool: PoolLine[],
  used: Set<number>,
  slotKey: string
): PoolLine | null {
  const sorted = [...pool].filter((l) => !used.has(l.idx)).sort((a, b) => a.idx - b.idx);

  for (const line of sorted) {
    const pdfNorm = normMatchKey(line.descricao);
    if (pdfMatchesSlot(pdfNorm, slotKey)) {
      return line;
    }
    const aliasTarget = BELLE_PDF_DESC_TO_TEMPLATE_KEY[pdfNorm];
    if (aliasTarget && normMatchKey(aliasTarget) === slotKey) {
      return line;
    }
  }
  return null;
}

export function exportBelleChateauImportXlsx(
  templateXlsPath: string,
  outPath: string,
  parse: BalanceteParseResult
): BelleExportStats {
  // readFile(type:"file") falha em alguns ambientes Windows (Unicode no path, OneDrive, etc.)
  const templateBuf = fs.readFileSync(templateXlsPath);
  const wb = XLSX.read(templateBuf, { cellDates: true, type: "buffer" });
  const ws = wb.Sheets[wb.SheetNames[0]];
  if (!ws) throw new Error("Modelo sem planilha.");

  const slots = collectTemplateSlots(ws).sort((a, b) => a.row - b.row);
  const pool = buildPool(parse);
  const usedPool = new Set<number>();
  let filled = 0;

  const condo = parse.metadata.condominiumName?.trim();
  if (condo) {
    const short = condo.split("-")[0].trim();
    ws[cellAddr(ROW_CONDOMINIO, COL_A)] = { t: "str", v: `CONDOMÍNIO ${short}` };
  }
  const comp = parse.metadata.competenceLabel?.trim();
  if (comp) {
    ws[cellAddr(ROW_BALANCETE, COL_A)] = { t: "str", v: "BALANCETE MENSAL" };
    const compOnly = comp.includes("-")
      ? comp.split("-").slice(1).join("-").trim()
      : comp.replace(/^BALANCETE\s+MENSAL\s*-?\s*/i, "").trim();
    ws[cellAddr(ROW_COMPETENCIA, COL_A)] = {
      t: "str",
      v: compOnly.toUpperCase().startsWith("COMPET") ? compOnly : `COMPETÊNCIA ${compOnly}`,
    };
  }

  for (const slot of slots) {
    const line = pickPoolLineForSlot(pool, usedPool, slot.key);
    if (!line) continue;
    usedPool.add(line.idx);
    ws[cellAddr(slot.row, COL_VAL)] = { t: "n", v: Math.abs(line.valor), z: "#,##0.00" };
    filled++;
  }

  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  const outBuf = XLSX.write(wb, { bookType: "xlsx", type: "buffer" }) as Buffer;
  fs.writeFileSync(outPath, outBuf);

  return {
    filledCells: filled,
    unmatchedPoolLines: pool.length - usedPool.size,
    unusedTemplateSlots: slots.length - filled,
  };
}
