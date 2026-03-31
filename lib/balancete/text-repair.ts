/**
 * Reparo de texto após extração PDF (complementa o reparo no Python).
 */

export function repairMojibakeText(s: string): string {
  if (!s) return s;
  let t = s.replace(/\uFFFD/g, "");
  const repl: Array<[RegExp, string]> = [
    [/COND\?MINOS/gi, "CONDÔMINOS"],
    [/CONDOM\?NIO/gi, "CONDOMÍNIO"],
    [/\?GUA/gi, "ÁGUA"],
    [/ORDIN\?RIAS/gi, "ORDINÁRIAS"],
    [/MANUTEN\?\?O/gi, "MANUTENÇÃO"],
    [/ARRECADA\?\?O/gi, "ARRECADAÇÃO"],
    [/POUPAN\?A/gi, "POUPANÇA"],
    [/TAXA DE UTILIZA\?\?O/gi, "TAXA DE UTILIZAÇÃO"],
    [/SAL\?O/gi, "SALÃO"],
    [/\bM\?S\b/gi, "MÊS"],
    [/COMPET\?NCIA/gi, "COMPETÊNCIA"],
    [/MANUTEN\?O/gi, "MANUTENÇÃO"],
  ];
  for (const [re, v] of repl) {
    t = t.replace(re, v);
  }
  return t.replace(/\s+/g, " ").trim();
}
