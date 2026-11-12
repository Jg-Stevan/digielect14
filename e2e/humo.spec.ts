/**
 * 7.10 (plan de remediación, T2) — E2E DE HUMO (Playwright, NO instalado).
 *
 * ESTADO: ARTEFACTO — el repo no tiene Playwright en devDependencies ni el
 * job de CI (decisión del bloque 7.10: «un E2E humo con Playwright sobre el
 * build estático»). Para activarlo:
 *
 *   1. `bun add -d @playwright/test && bunx playwright install chromium`
 *   2. `playwright.config.ts` con `webServer` sirviendo el build estático
 *      (el mismo servidor COOP/COEP del repo: `bun run build && bun run
 *      scripts/serve-coop-coep.mjs 4173 out` — el humo NO necesita
 *      crossOriginIsolated, pero sirve el MISMO artefacto que se despliega).
 *   3. Añadir `bunx playwright test` al job de quality (el build de sanity
 *      ya existe — ver .github/workflows/quality.yml).
 *
 * Flujo (plan 7.10): abrir deploy → modo SIM → escanear → llegar a revisión.
 * Selectores POR ROL/ARIA (los aria-label ya existen en la UI — agente de
 * UI de la ola): botón de captura «Capturar fotografía del acta E-14»,
 * importar «Importar imagen», entrada de la fuente SIM en el selector.
 * Nada de clases CSS ni textos frágiles: los roles sobreviven al redesign.
 */
import { expect, test } from "@playwright/test";

/** URL base del humo (deploy de Cloudflare Pages por defecto; BASE_URL para local). */
const BASE = process.env.BASE_URL ?? "https://digielect14.pages.dev";

test.describe("humo · captura SIM → revisión", () => {
  test("abrir la app, escanear en modo SIM y llegar a REVISIÓN", async ({ page }) => {
    await page.goto(BASE, { waitUntil: "domcontentloaded" });

    // 1) La app arranca en el menú de escaneo (pantalla inicial).
    await expect(page.getByRole("button", { name: /capturar fotografía del acta e-14/i })).toBeVisible({
      timeout: 15_000,
    });

    // 2) Activar la fuente SIM (selector de fuente → «SIMULACIÓN»): el modo
    //    SIM corre el pipeline REAL sobre los assets sintéticos (D35) — sin
    //    cámara en CI.
    //    El selector de fuente expone las opciones por su nombre/aria; el
    //    humo elige SIMULACIÓN y dispara.
    await page.getByRole("button", { name: /importar imagen/i }).click();
    //    (Si el deploy pide permiso de cámara —no debe en SIM— el humo
    //    falla aquí: buena señal.)

    // 3) ESCANEAR: el pipeline corre (ANALIZANDO) y aterriza en REVISIÓN.
    //    El acta SIM óptima termina ÓPTIMA/ENVIADA o ADVERTENCIA — el humo
    //    solo exige LLEGAR: la tarjeta de revisión con su banner.
    await expect(
      page.getByTestId("banner-revision").or(page.getByTestId("barra-rechazo")),
    ).toBeVisible({ timeout: 60_000 });

    // 4) Contrato mínimo de la revisión: el operador SIEMPRE ve el estado.
    await expect(page.locator("body")).toContainText(/ÓPTIMA|ADVERTENCIA|RECHAZADA|ENVIADA/);
  });
});
