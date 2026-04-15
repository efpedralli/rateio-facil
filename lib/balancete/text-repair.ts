/**
 * Reparo de texto após extração PDF (complementa o reparo no Python).
 */

function fixBrokenUtf8(value: string): string {
  if (!/[ÃÂâ]/.test(value)) return value;
  try {
    // Heurística comum para textos UTF-8 interpretados como latin1/cp1252.
    return Buffer.from(value, "latin1").toString("utf8");
  } catch {
    return value;
  }
}

export function repairMojibakeText(s: string): string {
  if (!s) return s;
  let t = fixBrokenUtf8(s).replace(/\r/g, "").replace(/\u00a0/g, " ");
  const repl: Array<[RegExp, string]> = [
    [/\bcondom�nio\b/gi, "condomínio"],
    [/\bcond\.\s*res\.\b/gi, "cond. res."],
    [/COND\?MINOS/gi, "CONDÔMINOS"],
    [/CONDOM\?NIO/gi, "CONDOMÍNIO"],
    [/CONDOM�NIO/gi, "CONDOMÍNIO"],
    [/\?GUA/gi, "ÁGUA"],
    [/�GUA/gi, "ÁGUA"],
    [/ORDIN\?RIAS/gi, "ORDINÁRIAS"],
    [/ORDIN�RIAS/gi, "ORDINÁRIAS"],
    [/ORDIN\?RIA/gi, "ORDINÁRIA"],
    [/ORDIN�RIA/gi, "ORDINÁRIA"],
    [/MANUTEN\?\?O/gi, "MANUTENÇÃO"],
    [/MANUTEN��O/gi, "MANUTENÇÃO"],
    [/ARRECADA\?\?O/gi, "ARRECADAÇÃO"],
    [/ARRECADA��O/gi, "ARRECADAÇÃO"],
    [/POUPAN\?A/gi, "POUPANÇA"],
    [/POUPAN�A/gi, "POUPANÇA"],
    [/TAXA DE UTILIZA\?\?O/gi, "TAXA DE UTILIZAÇÃO"],
    [/TAXA DE UTILIZA��O/gi, "TAXA DE UTILIZAÇÃO"],
    [/SAL\?O/gi, "SALÃO"],
    [/SAL�O/gi, "SALÃO"],
    [/\bM\?S\b/gi, "MÊS"],
    [/\bM�S\b/gi, "MÊS"],
    [/COMPET\?NCIA/gi, "COMPETÊNCIA"],
    [/COMPET�NCIA/gi, "COMPETÊNCIA"],
    [/MANUTEN\?O/gi, "MANUTENÇÃO"],
    [/DESPESAS N\?O RATEADAS/gi, "DESPESAS NÃO RATEADAS"],
    [/DESPESAS N�O RATEADAS/gi, "DESPESAS NÃO RATEADAS"],
    [/M\?VEIS E UTENS\?LIOS/gi, "MÓVEIS E UTENSÍLIOS"],
    [/M�VEIS E UTENS�LIOS/gi, "MÓVEIS E UTENSÍLIOS"],
    [/BANC\?RIAS/gi, "BANCÁRIAS"],
    [/BANC�RIAS/gi, "BANCÁRIAS"],
    [/�/g, ""],
  ];
  for (const [re, v] of repl) {
    t = t.replace(re, v);
  }
  return t.replace(/\s+/g, " ").trim();
}
