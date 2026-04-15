/**
 * Pós-processamento do JSON vindo do parser Python (sanidade + alinhamento ao modelo TS).
 */

import type {
  BalanceteEntry,
  BalanceteEntryFase,
  BalanceteParseResult,
  BalanceteResumoConta,
  BalanceteValidationIssue,
} from "./types";
import { coerceCanonicalDocument, emptyCanonicalDocument } from "./canonical-coerce";
import { repairMojibakeText } from "./text-repair";

const SECOES: BalanceteEntry["secaoMacro"][] = ["RECEITAS", "DESPESAS", "RESUMO_CONTAS"];
const TIPOS_LINHA: BalanceteEntry["tipoLinha"][] = [
  "ITEM",
  "SUBTOTAL",
  "TOTAL_GERAL",
  "TITULO",
];

const FASES: BalanceteEntryFase[] = ["LANCAMENTOS", "RESUMO_MES"];

const MOVIMENTOS: BalanceteResumoConta["movimento"][] = [
  "SALDO_ANTERIOR",
  "ENTRADA",
  "SAIDA",
  "SALDO_ATUAL",
  "TOTAL_DISPONIVEL",
];

export function normalizeText(line: string): string {
  return (line ?? "")
    .replace(/\u00a0/g, " ")
    .replace(/\uFFFD/g, "")
    .replace(/\r/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

const RE_TRAILING_RS_MONEY = /\s+R\$\s*[\d.\s\u00a0-]*,\d{2}\s*$/i;

export function stripTrailingMoneyFromDesc(line: string): string {
  // Remove " ... R$ 16,00" no final da descrição (valor já existe no campo `valor`)
  // Sem mexer em números no meio da frase.
  const t = normalizeText(line ?? "");
  return t.replace(RE_TRAILING_RS_MONEY, "").trim();
}

export function parseBrazilianCurrencyToken(token: string): number | null {
  const t = token.trim();
  if (!/^-?\d{1,3}(?:\.\d{3})*,\d{2}$/.test(t) && !/^-?\d+,\d{2}$/.test(t)) {
    return null;
  }
  const neg = t.startsWith("-");
  const body = neg ? t.slice(1) : t;
  const n = parseFloat(body.replace(/\./g, "").replace(",", "."));
  if (!Number.isFinite(n)) return null;
  return neg ? -n : n;
}

function coerceEntry(raw: unknown): BalanceteEntry | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const secaoMacro = o.secaoMacro;
  const tipoLinha = o.tipoLinha;
  if (typeof secaoMacro !== "string" || !SECOES.includes(secaoMacro as BalanceteEntry["secaoMacro"])) {
    return null;
  }
  if (typeof tipoLinha !== "string" || !TIPOS_LINHA.includes(tipoLinha as BalanceteEntry["tipoLinha"])) {
    return null;
  }
  const valor = Number(o.valor);
  if (!Number.isFinite(valor)) return null;
  const sinal = o.sinal === -1 ? -1 : 1;
  const faseRaw = o.fase;
  const fase =
    typeof faseRaw === "string" && FASES.includes(faseRaw as BalanceteEntryFase)
      ? (faseRaw as BalanceteEntryFase)
      : undefined;

  const entry: BalanceteEntry = {
    secaoMacro: secaoMacro as BalanceteEntry["secaoMacro"],
    grupoOrigem: String(o.grupoOrigem ?? "GERAL"),
    data: o.data == null ? null : String(o.data),
    fornecedor: o.fornecedor == null ? null : String(o.fornecedor),
    descricao: stripTrailingMoneyFromDesc(repairMojibakeText(String(o.descricao ?? ""))),
    valor: Math.abs(valor),
    sinal,
    tipoLinha: tipoLinha as BalanceteEntry["tipoLinha"],
    linhaOriginal: o.linhaOriginal == null ? null : String(o.linhaOriginal),
  };
  if (fase) entry.fase = fase;
  return entry;
}

function coerceResumo(raw: unknown): BalanceteResumoConta | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const movimento = o.movimento;
  if (typeof movimento !== "string" || !MOVIMENTOS.includes(movimento as BalanceteResumoConta["movimento"])) {
    return null;
  }
  const valor = Number(o.valor);
  if (!Number.isFinite(valor)) return null;
  return {
    conta: String(o.conta ?? ""),
    movimento: movimento as BalanceteResumoConta["movimento"],
    descricao: repairMojibakeText(String(o.descricao ?? "")),
    valor,
    linhaOriginal: o.linhaOriginal == null ? null : String(o.linhaOriginal),
  };
}

function coerceIssue(raw: unknown): BalanceteValidationIssue | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const type = o.type === "ERROR" ? "ERROR" : "WARNING";
  const code = String(o.code ?? "UNKNOWN");
  const message = String(o.message ?? "");
  const details = o.details;
  return {
    type,
    code,
    message,
    details:
      details && typeof details === "object" && !Array.isArray(details)
        ? (details as Record<string, unknown>)
        : undefined,
  };
}

/**
 * Valida e normaliza o payload bruto do Python para `BalanceteParseResult`.
 */
export function normalizeParseResult(raw: unknown, fileName: string): BalanceteParseResult {
  const issues: BalanceteValidationIssue[] = [];

  if (!raw || typeof raw !== "object") {
    issues.push({
      type: "ERROR",
      code: "INVALID_PARSE_PAYLOAD",
      message: "Resposta do parser não é um objeto JSON válido.",
    });
    return {
      entries: [],
      resumoContas: [],
      issues,
      metadata: { fileName, parserLayoutId: "default" },
      schemaVersion: 0,
      canonical: emptyCanonicalDocument(),
    };
  }

  const o = raw as Record<string, unknown>;
  const entriesIn = Array.isArray(o.entries) ? o.entries : [];
  const resumoIn = Array.isArray(o.resumoContas) ? o.resumoContas : [];
  const meta = o.metadata && typeof o.metadata === "object" ? (o.metadata as Record<string, unknown>) : {};

  const entries: BalanceteEntry[] = [];
  for (const row of entriesIn) {
    const e = coerceEntry(row);
    if (e) entries.push(e);
    else {
      issues.push({
        type: "WARNING",
        code: "DROPPED_ENTRY",
        message: "Entrada ignorada por formato inválido.",
        details: { sample: JSON.stringify(row).slice(0, 200) },
      });
    }
  }

  const resumoContas: BalanceteResumoConta[] = [];
  for (const row of resumoIn) {
    const r = coerceResumo(row);
    if (r) resumoContas.push(r);
  }

  const parserIssues = Array.isArray(o.issues) ? o.issues : [];
  for (const row of parserIssues) {
    const iss = coerceIssue(row);
    if (iss) issues.push(iss);
  }

  const blocksRaw = meta.blocksDetected;
  const blocksDetected = Array.isArray(blocksRaw) ? blocksRaw.map((x) => String(x)) : undefined;
  const schemaVersion =
    typeof o.schemaVersion === "number" && Number.isFinite(o.schemaVersion)
      ? o.schemaVersion
      : 2;

  const canonical = coerceCanonicalDocument(o.canonical) ?? emptyCanonicalDocument();

  return {
    entries,
    resumoContas,
    issues,
    metadata: {
      fileName: String(meta.fileName ?? fileName),
      competenceLabel: meta.competenceLabel == null ? null : String(meta.competenceLabel),
      competenceStart: meta.competenceStart == null ? null : String(meta.competenceStart),
      competenceEnd: meta.competenceEnd == null ? null : String(meta.competenceEnd),
      condominiumName: meta.condominiumName == null ? null : String(meta.condominiumName),
      parserLayoutId: meta.parserLayoutId == null ? null : String(meta.parserLayoutId),
      blocksDetected,
    },
    schemaVersion,
    canonical,
  };
}
