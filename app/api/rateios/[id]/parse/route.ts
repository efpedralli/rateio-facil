import { NextRequest, NextResponse } from "next/server";
import { getTenantContext } from "@/lib/multitenant";
import path from "path";
import fs from "fs/promises";
import { spawn } from "child_process";

export const runtime = "nodejs";

type ParsedPdf = {
  units?: Array<{
    bloco?: string | number;
    unidade?: string | number;
    lines?: Array<{
      desc?: string;
      value?: number | string;
    }>;
  }>;
};

function runPythonParser(pdfAbsPath: string): Promise<ParsedPdf> {
  return new Promise((resolve, reject) => {
    const py = process.platform === "win32"
      ? path.join(process.cwd(), ".venv", "Scripts", "python.exe")
      : path.join(process.cwd(), ".venv", "bin", "python");

    const script = path.join(process.cwd(), "scripts", "parse_rateio_pdf.py");

    const proc = spawn(py, [script, pdfAbsPath], { stdio: ["ignore", "pipe", "pipe"] });

    let out = "";
    let err = "";

    proc.stdout.on("data", (d) => (out += d.toString("utf-8")));
    proc.stderr.on("data", (d) => (err += d.toString("utf-8")));

    proc.on("close", (code) => {
      if (code !== 0) return reject(new Error(`Python exit ${code}: ${err}`));
      try {
        resolve(JSON.parse(out) as ParsedPdf);
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        reject(new Error(`Falha parse JSON do Python: ${message}\nOutput:\n${out}\nErr:\n${err}`));
      }
    });
  });
}

function norm(s: string) {
  return (s ?? "")
    // OCR/PDF pode devolver U+FFFD (�) no lugar de qualquer letra.
    // Remover o caractere evita enviesar para uma letra fixa.
    .replace(/\uFFFD/g, "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const STOPWORDS = new Set([
  "a",
  "as",
  "o",
  "os",
  "de",
  "da",
  "das",
  "do",
  "dos",
  "e",
  "em",
  "no",
  "na",
  "nos",
  "nas",
  "para",
  "por",
  "com",
]);

function uniqueNormalized(values: string[]) {
  return Array.from(
    new Set(
      values
        .map((v) => norm(v))
        .filter(Boolean)
    )
  );
}

function tokensFromNormalized(s: string) {
  return s
    .split(" ")
    .filter((t) => t.length >= 2 && !/^\d+$/.test(t) && !STOPWORDS.has(t));
}

function isOneEditAway(a: string, b: string) {
  if (a === b) return true;
  if (Math.abs(a.length - b.length) > 1) return false;

  let i = 0;
  let j = 0;
  let edits = 0;

  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      i++;
      j++;
      continue;
    }

    edits++;
    if (edits > 1) return false;

    if (a.length > b.length) {
      i++;
    } else if (b.length > a.length) {
      j++;
    } else {
      i++;
      j++;
    }
  }

  if (i < a.length || j < b.length) edits++;
  return edits <= 1;
}

function isTokenClose(expected: string, actual: string) {
  if (expected === actual) return true;

  // Para tokens maiores, aceita variação por OCR parcial.
  if (expected.length >= 4 && actual.length >= 4) {
    if (expected.includes(actual) || actual.includes(expected)) return true;
  }

  return isOneEditAway(expected, actual);
}

function allTokensMatch(
  requiredTokens: string[],
  lineTokens: string[]
) {
  if (!requiredTokens.length) return false;
  return requiredTokens.every((req) =>
    lineTokens.some((tok) => isTokenClose(req, tok))
  );
}

function buildDescCandidates(desc: string) {
  const base = norm(desc);
  if (!base) return [] as string[];

  const stripped = base
    .replace(/\bem\s+\d{1,2}\s+\d{1,2}\s+\d{2,4}\b/g, " ")
    .replace(/\bm\s*3\b/g, " ")
    .replace(/\b\d+\b/g, " ")
    .replace(/\b(jan|fev|mar|abr|mai|jun|jul|ago|set|out|nov|dez)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  const candidates = [base, stripped];
  if (base.includes("consumo de agua")) {
    candidates.unshift("consumo de agua");
  }

  return Array.from(new Set(candidates.filter(Boolean)));
}

type ItemMatchRow = {
  item: number;
  descricao: string;
  opcoes: string[];
};

function buildMatcherRows(itens: ItemMatchRow[]) {
  return itens
    .map((it) => {
      const descricaoNorm = norm(it.descricao);
      const opcoesNorm = uniqueNormalized(it.opcoes ?? []);

      const terms = uniqueNormalized([it.descricao, ...(it.opcoes ?? [])])
        .filter((t) => t.length >= 4)
        .sort((a, b) => b.length - a.length);

      return {
        ...it,
        descricaoNorm,
        opcoesNorm,
        terms,
      };
    })
    .sort((a, b) => {
      const aMax = a.terms[0]?.length ?? 0;
      const bMax = b.terms[0]?.length ?? 0;
      return bMax - aMax;
    });
}

function matchItem(
  itens: ReturnType<typeof buildMatcherRows>,
  desc: string
): number | null {
  const candidates = buildDescCandidates(desc);
  for (const d of candidates) {
    const dTokens = tokensFromNormalized(d);

    // 1) match exato em descrição
    for (const it of itens) {
      if (it.descricaoNorm === d) return it.item;
    }

    // 2) match exato em opções
    for (const it of itens) {
      if (it.opcoesNorm.includes(d)) return it.item;
    }

    // 3) match por termo contido na linha do PDF
    for (const it of itens) {
      for (const term of it.terms) {
        if (d.includes(term)) {
          return it.item;
        }
      }
    }

    // 4) match por tokens (robusto para linhas com sufixos OCR)
    for (const it of itens) {
      const descricaoTokens = tokensFromNormalized(it.descricaoNorm);
      if (allTokensMatch(descricaoTokens, dTokens)) {
        return it.item;
      }

      for (const opt of it.opcoesNorm) {
        const optionTokens = tokensFromNormalized(opt);
        if (allTokensMatch(optionTokens, dTokens)) {
          return it.item;
        }
      }
    }
  }

  return null;
}

export async function POST(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;

  const { prisma } = await getTenantContext();
  const rateio = await prisma.rateios.findUnique({
    where: { id },
    include: {
      rateioArquivos: true,
    },
  });
  if (!rateio) return NextResponse.json({ ok: false, error: "Rateio não encontrado" }, { status: 404 });

  const arquivo = rateio.rateioArquivos?.[0];
  if (!arquivo) return NextResponse.json({ ok: false, error: "Rateio sem arquivo" }, { status: 400 });

  const pdfAbsPath = path.join(process.cwd(), arquivo.path);
  await fs.stat(pdfAbsPath);

  // itens do condomínio (dicionário)
  const itensDb = await prisma.itensRateio.findMany({
    where: { condominioId: rateio.condominioId },
    orderBy: { item: "asc" },
  });
  
  if (!itensDb.length) {
    return NextResponse.json(
      { ok: false, error: "Sem ItensRateio para o condomínio." },
      { status: 400 }
    );
  }
  
  const itens = buildMatcherRows(
    itensDb.map((it) => ({
      item: it.item,
      descricao: it.descricao,
      opcoes: it.opcoes ?? [],
    }))
  );
  if (!itens.length) {
    return NextResponse.json({ ok: false, error: "Sem ItensRateio para o condomínio." }, { status: 400 });
  }

  // 1) roda parser python
  const parsed = await runPythonParser(pdfAbsPath);

  // 2) carrega unidades do condomínio
  const unidadesDb = await prisma.unidade.findMany({
    where: { condominioId: rateio.condominioId },
  });

  const findUnidade = (bloco: string, unidade: string) => {
    const b = bloco.replace(/^0+/, "") || "0";
    return unidadesDb.find(u =>
      (u.bloco?.replace(/^0+/, "") || "") === b && (u.unidade || "") === unidade
    );
  };

  // 3) reprocessamento: limpa registros anteriores
  await prisma.rateioUnidadeDado.deleteMany({ where: { rateioUnidade: { rateioId: rateio.id } } });
  await prisma.rateioCampo.deleteMany({ where: { rateioId: rateio.id } });
  await prisma.rateioUnidade.deleteMany({ where: { rateioId: rateio.id } });

  // 4) descobrir quais itens apareceram (para montar RateioCampo em ordem)
  //    MVP: “primeira vez que um item aparece” define ordem
  const itemToOrdem = new Map<number, number>();
  const ordemToItem: number[] = [];
  const itemToDescricao = new Map<number, string>(
    itensDb.map((it) => [it.item, it.descricao])
  );
  const matchedSamplesByItem = new Map<number, string[]>();
  const matchedCountByItem = new Map<number, number>();

  const registerMatchedText = (item: number, rawText: string) => {
    const nextCount = (matchedCountByItem.get(item) ?? 0) + 1;
    matchedCountByItem.set(item, nextCount);

    const sample = rawText?.trim();
    if (!sample) return;

    const samples = matchedSamplesByItem.get(item) ?? [];
    if (!samples.includes(sample) && samples.length < 10) {
      samples.push(sample);
      matchedSamplesByItem.set(item, samples);
    }
  };

  const DEFAULT_ITEM = 77; // Taxa de Condomínio

  itemToOrdem.set(DEFAULT_ITEM, 1);
  ordemToItem.push(DEFAULT_ITEM);

  

  // pré-scan
  for (const u of parsed.units ?? []) {
    for (const ln of u.lines ?? []) {
      if (!ln?.desc) continue;
  
      const item = matchItem(itens, ln.desc);
      if (item == null) continue;
      registerMatchedText(item, ln.desc);
  
      if (!itemToOrdem.has(item)) {
        const ordem = ordemToItem.length + 1; // agora já começa em 2
        itemToOrdem.set(item, ordem);
        ordemToItem.push(item);
      }
    }
  }

  // cria RateioCampo
  for (let i = 0; i < ordemToItem.length; i++) {
    const item = ordemToItem[i];
    await prisma.rateioCampo.create({
      data: {
        rateioId: rateio.id,
        ordem: i + 1,
        item,
        antecipa: null,
        repassa: null,
        parcela: null,
        parcelas: null,
      },
    });
  }

  // 5) cria RateioUnidade + dados por ordem
  let matchedUnits = 0;
  let unmatchedUnits = 0;
  const unmatchedLines: Array<{ desc: string; value: number }> = [];

  for (const u of parsed.units ?? []) {
    const bloco = String(u.bloco ?? "");
    const unidade = String(u.unidade ?? "");
    const unidadeDb = findUnidade(bloco, unidade);

    if (!unidadeDb) {
      unmatchedUnits++;
      continue; // depois a gente cria “fila de pendência” pra mapear alias
    }

    matchedUnits++;

    const ru = await prisma.rateioUnidade.create({
      data: {
        rateioId: rateio.id,
        unidadeId: unidadeDb.id,
        value: 0, // vamos calcular já já
      },
    });

    // acumula por ordem
    const valores = new Map<number, number>();
    for (const ln of u.lines ?? []) {
      if (!ln?.desc || ln.value == null) continue;
      const item = matchItem(itens, ln.desc);
      if (item == null) {
        const valueNum = Number(ln.value);
        unmatchedLines.push({ desc: ln.desc, value: valueNum });
      
        // registra pendência agregada por normDesc
        const dNorm = norm(ln.desc);
      
        await prisma.rateioPendencia.upsert({
          where: {
            rateioId_unidadeId_normDesc: {
              rateioId: rateio.id,
              unidadeId: unidadeDb.id,
              normDesc: dNorm,
            },
          },
          update: {
            // garante vínculo mesmo se já existia pendência antiga
            unidadeId: unidadeDb.id,
            scope: "UNIT",
            occurrences: { increment: 1 },
            exampleValue: valueNum,
          },
          create: {
            rateioId: rateio.id,
            condominioId: rateio.condominioId,
            unidadeId: unidadeDb.id,
            scope: "UNIT",
            rawDesc: ln.desc,
            normDesc: dNorm,
            exampleValue: valueNum,
            suggestedItem: DEFAULT_ITEM,
          },
        });
      
        // ✅ fallback: joga esse valor para Taxa de Condomínio pra manter total correto
        const ordemFallback = itemToOrdem.get(DEFAULT_ITEM);
        if (ordemFallback) {
          const prev = valores.get(ordemFallback) ?? 0;
          valores.set(ordemFallback, prev + valueNum);
        }
      
        continue;
      }

      const ordem = itemToOrdem.get(item);
      if (!ordem) continue;

      const prev = valores.get(ordem) ?? 0;
      valores.set(ordem, prev + Number(ln.value));
    }

    let total = 0;
    const dados = Array.from(valores.entries()).map(([ordem, valor]) => {
      total += valor;
      return {
        rateioUnidadeId: ru.id,
        ordem,
        valor,
        parcela: null,
        parcelas: null,
      };
    });

    if (dados.length) {
      await prisma.rateioUnidadeDado.createMany({ data: dados });
    }

    await prisma.rateioUnidade.update({
      where: { id: ru.id },
      data: { value: total },
    });
  }

  await prisma.rateios.update({
    where: { id: rateio.id },
    data: { status: "PARSED" },
  });

  // total calculado (somando o que foi gravado)
const agg = await prisma.rateioUnidade.aggregate({
  where: { rateioId: rateio.id },
  _sum: { value: true },
  _count: { _all: true },
});

const totalParsed = Number(agg._sum.value ?? 0);
const unitsCount = agg._count._all;

  return NextResponse.json({
    ok: true,
    rateioId: rateio.id,
    status: "PARSED",
    total:{
      parsed: totalParsed,
      unitsCount
    },
    campos: ordemToItem.map((item, idx) => ({
      ordem: idx + 1,
      item,
      descricao: itemToDescricao.get(item) ?? "",
      textoRecebidoSample: matchedSamplesByItem.get(item) ?? [],
      totalMatches: matchedCountByItem.get(item) ?? 0,
    })),
    matchedUnits,
    unmatchedUnits,
    unmatchedLinesSample: unmatchedLines.slice(0, 50),
    matchedLinesSample: ordemToItem
      .flatMap((item) =>
        (matchedSamplesByItem.get(item) ?? []).map((textoRecebido) => ({
          item,
          descricao: itemToDescricao.get(item) ?? "",
          textoRecebido,
        }))
      )
      .slice(0, 50),
    note: unmatchedUnits
      ? "Algumas unidades do PDF não casaram com a base (bloco/unidade). Próximo passo: aliases."
      : "Parse OK.",
  });
}