/**
 * Caminho do arquivo Seens em `outputs/` (nome estável para download via API).
 */

import path from "path";

export function parseCompetenciaYm(label: string | undefined | null): number {
  if (!label?.trim()) return 0;
  const t = label.trim();
  const m = /^(\d{1,2})\s*\/\s*(\d{4})$/.exec(t);
  if (m) {
    return parseInt(m[2], 10) * 100 + parseInt(m[1], 10);
  }
  const iso = t.match(/(\d{4})-(\d{2})/);
  if (iso) {
    return parseInt(iso[1], 10) * 100 + parseInt(iso[2], 10);
  }
  return 0;
}

export function sanitizeSeensFilePart(name: string): string {
  const s = name.replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_").replace(/\s+/g, "_");
  return (s.length ? s : "condominio").slice(0, 80);
}

/** Relativo ao cwd, com barras `/`. */
export function buildSeensOutputRelativePath(
  condominio: string,
  competenceLabel: string | null | undefined,
  periodoInicio: string | null | undefined
): string {
  let ym = parseCompetenciaYm(competenceLabel ?? "");
  if (ym === 0 && periodoInicio) ym = parseCompetenciaYm(periodoInicio);
  const ymPart = ym > 0 ? String(ym) : "000000";
  const base = `${sanitizeSeensFilePart(condominio || "condominio")}_${ymPart}_seens.xlsx`;
  return path.posix.join("outputs", base);
}

export function isPathUnderOutputs(projectRoot: string, candidateAbs: string): boolean {
  const outputsDir = path.resolve(projectRoot, "outputs");
  const resolved = path.resolve(candidateAbs);
  const rel = path.relative(outputsDir, resolved);
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}
