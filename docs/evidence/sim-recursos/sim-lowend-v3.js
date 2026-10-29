/**
 * SIMULACIÓN GAMA BAJA v3 — DigiE14 (perfil sm-a135m/ds Galaxy A13 aproximado)
 * CPU 6x (parametrizable CPU_RATE) · RAM 2GB declarada · 4 núcleos · 3G · mono-hilo.
 * Añadidos vs v2: vigilancia del RESCATE post-timeout (e67) + métricas CDP
 * (Performance.enable) + rutas/parámetros por entorno (sin rutas absolutas).
 *
 * Uso:  APP_URL=http://localhost:3100 node docs/evidence/sim-recursos/sim-lowend-v3.js
 * Salida: JSON de resultados + capturas PNG junto al JSON (no se suben al repo).
 */
const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");

const APP = process.env.APP_URL || "http://localhost:3100";
const REPO_ROOT = path.resolve(__dirname, "../../..");
const ACTA = process.env.ACTA_PATH || path.join(REPO_ROOT, "src/assets/acta-e14-real.jpg");
const OUT = process.env.OUT_PATH || path.join(__dirname, "sim-lowend-v3-resultados.local.json");
const CPU_RATE = parseInt(process.env.CPU_RATE || "6", 10);
const POST_WATCH_MS = parseInt(process.env.POST_WATCH_MS || "120000", 10);
const SHOT = (n) => path.join(path.dirname(OUT), n);

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

function resumenVista(t) {
  return {
    score: (t.match(/(\d+\.\d)\/10/) || [])[1] ?? null,
    rechazada: /RECHAZADA/.test(t),
    repetirFoto: /REPETIR FOTO/.test(t),
    enviadaAuto: /ENVIADO AUTOMÁTICAMENTE/.test(t),
    tiempoExcedido: /TIEMPO DE PROCESADO EXCEDIDO/.test(t),
    noIdentificado: /NO IDENTIFICADO/.test(t),
    qr: /QR ✓/.test(t),
  };
}

(async () => {
  const resultados = {
    app: APP,
    acta: ACTA,
    perfil: `CPU ${CPU_RATE}x · RAM 2GB · 4 núcleos · 3G · mono-hilo (sin COOP/COEP)`,
    etapas: {},
  };
  const browser = await chromium.launch({
    headless: true,
    args: [
      "--use-fake-device-for-media-stream",
      "--use-fake-ui-for-media-stream",
      "--disable-dev-shm-usage",
    ],
  });
  const ctx = await browser.newContext({
    viewport: { width: 384, height: 857 },          // ≈ 1080×2400 físico a DPR 2.8125 (Galaxy A13)
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
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: CPU_RATE });
  await cdp.send("Network.enable", {});
  await cdp.send("Network.emulateNetworkConditions", {
    offline: false,
    latency: 150,
    downloadThroughput: (1.6 * 1024 * 1024) / 8,
    uploadThroughput: (750 * 1024) / 8,
  });
  try { await cdp.send("Performance.enable"); } catch {}

  // ═══ ETAPA 1: CARGA ═══
  const t0 = Date.now();
  await page.goto(APP, { waitUntil: "domcontentloaded", timeout: 120000 });
  await page.waitForFunction(
    () =>
      [...document.querySelectorAll("button")].some(
        (x) => x.offsetParent !== null && /ESCANEAR/.test(x.innerText)
      ),
    { timeout: 180000 },
  );
  resultados.etapas.cargaInicial = { uiVisible_ms: Date.now() - t0 };
  await clickVisible(page, "ENTENDIDO").catch(() => {});
  await page.waitForTimeout(800);
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
  resultados.etapas.camara = {
    __cameraChoice: camChoice,
    bootMsHastaTelemetria: camChoice ? Date.now() - tCam : null,
  };

  // ═══ ETAPA 4: PIPELINE REAL (acta E-14 REAL incluida en el repo) ═══
  const tP0 = Date.now();
  await page.setInputFiles('input[type="file"]', ACTA);
  let analizandoVisto = false;
  try {
    await page.waitForFunction(
      () => /PROCESANDO MOTOR OCR|ANALIZANDO/.test(document.body.innerText),
      undefined, { timeout: 30000 },
    );
    analizandoVisto = true;
  } catch {}
  resultados.etapas.pipelineArranque = { analizandoVisto, tAnalizando: Date.now() - tP0 };

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
    const texto = await page.evaluate(() => document.body.innerText);
    desenlace = { resuelto: true, msHastaRevision: Date.now() - tP0, vista: resumenVista(texto) };
  } catch {
    desenlace = { resuelto: false, ms: Date.now() - tP0, timeout: true };
  }
  resultados.etapas.pipeline = {
    ...desenlace,
    cpuThrottle: `${CPU_RATE}x (CDP Emulation.setCPUThrottlingRate)`,
    red: "3G (1.6 Mbps ↓ / 750 Kbps ↑ / 150 ms)",
    hilosOcr: "mono-hilo (dev sin COOP/COEP, sin SAB)",
  };
  await page.screenshot({ path: SHOT("sim-v3-revision.png") });

  // ═══ ETAPA 4b: VIGILANCIA DEL RESCATE post-timeout (e67) ═══
  const vigilancia = [];
  const finWatch = Date.now() + POST_WATCH_MS;
  let ultimo = JSON.stringify(desenlace.vista || {});
  while (Date.now() < finWatch) {
    await page.waitForTimeout(10000);
    let txt = "";
    try { txt = await page.evaluate(() => document.body.innerText); } catch { break; }
    const r = resumenVista(txt);
    const s = JSON.stringify(r);
    if (s !== ultimo) {
      vigilancia.push({ t_ms: Date.now() - tP0, cambio: r });
      ultimo = s;
      await page.screenshot({ path: SHOT(`sim-v3-cambio-${vigilancia.length}.png`) });
    }
  }
  resultados.etapas.vigilanciaRescate = {
    ventana_ms: POST_WATCH_MS,
    cambios: vigilancia,
    estadoFinal: JSON.parse(ultimo),
  };

  // ═══ ETAPA 5: memoria + métricas CDP ═══
  resultados.etapas.memoriaPostPipeline = await page.evaluate(() => ({
    jsHeapUsedMB: performance?.memory?.usedJSHeapSize
      ? Math.round(performance.memory.usedJSHeapSize / 1048576)
      : null,
    heapLimitMB: performance?.memory?.jsHeapSizeLimit
      ? Math.round(performance.memory.jsHeapSizeLimit / 1048576)
      : null,
  }));
  try {
    const { metrics } = await cdp.send("Performance.getMetrics");
    const utiles = ["ScriptDuration", "TaskDuration", "LayoutDuration", "RecalcStyleDuration", "JSHeapUsedSize", "JSHeapTotalSize", "Nodes"];
    resultados.etapas.metricasCDP = Object.fromEntries(
      metrics.filter((m) => utiles.includes(m.name)).map((m) => [m.name, Math.round(m.value * 100) / 100]),
    );
  } catch {}
  resultados.errores = errores.slice(0, 30);

  fs.writeFileSync(OUT, JSON.stringify(resultados, null, 2));
  console.log(JSON.stringify(resultados.etapas, null, 2));
  console.log("ERRORES:", resultados.errores.length);
  await browser.close();
})().catch((e) => {
  console.error("FALLO SIMULACIÓN:", e.message);
  process.exit(1);
});
