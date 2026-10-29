/**
 * SIMULACIÓN DISPOSITIVO DE POCOS RECURSOS — DigiE14 (v2)
 * CPU 6x · RAM 2GB declarada · 4 núcleos · 3G.
 * Etapas: carga → escanear → cámara (telemetría __cameraChoice) →
 * pipeline OCR real con acta → memoria final.
 */
const { chromium } = require("playwright");
const fs = require("fs");

const APP = process.env.APP_URL || "http://localhost:3100";
const ACTA = "/home/z/digielect14/src/assets/acta-e14-real.jpg";
const OUT = "/home/z/sim-lowend-resultados.json";

function clickVisible(page, texto, exacto = false) {
  return page.evaluate(
    ([t, ex]) => {
      const re = new RegExp(t);
      const b = [...document.querySelectorAll("button")].filter((x) => {
        if (x.offsetParent === null) return false;
        return ex ? x.innerText.trim() === t : re.test(x.innerText);
      });
      b[b.length - 1]?.click();
      return b.length;
    },
    [texto, exacto],
  );
}

(async () => {
  const resultados = { app: APP, etapas: {} };
  const browser = await chromium.launch({
    headless: true,
    args: [
      "--use-fake-device-for-media-stream",
      "--use-fake-ui-for-media-stream",
      "--disable-dev-shm-usage",
    ],
  });
  const ctx = await browser.newContext({
    viewport: { width: 384, height: 857 },
    deviceScaleFactor: 2.8125,
    isMobile: true,
    hasTouch: true,
    userAgent:
      "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/155.0.0.0 Mobile Safari/537.36",
  });
  await ctx.grantPermissions(["camera"], { origin: APP });
  await ctx.addInitScript(() => {
    Object.defineProperty(navigator, "deviceMemory", { get: () => 2, configurable: true });
    Object.defineProperty(navigator, "hardwareConcurrency", { get: () => 4, configurable: true });
  });

  const page = await ctx.newPage();
  const errores = [];
  page.on("pageerror", (e) => errores.push("pageerror: " + e.message));
  page.on("console", (m) => {
    if (m.type() === "error") errores.push("console: " + m.text().slice(0, 300));
  });
  const cdp = await ctx.newCDPSession(page);
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: 6 });
  await cdp.send("Network.enable", {});
  await cdp.send("Network.emulateNetworkConditions", {
    offline: false,
    latency: 150,
    downloadThroughput: (1.6 * 1024 * 1024) / 8,
    uploadThroughput: (750 * 1024) / 8,
  });

  // ═══ ETAPA 1: CARGA ═══
  const t0 = Date.now();
  await page.goto(APP, { waitUntil: "domcontentloaded", timeout: 120000 });
  const tDcl = Date.now() - t0;
  await page.waitForFunction(
    () =>
      [...document.querySelectorAll("button")].some(
        (x) => x.offsetParent !== null && /ESCANEAR/.test(x.innerText)
      ),
    { timeout: 180000 },
  );
  resultados.etapas.cargaInicial = { domContentLoaded_ms: tDcl, uiVisible_ms: Date.now() - t0 };
  await clickVisible(page, "ENTENDIDO").catch(() => {});
  await page.waitForTimeout(800);
  // cierra la ayuda si quedó abierta (tecla Escape / botón X)
  await page.keyboard.press("Escape").catch(() => {});

  // ═══ ETAPA 2: perfil visto por la app ═══
  resultados.etapas.perfilNavegador = await page.evaluate(() => ({
    deviceMemory: navigator.deviceMemory,
    hardwareConcurrency: navigator.hardwareConcurrency,
    heapLimitMB: performance?.memory?.jsHeapSizeLimit
      ? Math.round(performance.memory.jsHeapSizeLimit / 1048576)
      : null,
    crossOriginIsolated: typeof SharedArrayBuffer !== "undefined",
  }));

  // ═══ ETAPA 3: ESCANEAR → CÁMARA ═══
  await clickVisible(page, "ESCANEAR");
  await page.waitForTimeout(1000);
  await clickVisible(page, "CÁMARA", true).catch(() => {});
  const tCam = Date.now();
  let camChoice = null;
  for (let i = 0; i < 12; i++) {
    await page.waitForTimeout(2500);
    camChoice = await page.evaluate(() => window.__cameraChoice ?? null);
    if (camChoice) break;
  }
  const textoCam = await page.evaluate(() => document.body.innerText);
  resultados.etapas.camara = {
    __cameraChoice: camChoice,
    bootMsHastaTelemetria: camChoice ? Date.now() - tCam : null,
    overlayError: /NO PODEMOS ACCEDER/.test(textoCam),
    iniciando: /INICIANDO/.test(textoCam),
  };
  await page.screenshot({ path: "/home/z/sim-lowend-camara.png" });

  // ═══ ETAPA 4: PIPELINE REAL (SUBIR el acta de prueba) ═══
  const inputs = await page.evaluate(() =>
    [...document.querySelectorAll('input[type="file"]')].map((i) => ({
      accept: i.accept,
      capture: i.capture ?? null,
      id: i.id,
      className: i.className.slice(0, 40),
    }))
  );
  resultados.etapas.fileInputs = inputs;
  const tP0 = Date.now();
  await page.setInputFiles('input[type="file"]', ACTA);

  // esperar la vista ANALIZANDO (aparece apenas arranca el pipeline)
  let analizandoVisto = false;
  try {
    await page.waitForFunction(
      () => /PROCESANDO MOTOR OCR|ANALIZANDO/.test(document.body.innerText),
      undefined, { timeout: 30000 },
    );
    analizandoVisto = true;
    await page.screenshot({ path: "/home/z/sim-lowend-analizando.png" });
  } catch {}
  const tAnalizando = Date.now() - tP0;

  // esperar la vista REVISIÓN real: el botón "SEGUIR ESCANEANDO" o "REPETIR FOTO"
  let desenlace;
  try {
    await page.waitForFunction(
      () =>
        [...document.querySelectorAll("button")].some(
          (x) =>
            x.offsetParent !== null &&
            /SEGUIR ESCANEANDO|REPETIR FOTO|REVISIÓN HUMANA/.test(x.innerText)
        ),
      undefined, { timeout: 480000, polling: 2000 },
    );
    desenlace = { resuelto: true, msHastaRevision: Date.now() - tP0, analizandoVisto, tAnalizando };
  } catch {
    const txt = await page.evaluate(() => document.body.innerText.slice(0, 600));
    desenlace = { resuelto: false, ms: Date.now() - tP0, timeout: true, analizandoVisto, vista: txt };
  }
  resultados.etapas.pipeline = {
    ...desenlace,
    cpuThrottle: "6x",
    red: "3G",
    hilosOcr: "mono-hilo (dev sin COOP/COEP ≈ GH Pages / sin SAB)",
  };
  await page.screenshot({ path: "/home/z/sim-lowend-desenlace.png" });
  try {
    resultados.etapas.vistaFinal_texto = (await page.evaluate(() => document.body.innerText)).slice(0, 900);
  } catch {}

  // ═══ ETAPA 5: memoria final ═══
  resultados.etapas.memoriaPostPipeline = await page.evaluate(() => ({
    jsHeapUsedMB: performance?.memory?.usedJSHeapSize
      ? Math.round(performance.memory.usedJSHeapSize / 1048576)
      : null,
    heapLimitMB: performance?.memory?.jsHeapSizeLimit
      ? Math.round(performance.memory.jsHeapSizeLimit / 1048576)
      : null,
  }));
  resultados.errores = errores.slice(0, 30);

  fs.writeFileSync(OUT, JSON.stringify(resultados, null, 2));
  console.log(JSON.stringify(resultados.etapas, null, 2));
  console.log("ERRORES:", resultados.errores.length);
  await browser.close();
})().catch((e) => {
  console.error("FALLO SIMULACIÓN:", e.message);
  process.exit(1);
});
