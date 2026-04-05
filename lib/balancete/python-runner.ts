/**
 * Execução dos scripts Python do balancete (mesmo padrão de `app/api/rateios/[id]/parse/route.ts`).
 */

import path from "path";
import { spawn } from "child_process";

function resolvePythonBinary(): string {
  return process.platform === "win32"
    ? path.join(process.cwd(), ".venv", "Scripts", "python.exe")
    : path.join(process.cwd(), ".venv", "bin", "python");
}

const LOG = "[balancete]";

/** Remove linhas antes do primeiro `{` (logs acidentais no stdout que quebram JSON.parse). */
function parseBalanceteJsonStdout(out: string): unknown {
  const lines = out.split(/\r?\n/);
  let start = 0;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trimStart().startsWith("{")) {
      start = i;
      break;
    }
  }
  const jsonText = lines.slice(start).join("\n").trim();
  return JSON.parse(jsonText) as unknown;
}

/**
 * Executa `scripts/balancete/parse_balancete_pdf.py` e retorna o JSON do stdout.
 */
export async function runBalanceteParser(pdfAbsPath: string, fileName: string): Promise<unknown> {
  const py = resolvePythonBinary();
  const script = path.join(process.cwd(), "scripts", "balancete", "parse_balancete_pdf.py");

  return new Promise((resolve, reject) => {
    const t0 = Date.now();
    console.log(
      `${LOG} [python] iniciando parser | exe=${py} | pdf=${pdfAbsPath} | arquivo=${fileName}`
    );

    const proc = spawn(py, [script, pdfAbsPath, fileName], {
      stdio: ["ignore", "pipe", "pipe"],
    });

    let out = "";
    let err = "";

    proc.stdout.on("data", (d) => {
      out += d.toString("utf-8");
    });
    proc.stderr.on("data", (d) => {
      err += d.toString("utf-8");
    });

    proc.on("error", (e) => {
      reject(
        new Error(
          `Falha ao iniciar Python. Verifique o venv em .venv e dependências em scripts/balancete/requirements.txt. ${e.message}`
        )
      );
    });

    proc.on("close", (code) => {
      const ms = Date.now() - t0;
      if (code !== 0) {
        console.error(
          `${LOG} [python] falhou em ${ms}ms | exit=${code} | stderr=${err.trim().slice(0, 400)}`
        );
        reject(
          new Error(
            `Parser de balancete encerrou com código ${code}. ${err.trim() || out.slice(0, 500)}`
          )
        );
        return;
      }
      console.log(`${LOG} [python] ok em ${ms}ms | stdout chars=${out.length}`);
      try {
        resolve(parseBalanceteJsonStdout(out));
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        console.error(`${LOG} [python] JSON inválido após ${ms}ms`);
        reject(
          new Error(
            `JSON inválido do parser de balancete: ${message}. Stderr: ${err.slice(0, 800)}`
          )
        );
      }
    });
  });
}

/**
 * Gera `saida.xlsx` a partir de JSON canônico (`canonical_export.json`) via `export_xlsx.py`.
 */
export async function runBalanceteExportXlsx(
  jsonAbsPath: string,
  xlsxAbsPath: string
): Promise<void> {
  const py = resolvePythonBinary();
  const script = path.join(process.cwd(), "scripts", "balancete", "export_xlsx.py");

  return new Promise((resolve, reject) => {
    const t0 = Date.now();
    console.log(
      `${LOG} [python] export xlsx | json=${jsonAbsPath} | out=${xlsxAbsPath}`
    );

    const proc = spawn(py, [script, jsonAbsPath, xlsxAbsPath], {
      stdio: ["ignore", "pipe", "pipe"],
    });

    let err = "";

    proc.stderr.on("data", (d) => {
      const chunk = d.toString("utf-8");
      err += chunk;
      for (const line of chunk.split(/\r?\n/)) {
        const t = line.trim();
        if (t) console.log(`${LOG} [export] ${t}`);
      }
    });

    proc.stdout.on("data", (d) => {
      const s = d.toString("utf-8").trim();
      if (s) console.log(`${LOG} [export] ${s}`);
    });

    proc.on("error", (e) => {
      reject(new Error(`Falha ao iniciar exportador Python: ${e.message}`));
    });

    proc.on("close", (code) => {
      const ms = Date.now() - t0;
      if (code !== 0) {
        console.error(
          `${LOG} [python] export falhou em ${ms}ms | exit=${code} | stderr=${err.trim().slice(0, 400)}`
        );
        reject(
          new Error(
            `Exportador de balancete encerrou com código ${code}. ${err.trim().slice(0, 600)}`
          )
        );
        return;
      }
      console.log(`${LOG} [python] export ok em ${ms}ms`);
      resolve();
    });
  });
}

/**
 * Gera XLSX no layout Seens a partir do mesmo JSON canônico (`export_excel_seens.py`).
 */
export async function runBalanceteExportSeensXlsx(
  jsonAbsPath: string,
  xlsxAbsPath: string
): Promise<void> {
  const py = resolvePythonBinary();
  const script = path.join(process.cwd(), "scripts", "balancete", "export_excel_seens.py");

  return new Promise((resolve, reject) => {
    const t0 = Date.now();
    console.log(
      `${LOG} [python] export seens | json=${jsonAbsPath} | out=${xlsxAbsPath}`
    );

    const proc = spawn(py, [script, jsonAbsPath, xlsxAbsPath], {
      stdio: ["ignore", "pipe", "pipe"],
    });

    let err = "";

    proc.stderr.on("data", (d) => {
      const chunk = d.toString("utf-8");
      err += chunk;
      for (const line of chunk.split(/\r?\n/)) {
        const t = line.trim();
        if (t) console.log(`${LOG} [export-seens] ${t}`);
      }
    });

    proc.stdout.on("data", (d) => {
      const s = d.toString("utf-8").trim();
      if (s) console.log(`${LOG} [export-seens] ${s}`);
    });

    proc.on("error", (e) => {
      reject(new Error(`Falha ao iniciar exportador Seens (Python): ${e.message}`));
    });

    proc.on("close", (code) => {
      const ms = Date.now() - t0;
      if (code !== 0) {
        console.error(
          `${LOG} [python] export seens falhou em ${ms}ms | exit=${code} | stderr=${err.trim().slice(0, 400)}`
        );
        reject(
          new Error(
            `Exportador Seens encerrou com código ${code}. ${err.trim().slice(0, 600)}`
          )
        );
        return;
      }
      console.log(`${LOG} [python] export seens ok em ${ms}ms`);
      resolve();
    });
  });
}

/**
 * Alias: parse PDF → JSON canônico num único script (`parse_balancete_pdf.py` + leitor_balancete).
 */
export const runBalanceteTransformation = runBalanceteParser;
