/**
 * Orquestração: parser Python → normalização → validação → documento de importação → XLSX padrão (Python/openpyxl).
 */

import fs from "fs/promises";
import path from "path";
import type { BalanceteImportDocument, BalanceteValidationSummary } from "./import-types";
import type {
  BalanceteExportStats,
  BalanceteJobSummary,
  BalanceteParseResult,
  BalanceteValidationIssue,
} from "./types";
import { buildCanonicalExportPayload } from "./canonical-export-payload";
import { mapParsedBalanceteToImportDocument } from "./import-mapper";
import { normalizeParseResult } from "./normalizers";
import { entriesLancamentos, buildBalanceteValidationSummary, validateBalancete } from "./validators";
import { runBalanceteExportSeensXlsx, runBalanceteExportXlsx, runBalanceteParser } from "./python-runner";
import { buildSeensOutputRelativePath } from "./seens-export-path";

const LOG = "[balancete]";

export type ProcessBalanceteResult = {
  parse: BalanceteParseResult;
  importDocument: BalanceteImportDocument;
  summary: BalanceteJobSummary;
  issues: BalanceteValidationIssue[];
  validationSummary: BalanceteValidationSummary;
  xlsxRelativePath: string;
  blocking: boolean;
};

function countGroups(entries: BalanceteParseResult["entries"]): number {
  const keys = new Set<string>();
  const lan = entriesLancamentos(entries);
  for (const e of lan) {
    if (e.secaoMacro === "RESUMO_CONTAS") continue;
    keys.add(`${e.secaoMacro}::${e.grupoOrigem}`);
  }
  return keys.size;
}

function buildSummary(
  parse: BalanceteParseResult,
  issues: BalanceteValidationIssue[],
  exportStats: BalanceteExportStats | null,
  validationSummary: BalanceteValidationSummary
): BalanceteJobSummary {
  const lan = entriesLancamentos(parse.entries);
  const itemCount = lan.filter((e) => e.tipoLinha === "ITEM").length;
  const resumoMesLineCount = parse.entries.filter(
    (e) => e.fase === "RESUMO_MES" && e.tipoLinha === "ITEM"
  ).length;
  const errorCount = issues.filter((i) => i.type === "ERROR").length;
  const warningCount = issues.filter((i) => i.type === "WARNING").length;

  return {
    entryCount: parse.entries.length,
    itemCount,
    lancamentosItemCount: itemCount,
    resumoMesLineCount,
    groupCount: countGroups(parse.entries),
    resumoContaCount: parse.resumoContas.length,
    issueCount: issues.length,
    errorCount,
    warningCount,
    validationsOk: errorCount === 0 && warningCount === 0,
    competenceLabel: parse.metadata.competenceLabel,
    condominiumName: parse.metadata.condominiumName,
    parserLayoutId: parse.metadata.parserLayoutId,
    importFill: exportStats
      ? {
          filledCells: exportStats.filledCells,
          unmatchedPoolLines: exportStats.unmatchedPoolLines,
          unusedTemplateSlots: exportStats.unusedTemplateSlots,
          dataRowsWritten: exportStats.dataRowsWritten,
          sectionCount: exportStats.sectionCount,
        }
      : undefined,
    validationSummary,
  };
}

/**
 * Processa PDF e grava XLSX padrão (três abas) via `scripts/balancete/export_xlsx.py`.
 */
export async function processBalanceteJob(params: {
  jobId: string;
  pdfAbsPath: string;
  originalFileName: string;
}): Promise<ProcessBalanceteResult> {
  const { jobId, pdfAbsPath, originalFileName } = params;
  const tJob = Date.now();

  console.log(`${LOG} job=${jobId} | início processamento | ${originalFileName}`);

  const raw = await runBalanceteParser(pdfAbsPath, originalFileName);
  console.log(
    `${LOG} job=${jobId} | JSON bruto recebido | +${Date.now() - tJob}ms desde início do job`
  );

  const parse = normalizeParseResult(raw, originalFileName);
  console.log(
    `${LOG} job=${jobId} | normalizado | entries=${parse.entries.length} resumoContas=${parse.resumoContas.length} issues(parser)=${parse.issues.length}`
  );

  const validation = validateBalancete(parse);
  console.log(
    `${LOG} job=${jobId} | validação | blocking=${validation.blocking} issues(total)=${validation.issues.length}`
  );

  const importDocument = mapParsedBalanceteToImportDocument(parse);
  console.log(`${LOG} job=${jobId} | importDocument | rows=${importDocument.rows.length}`);

  const outDir = path.join(process.cwd(), "uploads", "balancetes", jobId);
  const xlsxAbs = path.join(outDir, "saida.xlsx");
  const xlsxRelativePath = path.join("uploads", "balancetes", jobId, "saida.xlsx").replace(/\\/g, "/");

  const issues = [...validation.issues];
  let exportStats: BalanceteExportStats | null = null;
  let fileError = false;
  let seensXlsxRelativePath: string | undefined;

  if (!validation.blocking) {
    try {
      const payload = buildCanonicalExportPayload(parse);
      const jsonPath = path.join(outDir, "canonical_export.json");
      await fs.writeFile(jsonPath, JSON.stringify(payload), "utf-8");
      const tX = Date.now();
      console.log(`${LOG} job=${jobId} | export XLSX (sem template) → ${xlsxAbs}`);
      await runBalanceteExportXlsx(jsonPath, xlsxAbs);
      const dataRows =
        payload.entries.length + Object.keys(payload.summary).length + payload.accounts.length;
      exportStats = {
        filledCells: payload.entries.length,
        unmatchedPoolLines: 0,
        unusedTemplateSlots: 0,
        dataRowsWritten: dataRows,
        sectionCount: 3,
      };
      console.log(
        `${LOG} job=${jobId} | export concluído em ${Date.now() - tX}ms | lançamentos=${payload.entries.length} contas=${payload.accounts.length}`
      );

      try {
        const seensRel = buildSeensOutputRelativePath(
          payload.metadata.condominio,
          payload.metadata.competencia,
          payload.metadata.periodo_inicio
        );
        const seensAbs = path.join(
          process.cwd(),
          ...seensRel.split("/").filter(Boolean)
        );
        await runBalanceteExportSeensXlsx(jsonPath, seensAbs);
        seensXlsxRelativePath = seensRel;
        console.log(`${LOG} job=${jobId} | export Seens → ${seensRel}`);
      } catch (seensErr) {
        const sm = seensErr instanceof Error ? seensErr.message : String(seensErr);
        console.warn(`${LOG} job=${jobId} | export Seens não gerado | ${sm.slice(0, 300)}`);
      }
    } catch (e) {
      fileError = true;
      const msg = e instanceof Error ? e.message : String(e);
      console.error(`${LOG} job=${jobId} | export falhou | ${msg.slice(0, 400)}`);
      issues.push({
        type: "ERROR",
        code: "EXPORT_XLSX_FAILED",
        message: `Falha ao gerar a planilha de importação: ${msg}`,
      });
    }
  } else {
    console.warn(`${LOG} job=${jobId} | export ignorado (validação bloqueante)`);
  }

  const validationSummary = buildBalanceteValidationSummary(issues, exportStats ?? undefined);
  const summary: BalanceteJobSummary = {
    ...buildSummary(parse, issues, exportStats, validationSummary),
    ...(seensXlsxRelativePath ? { seensXlsxRelativePath } : {}),
  };

  const blocking = validation.blocking || fileError;

  console.log(
    `${LOG} job=${jobId} | fim | blocking=${blocking} | ${Date.now() - tJob}ms total | erros=${summary.errorCount} avisos=${summary.warningCount}`
  );

  return {
    parse,
    importDocument,
    summary,
    issues,
    validationSummary,
    xlsxRelativePath: blocking ? "" : xlsxRelativePath,
    blocking,
  };
}
