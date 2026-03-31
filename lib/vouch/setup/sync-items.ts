import { chromium, Page } from "playwright";
import { prisma } from "@/lib/prisma";

function normalizeText(value: string) {
  return (value ?? "").replace(/\s+/g, " ").trim();
}

async function doLogin(page: Page) {
  const url = process.env.VOUCH_URL;
  const user = process.env.VOUCH_USER;
  const password = process.env.VOUCH_PASSWORD;

  if (!url || !user || !password) {
    throw new Error("VOUCH_URL, VOUCH_USER e VOUCH_PASSWORD são obrigatórios no .env");
  }

  await page.goto(url, { waitUntil: "domcontentloaded" });

  await page.getByRole("textbox", {
    name: /Usuário \/ Credencial \/ CPF/i,
  }).fill(user);

  await page.getByRole("textbox", {
    name: /a 12 caracteres/i,
  }).fill(password);

  await page.getByRole("button", { name: /Login/i }).click();
}

async function selectCondominio(page: Page, condominioNome: string) {
    const search = page.getByRole("textbox", { name: /Pesquisar/i });
    
    await search.click();
    //await search.fill(condominioNome);
    await search.fill("teste");
    await search.press("Enter");
    
    // espera a lista aparecer
    await page
    .locator('#sysListaCond')
    .locator("a", { hasText: "teste" }).first().click();
    
    
}


async function openRateioWizard(page: Page) {
    await page
    .locator('i[title="Cobrança"]')
    .locator('xpath=..')
    .click();

    await page.locator("a", { hasText: "Emissão", hasNotText: "de Boletos" }).hover()

    await page.locator("a", { hasText: "Rateio"}).click()
    
    await page.getByTitle(/Iniciar Cadastro de Arrecada/i).click();
    await page.getByRole("button", { name: /Wizard/i }).click();
}

async function openTiposCobrancaDropdown(page: Page) {
  const tipoCobGroup = page.locator(".form-group").filter({
    has: page.locator("label", { hasText: /Tipos de Cobrança/i }),
  }).first();

  await tipoCobGroup.waitFor({ state: "visible" });

  const button = tipoCobGroup.locator('button[data-id="fieldTipoCob"]').first();
  await button.waitFor({ state: "visible" });
  await button.click();

  const openMenu = tipoCobGroup.locator("div.dropdown-menu.open").first();
  await openMenu.waitFor({ state: "visible" });

  return openMenu;
}

type SyncItensInput = {
  condominioId: string;
};

export async function syncItensFromVouch(input: SyncItensInput) {
  const condominio = await prisma.condominio.findUnique({
    where: { id: input.condominioId },
  });

  if (!condominio) {
    throw new Error("Condomínio não encontrado.");
  }

  const browser = await chromium.launch({ headless: false });
  const page = await browser.newPage();

  try {
    await doLogin(page);
    await selectCondominio(page, condominio.nome);
    await openRateioWizard(page);

    const openMenu = await openTiposCobrancaDropdown(page);

    const items = await openMenu.locator("ul.dropdown-menu.inner > li").evaluateAll((lis) => {
      return lis
        .map((li) => {
          const externalId = li.getAttribute("data-original-index");
          const textNode = li.querySelector("span.text");
          const descricao = textNode?.textContent?.replace(/\s+/g, " ").trim() ?? "";

          if (!descricao || descricao === "-- Selecione --") {
            return null;
          }

          return {
            externalId,
            descricao,
          };
        })
        .filter(Boolean);
    });

    let created = 0;
    let updated = 0;

    for (const [index, rawItem] of items.entries()) {
      if (!rawItem) continue;

      const descricao = normalizeText(rawItem.descricao);
      const itemNumber = Number(rawItem.externalId ?? index + 1);

      const existing = await prisma.itensRateio.findFirst({
        where: {
          condominioId: condominio.id,
          item: itemNumber,
        },
      });

      if (existing) {
        await prisma.itensRateio.update({
          where: { id: existing.id },
          data: {
            descricao,
          },
        });
        updated++;
      } else {
        await prisma.itensRateio.create({
          data: {
            condominioId: condominio.id,
            item: itemNumber,
            descricao,
            opcoes: [],
          },
        });
        created++;
      }
    }

    return {
      success: true,
      condominio: {
        id: condominio.id,
        nome: condominio.nome,
        externalId: condominio.externalId,
      },
      totalEncontrado: items.length,
      created,
      updated,
    };
  } finally {
    await browser.close();
  }
}