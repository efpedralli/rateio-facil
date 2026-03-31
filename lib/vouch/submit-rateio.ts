import type { VouchRateioPayload } from "./types";
import { chromium } from "playwright";
import type { Page } from "playwright";

function normalizeText(value: string) {
    return (value ?? "").trim();
}

function normalizeHeaderText(value: string) {
    return (value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

async function getExistingPlanilhaHeaders(page: Page): Promise<string[]> {
    return await page.evaluate(() => {
        const table = document.querySelector("#planilhaArrecadacoes");
        if (!table) return [];
        
        const headers = Array.from(
            table.querySelectorAll("thead th[data-dt-column] .dt-column-title")
        );
        
        return headers
        .map((el) => el.textContent?.trim() || "")
        .filter(Boolean);
    });
}

function getCamposPendentes(
    payloadCampos: VouchRateioPayload["campos"],
    existingHeaders: string[]
) {
    const existingNormalized = new Set(
        existingHeaders.map((item) => normalizeHeaderText(item))
    );
    
    return payloadCampos.filter((campo) => {
        const nomeCampo = normalizeHeaderText(campo.descricao);
        return !existingNormalized.has(nomeCampo);
    });
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

async function openRateioTela(
    page: Page
): Promise<{ modo: "wizard" | "edicao"; planilhaJaExiste: boolean }> {
    await page
    .locator('i[title="Cobrança"]')
    .locator("xpath=..")
    .click();
    
    await page.locator("a", { hasText: "Emissão", hasNotText: "de Boletos" }).hover();
    await page.locator("a", { hasText: "Rateio" }).click();
    
    const btnEditar = page.locator(
        'button[onclick*="assistenteCadastro"][title*="Editar Arrecada"]'
    );
    
    const btnIniciar = page.getByTitle(/Iniciar Cadastro de Arrecada/i);
    const btnWizard = page.getByRole("button", { name: /Wizard/i });
    const planilha = page.locator("#planilhaArrecadacoes");
    
    await Promise.race([
        btnEditar.waitFor({ state: "visible", timeout: 15000 }).catch(() => null),
        btnIniciar.waitFor({ state: "visible", timeout: 15000 }).catch(() => null),
        planilha.waitFor({ state: "visible", timeout: 15000 }).catch(() => null),
    ]);
    
    if (await btnEditar.isVisible().catch(() => false)) {
        await btnEditar.click();
        
        await Promise.race([
            planilha.waitFor({ state: "visible", timeout: 10000 }).catch(() => null),
            page.locator(".modalGeral.show, .modal.show").waitFor({ state: "visible", timeout: 10000 }).catch(() => null),
        ]);
        
        const planilhaJaExiste = await planilha.isVisible().catch(() => false);
        
        return {
            modo: "edicao",
            planilhaJaExiste,
        };
    }
    
    if (await btnIniciar.isVisible().catch(() => false)) {
        await btnIniciar.click();
        
        await btnWizard.waitFor({ state: "visible", timeout: 10000 });
        await btnWizard.click();
        
        return {
            modo: "wizard",
            planilhaJaExiste: false,
        };
    }
    
    if (await planilha.isVisible().catch(() => false)) {
        return {
            modo: "edicao",
            planilhaJaExiste: true,
        };
    }
    
    throw new Error("Não foi possível identificar se a tela está em modo Wizard ou Edição.");
}



function escapeRegExp(value: string) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function selectItemNoWizard(page: Page, itemDescricao: string) {
    const tipoCobGroup = page.locator(".form-group", {
        has: page.locator("label", { hasText: /Tipos de Cobrança/i }),
    });
    
    await tipoCobGroup.waitFor({ state: "visible" });
    
    const button = tipoCobGroup.locator('button[data-id="fieldTipoCob"]');
    await button.waitFor({ state: "visible" });
    await button.click();
    
    const openMenu = tipoCobGroup.locator("div.dropdown-menu.open");
    await openMenu.waitFor({ state: "visible" });
    
    const searchBox = openMenu.locator('input.form-control[role="textbox"]');
    if (await searchBox.count()) {
        await searchBox.fill(itemDescricao);
    }
    
    const option = openMenu.locator("ul.dropdown-menu.inner span.text").filter({
        hasText: new RegExp(`^${escapeRegExp(itemDescricao)}$`, "i"),
    }).first();
    
    await option.waitFor({ state: "visible" });
    await option.click();
}

async function insertCampo(page: Page, campo: VouchRateioPayload["campos"][number]) {
    await selectItemNoWizard(page, campo.descricao);
    
    // complemento - só se você descobrir que precisa preencher
    // await page.locator('#fieldComplementoTipo').fill('...');
    
    if (campo.parcela != null) {
        await page.getByRole("textbox", { name: /^Parcelas$/i }).fill(String(campo.parcela));
    }
    
    if (campo.parcelas != null) {
        await page.getByRole("textbox", { name: /^de$/i }).fill(String(campo.parcelas));
    }
    
    await page.getByRole("button", { name: /Inserir/i }).click();
}

async function waitPlanilhaReady(page: Page) {
    await page.waitForFunction(() => {
        const table = document.querySelector("#planilhaArrecadacoes");
        if (!table) return false;

        const rows = table.querySelectorAll("tbody tr");
        if (rows.length < 20) return false;

        const firstRow = rows[0];
        const cells = firstRow?.querySelectorAll("td");
        return !!cells && cells.length > 5;
    }, { timeout: 30000 });

    await page.waitForTimeout(1500);
}

async function getPlanilhaColumnMap(page: Page) {
    return await page.evaluate(() => {
        const normalize = (value: string) =>
            (value ?? "")
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/\s+/g, " ")
        .trim()
        .toLowerCase();
        
        const map: Record<string, number> = {};
        
        const table = document.querySelector("#planilhaArrecadacoes");
        if (!table) return map;
        
        const headers = table.querySelectorAll("thead th[data-dt-column]");
        
        headers.forEach((th) => {
            const dtColumn = th.getAttribute("data-dt-column");
            if (!dtColumn) return;
            
            const title =
            th.querySelector(".dt-column-title")?.textContent?.trim() ||
            th.textContent?.trim() ||
            "";
            
            if (!title) return;
            
            map[normalize(title)] = Number(dtColumn);
        });
        
        return map;
    });
}

async function findRowIdByBlocoUnidade(
    page: Page,
    bloco: string,
    unidade: string
) {
    return await page.evaluate(
        ({ bloco, unidade }) => {
            const onlyDigits = (value: string) => String(value ?? "").replace(/\D+/g, "");
            
            const alvoBloco = onlyDigits(bloco);
            const alvoUnidade = onlyDigits(unidade);
            
            const rows = Array.from(
                document.querySelectorAll("#planilhaArrecadacoes tbody tr")
            );
            
            for (const row of rows) {
                const cells = row.querySelectorAll("td");
                if (cells.length < 2) continue;
                
                const blocoText = onlyDigits(cells[0]?.textContent ?? "");
                const unidadeText = onlyDigits(cells[1]?.textContent ?? "");
                
                if (blocoText === alvoBloco && unidadeText === alvoUnidade) {
                    return (row as HTMLTableRowElement).id || null;
                }
            }
            
            return null;
        },
        { bloco, unidade }
    );
}

async function debugPrimeirasLinhasPlanilha(page: Page) {
    const rows = await page.evaluate(() => {
        return Array.from(
            document.querySelectorAll("#planilhaArrecadacoes tbody tr")
        )
        .slice(0, 15)
        .map((row) => {
            const cells = row.querySelectorAll("td");
            return {
                rowId: (row as HTMLTableRowElement).id || "",
                bloco: cells[0]?.textContent?.trim() ?? "",
                unidade: cells[1]?.textContent?.trim() ?? "",
                total: cells[2]?.textContent?.trim() ?? "",
            };
        });
    });
    
    console.log("[DEBUG PRIMEIRAS LINHAS]", rows);
}

function getCellLocator(page: Page, rowId: string, columnIndex: number) {
    return page
    .locator(`#planilhaArrecadacoes tbody tr[id="${rowId}"] td`)
    .nth(columnIndex);
}

async function tryActivateCellEditor(page: Page, cell: ReturnType<Page["locator"]>) {
    await cell.scrollIntoViewIfNeeded();
    await cell.click({ clickCount: 2, force: true });
    await page.waitForTimeout(250);

    const focusedMeta = await page.locator(":focus").evaluate((el) => ({
        tag: el.tagName,
        type: (el as HTMLInputElement).type ?? null,
        isContentEditable: (el as HTMLElement).isContentEditable ?? false,
        outerHTML: (el as HTMLElement).outerHTML.slice(0, 300),
    })).catch(() => null);

    return focusedMeta;
}

async function setCellValue(
    page: Page,
    rowId: string,
    columnIndex: number,
    value: string
) {
    const cell = getCellLocator(page, rowId, columnIndex);

    const beforeText = (await cell.textContent())?.trim() ?? "";
    console.log(`[CELL BEFORE] row=${rowId} col=${columnIndex} text="${beforeText}" target="${value}"`);

    let focusedMeta = await tryActivateCellEditor(page, cell);
    console.log("[FOCUSED META 1]", focusedMeta);

    const isEditable =
        focusedMeta &&
        (
            focusedMeta.tag === "INPUT" ||
            focusedMeta.tag === "TEXTAREA" ||
            focusedMeta.isContentEditable
        ) &&
        !["checkbox", "radio", "button", "submit"].includes(String(focusedMeta.type || "").toLowerCase());

    if (!isEditable) {
        console.warn(`[RETRY EDITOR] row=${rowId} col=${columnIndex}`);

        await page.keyboard.press("Escape").catch(() => null);
        await page.waitForTimeout(150);

        focusedMeta = await tryActivateCellEditor(page, cell);
        console.log("[FOCUSED META 2]", focusedMeta);
    }

    const isEditableAfterRetry =
        focusedMeta &&
        (
            focusedMeta.tag === "INPUT" ||
            focusedMeta.tag === "TEXTAREA" ||
            focusedMeta.isContentEditable
        ) &&
        !["checkbox", "radio", "button", "submit"].includes(String(focusedMeta.type || "").toLowerCase());

    if (!isEditableAfterRetry) {
        console.warn(
            `Editor não abriu para row=${rowId} col=${columnIndex}. Pulando célula.`
        );
        return;
    }

    const focused = page.locator(":focus");

    if (focusedMeta!.tag === "INPUT" || focusedMeta!.tag === "TEXTAREA") {
        await focused.press("Control+A").catch(() => null);
        await page.keyboard.press("Backspace").catch(() => null);
        await focused.type(value, { delay: 20 });
        await focused.press("Enter").catch(() => null);
    } else {
        await page.keyboard.press("Control+A").catch(() => null);
        await page.keyboard.press("Backspace").catch(() => null);
        await page.keyboard.type(value, { delay: 20 });
        await page.keyboard.press("Enter").catch(() => null);
    }

    await page.locator("body").click({ position: { x: 5, y: 5 } }).catch(() => null);
    await page.waitForTimeout(350);

    const afterText = (await cell.textContent())?.trim() ?? "";
    console.log(`[CELL AFTER] row=${rowId} col=${columnIndex} text="${afterText}"`);
}

function isDecimalMeasurementColumn(descricao: string) {
    const normalized = normalizeHeaderText(descricao);
    
    return [
        "consumo de agua (m³)",
        "consumo de agua (leit. ant.)",
        "consumo de agua (leit. atu.)",
    ].includes(normalized);
}

function formatDecimalValue(value: number, decimals = 5) {
    return value.toFixed(decimals).replace(".", ",");
}

function formatCurrencyValue(value: number) {
    return value.toFixed(2).replace(".", ",");
}

function formatValueByColumn(descricao: string, value: number) {
    if (isDecimalMeasurementColumn(descricao)) {
        return formatDecimalValue(value, 5);
    }
    
    return formatCurrencyValue(value);
}

async function fillPlanilhaValores(
    page: Page,
    payload: VouchRateioPayload,
    columnMap: Record<string, number>
) {
    console.log("Preenchendo planilha de valores...");
    for (const unidade of payload.unidades) {
        const bloco = String(unidade.bloco ?? "").trim();
        const numeroUnidade = String(unidade.unidade ?? "").trim();
        
        const rowId = await findRowIdByBlocoUnidade(page, bloco, numeroUnidade);
        
        if (!rowId) {
            console.warn(`Linha não encontrada para bloco ${bloco} unidade ${numeroUnidade}`);
            continue;
        }
        
        console.log(`Linha encontrada: bloco ${bloco}, unidade ${numeroUnidade}, rowId=${rowId}`);
        
        for (const composicao of unidade.composicao) {
            const descricaoNormalizada = normalizeHeaderText(composicao.descricao);
            const columnIndex = columnMap[descricaoNormalizada];
            
            if (columnIndex == null) {
                console.warn(`Coluna não encontrada: ${composicao.descricao}`);
                continue;
            }
            
            const numericValue = Number(composicao.valor ?? 0);
            const formattedValue = formatValueByColumn(composicao.descricao, numericValue);
            
            console.log(
                `Preenchendo bloco=${bloco} unidade=${numeroUnidade} coluna="${composicao.descricao}" índice=${columnIndex} valor=${formattedValue}`
            );
            
            await setCellValue(page, rowId, columnIndex, formattedValue);
        }
    }
}

export async function launchRateioVouch(payload: VouchRateioPayload) {
    const browser = await chromium.launch({
        headless: false,
    });
    
    const page = await browser.newPage();
    
    try {
        await doLogin(page);
        await selectCondominio(page, normalizeText(payload.condominioNome));
        
        const abertura = await openRateioTela(page);
        
        let camposPendentes = payload.campos;
        
        if (abertura.planilhaJaExiste || abertura.modo === "edicao") {
            await waitPlanilhaReady(page);
            await debugPrimeirasLinhasPlanilha(page);
            
            const existingHeaders = await getExistingPlanilhaHeaders(page);
            console.log("Colunas existentes:", existingHeaders);
            
            camposPendentes = getCamposPendentes(payload.campos, existingHeaders);
            console.log(
                "Campos pendentes para inserir:",
                camposPendentes.map((c) => c.descricao)
            );
        }
        
        // Só tenta inserir novos campos se estiver no modo wizard
        if (abertura.modo === "wizard" && camposPendentes.length > 0) {
            for (const campo of camposPendentes) {
                await insertCampo(page, campo);
            }
            
            await page.getByRole("button", { name: /Salvar/i }).click();
            await waitPlanilhaReady(page);
        }
        
        if (abertura.modo === "edicao" && camposPendentes.length > 0) {
            console.warn(
                "Existem campos pendentes, mas a tela está em modo edição. " +
                "Será necessário descobrir como adicionar novas colunas nesse modo."
            );
        }
        
        const columnMap = await getPlanilhaColumnMap(page);
        console.log("Mapa de colunas:", columnMap);
        
        await fillPlanilhaValores(page, payload, columnMap);
        
        return {
            success: true,
            message: `Rateio processado com sucesso. Campos pendentes inseridos: ${camposPendentes.length}`,
        };
    } catch (error) {
        const message = error instanceof Error ? error.message : "Erro desconhecido";
        return {
            success: false,
            message,
        };
    } finally {
        // await browser.close();
    }
}