/**
 * Exportação do balancete para XLSX a partir do modelo canônico semântico (sem template .xls fixo).
 * Layout por seções contábeis, legível e adequado a importação/revisão.
 */

import fs from "fs";
import path from "path";
import ExcelJS from "exceljs";
import type { CanonicalBalanceteDocument } from "./canonical-types";
import type { BalanceteParseMetadata } from "./types";

export type SemanticExportStats = {
  dataRowsWritten: number;
  sectionCount: number;
};

function sectionRow(ws: ExcelJS.Worksheet, r: number, title: string): number {
  const row = ws.getRow(r);
  row.values = [title, "", ""];
  row.font = { bold: true, size: 11 };
  row.fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: "FFE5E7EB" },
  };
  return r + 1;
}

export async function exportSemanticBalanceteXlsx(
  canonical: CanonicalBalanceteDocument,
  metadata: BalanceteParseMetadata,
  outAbsPath: string
): Promise<SemanticExportStats> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "Rateio Fácil — Balancete";
  const ws = wb.addWorksheet("Balancete", {});

  ws.columns = [{ width: 56 }, { width: 18 }, { width: 42 }];

  let r = 1;
  let sections = 0;
  let dataRows = 0;

  const hdr = ws.getRow(r++);
  hdr.values = ["Descrição", "Valor (R$)", "Detalhes / colunas"];
  hdr.font = { bold: true };
  hdr.fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: "FFF3F4F6" },
  };

  const pushMeta = (text: string) => {
    ws.getRow(r++).values = [text, "", ""];
    dataRows++;
  };

  if (metadata.condominiumName) pushMeta(metadata.condominiumName);
  if (metadata.competenceLabel) pushMeta(metadata.competenceLabel);
  r++;

  const writeData = (desc: string, val: number | null | undefined, det?: string) => {
    ws.getRow(r++).values = [desc, val != null && Number.isFinite(val) ? val : "", det ?? ""];
    dataRows++;
  };

  const section = (title: string) => {
    sections++;
    r = sectionRow(ws, r, title);
    r++;
  };

  section("RECEITAS");
  for (const g of canonical.receitas) {
    writeData(`— ${g.groupName} —`, null);
    for (const e of g.entries) {
      writeData(e.descricao, e.valor);
    }
    if (g.subtotal != null) {
      writeData(`Subtotal (${g.groupName})`, g.subtotal);
    }
  }

  section("DESPESAS");
  for (const g of canonical.despesas) {
    writeData(`— ${g.groupName} —`, null);
    for (const e of g.entries) {
      writeData(e.descricao, -Math.abs(e.valor));
    }
    if (g.subtotal != null) {
      writeData(`Subtotal (${g.groupName})`, -Math.abs(g.subtotal));
    }
  }

  if (canonical.resumo.length) {
    section("RESUMO DO MÊS");
    for (const it of canonical.resumo) {
      writeData(it.label, it.valor);
    }
  }

  const emitContaTable = (title: string, table: NonNullable<CanonicalBalanceteDocument["contasCorrentes"]>) => {
    section(title);
    if (table.columns.length) {
      writeData(`Colunas detectadas: ${table.columns.join(", ")}`, null);
    }
    for (const row of table.rows) {
      const det = [
        row.saldoAnterior != null ? `Saldo ant.: ${row.saldoAnterior}` : "",
        row.creditos != null ? `Créditos: ${row.creditos}` : "",
        row.debitos != null ? `Débitos: ${row.debitos}` : "",
        row.transfMais != null ? `Transf. (+): ${row.transfMais}` : "",
        row.transfMenos != null ? `Transf. (-): ${row.transfMenos}` : "",
        row.saldoFinal != null ? `Saldo final: ${row.saldoFinal}` : "",
        row.movimento ? `Mov.: ${row.movimento}` : "",
      ]
        .filter(Boolean)
        .join(" · ");
      const val =
        row.saldoFinal ??
        (typeof row.valor === "number" ? row.valor : null) ??
        null;
      writeData(row.label || "—", val, det || undefined);
    }
  };

  if (canonical.contasCorrentes?.rows.length) {
    emitContaTable("CONTAS CORRENTES", canonical.contasCorrentes);
  }
  if (canonical.contasPoupancaAplicacao?.rows.length) {
    emitContaTable("POUPANÇA / APLICAÇÃO", canonical.contasPoupancaAplicacao);
  }

  if (canonical.totalGeral) {
    section("TOTAL GERAL");
    writeData(canonical.totalGeral.label, canonical.totalGeral.valor);
  }

  ws.getColumn(2).numFmt = "#,##0.00";

  await fs.promises.mkdir(path.dirname(outAbsPath), { recursive: true });
  await wb.xlsx.writeFile(outAbsPath);

  return { dataRowsWritten: dataRows, sectionCount: sections };
}
