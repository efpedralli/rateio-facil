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
        resolve(JSON.parse(out) as unknown);
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
 * Alias do contrato solicitado: hoje parse + transformação canônica ocorrem no mesmo script Python
 * (`transform_balancete` + `parse_balancete_pdf`). Se no futuro a transformação for separada,
 * este método pode apontar para outro executável sem mudar o restante do engine.
 */
export const runBalanceteTransformation = runBalanceteParser;
