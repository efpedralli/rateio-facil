/**
 * Orquestração: parser Python → normalização → validação → documento de importação → XLSX final (modelo Belle).
 */

import path from "path";
import type { BalanceteImportDocument, BalanceteValidationSummary } from "./import-types";
import type { BalanceteJobSummary, BalanceteParseResult, BalanceteValidationIssue } from "./types";
import {
  exportBelleChateauImportXlsx,
  resolveBelleTemplateXlsPath,
  type BelleExportStats,
} from "./import-xlsx-exporter";
import { mapParsedBalanceteToImportDocument } from "./import-mapper";
import { normalizeParseResult } from "./normalizers";
import { entriesLancamentos, buildBalanceteValidationSummary, validateBalancete } from "./validators";
import { runBalanceteParser } from "./python-runner";

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
  exportStats: BelleExportStats | null,
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
        }
      : undefined,
    validationSummary,
  };
}

/**
 * Processa PDF e grava XLSX final no layout do modelo `models/*Belle*modelo*.xls`.
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
  let exportStats: BelleExportStats | null = null;
  let fileError = false;

  if (!validation.blocking) {
    const tpl = resolveBelleTemplateXlsPath();
    if (!tpl) {
      console.warn(`${LOG} job=${jobId} | export | modelo .xls não encontrado em models/`);
      issues.push({
        type: "ERROR",
        code: "NO_IMPORT_TEMPLATE",
        message:
          "Modelo de importação não encontrado. Coloque o arquivo .xls do balancete em `models/` (ex.: BELLE CHATEAU 2 - modelo importação.xls).",
      });
      fileError = true;
    } else {
      const tX = Date.now();
      console.log(`${LOG} job=${jobId} | export XLSX | template=${tpl} → ${xlsxAbs}`);
      exportStats = exportBelleChateauImportXlsx(tpl, xlsxAbs, parse);
      console.log(
        `${LOG} job=${jobId} | export concluído em ${Date.now() - tX}ms | filled=${exportStats.filledCells} unmatchedPool=${exportStats.unmatchedPoolLines} unusedSlots=${exportStats.unusedTemplateSlots}`
      );
      if (exportStats.unmatchedPoolLines > 0 || exportStats.unusedTemplateSlots > 0) {
        issues.push({
          type: "WARNING",
          code: "IMPORT_FILL_PARTIAL",
          message: `Preenchimento do modelo: ${exportStats.unmatchedPoolLines} linha(s) extraída(s) sem célula correspondente; ${exportStats.unusedTemplateSlots} linha(s) do modelo sem valor.`,
          details: {
            filledCells: exportStats.filledCells,
            unmatchedPoolLines: exportStats.unmatchedPoolLines,
            unusedTemplateSlots: exportStats.unusedTemplateSlots,
          },
        });
      }
    }
  } else {
    console.warn(`${LOG} job=${jobId} | export ignorado (validação bloqueante)`);
  }

  const validationSummary = buildBalanceteValidationSummary(issues, exportStats ?? undefined);
  const summary = buildSummary(parse, issues, exportStats, validationSummary);

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
