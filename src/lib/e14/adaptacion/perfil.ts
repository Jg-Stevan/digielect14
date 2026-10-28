/**
 * KIT e14-adaptacion-dispositivo-v1 — perfil PROFUNDO del dispositivo.
 *
 * Complementa `obs/dispositivo.ts` (el snapshot §4.4 de salud, INTACTO):
 * aquí se añade lo que el snapshot no mira — GPU real (WebGL renderer),
 * capacidades de plataforma (WebGPU, WASM-SIMD, hilos wasm vía
 * SharedArrayBuffer+COOP/COEP, OffscreenCanvas, serviceWorker), pantalla
 * (px físicos + DPR), número de cámaras y DOS micro-benchmarks (< 300 ms
 * en total, corren UNA sola vez por carga de página) con puntuación
 * 0-100 por dimensión.
 *
 * REGLAS (heredadas del kit observabilidad):
 *  · null HONESTO donde el navegador no da el dato (jamás inventar).
 *  · Jamás lanza — cada lectura con try/catch; un fallo de benchmarks
 *    NO rompe el perfil ni la app.
 *  · CERO dependencias nuevas; el tier BAJO/MEDIO/ALTO sigue viniendo
 *    de `calcularTier` del contrato obs (D6 — aquí NO se re-inventa).
 *  · Los benchmarks SOLO corren si el perfil se pide (UI/informe);
 *    el plan adaptativo (plan.ts) usa el tier RÁPIDO síncrono y no
 *    paga benchmarks ni async.
 */

import { calcularTier, osDeUA } from "../obs/dispositivo";
import type { Tier } from "../obs/tipos";

// ─── tipos del perfil ───────────────────────────────────────────────────────

export interface GpuInfo {
  /** renderer REAL del GPU (WEBGL_debug_renderer_info) — null si oculto. */
  renderer: string | null;
  vendor: string | null;
  webgl: boolean;
}

export interface PantallaInfo {
  anchoPx: number | null; // CSS px (window.screen.width)
  altoPx: number | null;
  dpr: number | null; // devicePixelRatio
  /** megapíxeles físicos de pantalla (ancho×alto×dpr² / 1e6) — null si no hay dato. */
  pixelesMP: number | null;
}

export interface CapacidadesWeb {
  wasm: boolean;
  /** WASM SIMD — el OCR de RapidOCR corre ~2× más rápido con él. */
  wasmSimd: boolean;
  /** SharedArrayBuffer + crossOriginIsolated (COOP/COEP) — habilita el
   *  wasm MULTIHilo (el OCR a N hilos lo exige). */
  hilosWasm: boolean;
  webgpu: boolean;
  offscreenCanvas: boolean;
  serviceWorker: boolean;
}

export interface Benchmarks {
  /** operaciones enteras por ms del main thread (bucle ~120 ms). */
  cpuOpsMs: number | null;
  /** ms de 16 iteraciones drawImage+getImageData 96×128 (canvas 2d). */
  canvasMs: number | null;
}

export interface Subscores {
  cpu: number | null; // 0..100
  ram: number | null;
  gpu: number | null;
  red: number | null;
  storage: number | null;
}

export interface PerfilDispositivo {
  generado: number; // epoch ms
  os: string;
  ua: string;
  nucleos: number;
  memoriaGB: number | null; // navigator.deviceMemory (null en iOS)
  heapLimitMB: number | null; // performance.memory.jsHeapSizeLimit (Chromium)
  memoriaUsadaMB: number | null;
  pantalla: PantallaInfo;
  gpu: GpuInfo;
  capacidades: CapacidadesWeb;
  /** número de cámaras de video visibles (enumerateDevices — sin permiso
   *  cuenta pero oculta labels; null si el navegador no expone la API). */
  camaras: number | null;
  red: { tipo: string | null; downlinkMbps: number | null; saveData: boolean };
  bateria: { nivel: number | null; cargando: boolean | null };
  storageLibreMB: number | null;
  benchmarks: Benchmarks;
  puntuacion: {
    global: number | null; // 0..100 — media ponderada de los sub-scores presentes
    desglose: Subscores;
    /** nota honesta sobre qué falta para la puntuación (iOS, Safari…). */
    nota: string;
  };
  /** Tier del CONTRATO obs (calcularTier §4.4) — la fuente de verdad. */
  tier: Tier;
  tierInferido: boolean;
}

// ─── lecturas elementales (cada una con null honesto) ──────────────────────

/** Bytes de un módulo wasm mínimo con una instrucción v128 (detección SIMD
 *  estándar — WebAssembly.validate, sin ejecutar nada). */
const WASM_SIMD_PROBE = new Uint8Array([
  0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 1, 96, 0, 1, 123, 3, 2, 1, 0, 10, 10, 1,
  8, 0, 65, 0, 253, 15, 253, 98, 11,
]);

export function capacidadesDe(): CapacidadesWeb {
  const cap: CapacidadesWeb = {
    wasm: false,
    wasmSimd: false,
    hilosWasm: false,
    webgpu: false,
    offscreenCanvas: false,
    serviceWorker: false,
  };
  try {
    cap.wasm = typeof WebAssembly === "object" && WebAssembly !== null;
    if (cap.wasm) cap.wasmSimd = WebAssembly.validate(WASM_SIMD_PROBE);
    // Mismas dos condiciones que rapidocr.ts exige para numThreads > 1.
    cap.hilosWasm =
      typeof SharedArrayBuffer !== "undefined" &&
      typeof self !== "undefined" &&
      self.crossOriginIsolated === true;
    cap.webgpu =
      typeof navigator !== "undefined" &&
      "gpu" in navigator &&
      (navigator as Navigator & { gpu?: unknown }).gpu != null;
    cap.offscreenCanvas = typeof OffscreenCanvas !== "undefined";
    cap.serviceWorker = typeof navigator !== "undefined" && "serviceWorker" in navigator;
  } catch {
    /* devolver lo acumulado — jamás lanzar */
  }
  return cap;
}

export function gpuDe(): GpuInfo {
  const vacio: GpuInfo = { renderer: null, vendor: null, webgl: false };
  try {
    if (typeof document === "undefined") return vacio;
    const canvas = document.createElement("canvas");
    const gl =
      (canvas.getContext("webgl") as WebGLRenderingContext | null) ??
      (canvas.getContext("experimental-webgl") as WebGLRenderingContext | null);
    if (!gl) return vacio;
    const info: GpuInfo = {
      webgl: true,
      renderer: (gl.getParameter(gl.RENDERER) as string | null) ?? null,
      vendor: (gl.getParameter(gl.VENDOR) as string | null) ?? null,
    };
    // El renderer REAL vive en la extensión de debug (Chrome/Android).
    try {
      const ext = gl.getExtension("WEBGL_debug_renderer_info");
      if (ext) {
        const real = gl.getParameter(ext.UNMASKED_RENDERER_WEBGL);
        if (typeof real === "string" && real.length > 0) info.renderer = real;
        const vendorReal = gl.getParameter(ext.UNMASKED_VENDOR_WEBGL);
        if (typeof vendorReal === "string" && vendorReal.length > 0) info.vendor = vendorReal;
      }
    } catch {
      /* extensión ausente/bloqueada → quedan los valores genéricos */
    }
    return info;
  } catch {
    return vacio;
  }
}

export function pantallaDe(): PantallaInfo {
  try {
    if (typeof window === "undefined" || typeof screen === "undefined") {
      return { anchoPx: null, altoPx: null, dpr: null, pixelesMP: null };
    }
    const ancho = typeof screen.width === "number" && screen.width > 0 ? screen.width : null;
    const alto = typeof screen.height === "number" && screen.height > 0 ? screen.height : null;
    const dpr =
      typeof window.devicePixelRatio === "number" && window.devicePixelRatio > 0
        ? window.devicePixelRatio
        : null;
    const mp =
      ancho !== null && alto !== null && dpr !== null
        ? Math.round(((ancho * dpr) * (alto * dpr)) / 1e6 * 10) / 10
        : null;
    return { anchoPx: ancho, altoPx: alto, dpr, pixelesMP: mp };
  } catch {
    return { anchoPx: null, altoPx: null, dpr: null, pixelesMP: null };
  }
}

async function camarasDe(): Promise<number | null> {
  try {
    if (typeof navigator === "undefined" || !navigator.mediaDevices?.enumerateDevices)
      return null;
    const dispositivos = await navigator.mediaDevices.enumerateDevices();
    return dispositivos.filter((d) => d.kind === "videoinput").length;
  } catch {
    return null;
  }
}

function heapLimitMBDe(): number | null {
  try {
    const p = performance as Performance & { memory?: { jsHeapSizeLimit?: number } };
    const v = p.memory?.jsHeapSizeLimit;
    return typeof v === "number" ? Math.round(v / 1048576) : null;
  } catch {
    return null;
  }
}

function memoriaUsadaMBDe(): number | null {
  try {
    const p = performance as Performance & { memory?: { usedJSHeapSize?: number } };
    const v = p.memory?.usedJSHeapSize;
    return typeof v === "number" ? Math.round(v / 1048576) : null;
  } catch {
    return null;
  }
}

async function bateriaDe(): Promise<{ nivel: number | null; cargando: boolean | null }> {
  try {
    const nav = navigator as Navigator & {
      getBattery?: () => Promise<{ level: number; charging: boolean }>;
    };
    if (typeof nav.getBattery !== "function") return { nivel: null, cargando: null };
    const b = await nav.getBattery();
    return { nivel: b.level, cargando: b.charging };
  } catch {
    return { nivel: null, cargando: null };
  }
}

async function storageLibreMBDe(): Promise<number | null> {
  try {
    if (!navigator.storage || typeof navigator.storage.estimate !== "function") return null;
    const e = await navigator.storage.estimate();
    if (typeof e.quota !== "number" || typeof e.usage !== "number") return null;
    return Math.round((e.quota - e.usage) / 1048576);
  } catch {
    return null;
  }
}

function redDe(): { tipo: string | null; downlinkMbps: number | null; saveData: boolean } {
  try {
    if (typeof navigator === "undefined") return { tipo: null, downlinkMbps: null, saveData: false };
    const c = (
      navigator as Navigator & {
        connection?: { effectiveType?: string; downlink?: number; saveData?: boolean };
      }
    ).connection;
    return {
      tipo: c?.effectiveType ?? null,
      downlinkMbps: typeof c?.downlink === "number" ? c.downlink : null,
      saveData: c?.saveData === true,
    };
  } catch {
    return { tipo: null, downlinkMbps: null, saveData: false };
  }
}

// ─── benchmarks (rápidos — corren solo a demanda del perfil) ────────────────

/** CPU: bucle entero FNV-ish hasta agotar ~120 ms del main thread.
 *  Ops/ms comparable entre dispositivos (misma mezcla de instrucciones). */
export function benchmarkCpu(presupuestoMs = 120): number | null {
  try {
    const t0 = performance.now();
    let h = 0x811c9dc5;
    let iteraciones = 0;
    let t = t0;
    // Chequear el reloj cada 20k iteraciones (el reloj distorsiona poco).
    for (;;) {
      for (let i = 0; i < 20_000; i++) {
        h ^= i & 0xff;
        h = Math.imul(h, 0x01000193) >>> 0;
        h ^= h >>> 13;
      }
      iteraciones += 20_000;
      t = performance.now();
      if (t - t0 >= presupuestoMs) break;
    }
    const ms = t - t0;
    if (ms <= 0 || iteraciones <= 0) return null;
    return Math.round(iteraciones / ms);
  } catch {
    return null;
  }
}

/** Canvas 2d: 16× (drawImage 320×420 → 96×128 + getImageData + suma de
 *  bytes). Devuelve ms TOTAL (menor = más rápido). null sin canvas. */
export function benchmarkCanvas(): number | null {
  try {
    if (typeof document === "undefined") return null;
    const fuente = document.createElement("canvas");
    fuente.width = 320;
    fuente.height = 420;
    const ctxF = fuente.getContext("2d");
    if (!ctxF) return null;
    const grad = ctxF.createLinearGradient(0, 0, 320, 420);
    grad.addColorStop(0, "#f8fafc");
    grad.addColorStop(1, "#0f172a");
    ctxF.fillStyle = grad;
    ctxF.fillRect(0, 0, 320, 420);
    ctxF.fillStyle = "#1e293b";
    for (let i = 0; i < 30; i++) ctxF.fillRect(10 + i * 9, 30 + (i % 10) * 34, 60, 20);

    const destino = document.createElement("canvas");
    destino.width = 96;
    destino.height = 128;
    const ctxD = destino.getContext("2d", { willReadFrequently: true });
    if (!ctxD) return null;

    const t0 = performance.now();
    let checksum = 0;
    for (let i = 0; i < 16; i++) {
      ctxD.drawImage(fuente, 0, 0, 96, 128);
      const data = ctxD.getImageData(0, 0, 96, 128).data;
      for (let j = 0; j < data.length; j += 61) checksum = (checksum + data[j]) | 0;
    }
    const ms = performance.now() - t0;
    return Math.round(ms * 10) / 10;
  } catch {
    return null;
  }
}

// ─── puntuación 0-100 (INFORMATIVA — el tier del contrato manda) ───────────

const SUJETAR = (v: number): number => Math.max(0, Math.min(100, Math.round(v)));

/** CPU → 0-100 con escala log10 (10k ops/ms ≈ 25 · 100k ≈ 75 · 250k ≈ 95). */
function scoreCpu(opsMs: number | null): number | null {
  if (opsMs === null || opsMs <= 0) return null;
  const log = Math.log10(opsMs);
  return SUJETAR(((log - 3.5) / 2.0) * 100);
}

/** RAM → deviceMemory real; sin él (iOS) heapLimit como proxy HONESTO. */
function scoreRam(memoriaGB: number | null, heapLimitMB: number | null): number | null {
  if (memoriaGB !== null) {
    if (memoriaGB <= 2) return SUJETAR(15 + (memoriaGB - 1) * 10);
    if (memoriaGB >= 8) return 100;
    return SUJETAR(30 + (memoriaGB - 2) * 11); // 4 GB ≈ 52 · 6 GB ≈ 74
  }
  if (heapLimitMB !== null) {
    if (heapLimitMB >= 2048) return 70; // iOS con RAM holgada (límite crece con RAM)
    if (heapLimitMB >= 1024) return 45;
    return 25;
  }
  return null;
}

/** GPU → parseo HONESTO del renderer (regex conservadoras). null = sin
 *  dato; SwiftShader/llvmpipe (software) = 10 — no disimular. */
function scoreGpu(renderer: string | null): number | null {
  if (!renderer) return null;
  const r = renderer.toLowerCase();
  if (/swiftshader|llvmpipe|software|basic render/.test(r)) return 10;
  if (/rtx|radeon rx|apple\s*m[1-9]|arc a[0-9]/.test(r)) return 95;
  if (/adreno\s*(7|8)\d{2}|mali-g(7|8|9)\d|snapdragon\s*8|apple a9|apple a1[0-9]/.test(r)) return 85;
  if (/adreno\s*[56]\d{2}|mali-g(5|6)\d|mali-[gt]\d{2,}/.test(r)) return 60;
  if (/intel|uhd graphics|iris|hd graphics|mali-\d{2}/.test(r)) return 45;
  return 50; // renderer no reconocido → neutral HONESTO (quedó registrado)
}

function scoreRed(
  tipo: string | null,
  downlink: number | null,
  saveData: boolean,
): number | null {
  if (tipo === null && downlink === null) return null;
  let base: number;
  if (tipo === "4g") base = 100;
  else if (tipo === "3g") base = 45;
  else if (tipo === "2g" || tipo === "slow-2g") base = 10;
  else if (downlink !== null) base = SUJETAR(downlink * 12); // ~8 Mbps → ~100
  else base = 50;
  return saveData ? Math.min(base, 30) : base;
}

function scoreStorage(libreMB: number | null): number | null {
  if (libreMB === null) return null;
  if (libreMB >= 2000) return 100;
  if (libreMB >= 500) return SUJETAR(40 + ((libreMB - 500) / 1500) * 60);
  return SUJETAR(libreMB / 12.5); // < 500 MB → proporcional (0 MB → 0)
}

const PESOS = { cpu: 0.3, ram: 0.3, gpu: 0.15, red: 0.1, storage: 0.15 } as const;

export function puntuar(e: {
  benchmarks: Benchmarks;
  memoriaGB: number | null;
  heapLimitMB: number | null;
  gpuRenderer: string | null;
  redTipo: string | null;
  redDownlink: number | null;
  saveData: boolean;
  storageLibreMB: number | null;
}): { global: number | null; desglose: Subscores; nota: string } {
  const desglose: Subscores = {
    cpu: scoreCpu(e.benchmarks.cpuOpsMs),
    ram: scoreRam(e.memoriaGB, e.heapLimitMB),
    gpu: scoreGpu(e.gpuRenderer),
    red: scoreRed(e.redTipo, e.redDownlink, e.saveData),
    storage: scoreStorage(e.storageLibreMB),
  };
  const ausentes: string[] = [];
  let suma = 0;
  let peso = 0;
  for (const clave of Object.keys(desglose) as Array<keyof Subscores>) {
    const v = desglose[clave];
    if (v === null) {
      ausentes.push(clave);
      continue;
    }
    suma += v * PESOS[clave];
    peso += PESOS[clave];
  }
  const global = peso > 0 ? SUJETAR(suma / peso) : null;
  const nota =
    ausentes.length === 0
      ? "todas las dimensiones puntuadas"
      : `sin dato (null honesto): ${ausentes.join(", ")} — el global renormaliza con lo presente`;
  return { global, desglose, nota };
}

// ─── tier RÁPIDO síncrono (para el plan — sin async, sin benchmarks) ───────

/** Señales BARATAS y síncronas → calcularTier del contrato con los datos
 *  async en null (batería/storage no condenan de fábrica — §4.4 honesto).
 *  El perfil completo (async) REFRECHA este cache cuando llega. */
export function tierRapido(): { tier: Tier; tierInferido: boolean } {
  try {
    if (typeof navigator === "undefined") return { tier: "MEDIO", tierInferido: true };
    const memoriaGB =
      typeof (navigator as Navigator & { deviceMemory?: number }).deviceMemory === "number"
        ? (navigator as Navigator & { deviceMemory: number }).deviceMemory
        : null;
    const nucleos =
      typeof navigator.hardwareConcurrency === "number" && navigator.hardwareConcurrency > 0
        ? navigator.hardwareConcurrency
        : 1;
    const c = (
      navigator as Navigator & { connection?: { effectiveType?: string; saveData?: boolean } }
    ).connection;
    return calcularTier({
      memoriaGB,
      nucleos,
      saveData: c?.saveData === true,
      bateriaNivel: null,
      bateriaCargando: null,
      storageLibreMB: null,
      redTipo: c?.effectiveType ?? null,
      redWifi: false,
      heapLimitMB: heapLimitMBDe(),
    });
  } catch {
    return { tier: "MEDIO", tierInferido: true };
  }
}

// ─── obtener el perfil completo (cacheado — benchmarks 1 vez por carga) ─────

let cachePerfil: PerfilDispositivo | null = null;
let enVuelo: Promise<PerfilDispositivo> | null = null;

/** Perfil completo. Los benchmarks corren SOLO la primera vez (o con
 *  `forzar=true` — botón «repetir benchmarks» del panel); el resto de
 *  lecturas se re-miden en cada llamada (batería/red/storage son vivos). */
export async function obtenerPerfilDispositivo(forzar = false): Promise<PerfilDispositivo> {
  try {
    if (typeof window === "undefined") throw new Error("ssr");
    if (!forzar && cachePerfil) return cachePerfil;
    if (enVuelo) return enVuelo;

    enVuelo = (async () => {
      const ua = navigator.userAgent;
      const memoriaGB =
        typeof (navigator as Navigator & { deviceMemory?: number }).deviceMemory === "number"
          ? (navigator as Navigator & { deviceMemory: number }).deviceMemory
          : null;
      const nucleos =
        typeof navigator.hardwareConcurrency === "number" && navigator.hardwareConcurrency > 0
          ? navigator.hardwareConcurrency
          : 1;
      const heapLimitMB = heapLimitMBDe();
      const gpu = gpuDe();
      const red = redDe();
      const [bateria, storageLibreMB, camaras] = await Promise.all([
        bateriaDe(),
        storageLibreMBDe(),
        camarasDe(),
      ]);
      const benchmarks: Benchmarks = cachePerfil?.benchmarks ?? {
        cpuOpsMs: benchmarkCpu(),
        canvasMs: benchmarkCanvas(),
      };
      const puntuacion = puntuar({
        benchmarks,
        memoriaGB,
        heapLimitMB,
        gpuRenderer: gpu.renderer,
        redTipo: red.tipo,
        redDownlink: red.downlinkMbps,
        saveData: red.saveData,
        storageLibreMB,
      });
      const { tier, tierInferido } = calcularTier({
        memoriaGB,
        nucleos,
        saveData: red.saveData,
        bateriaNivel: bateria.nivel,
        bateriaCargando: bateria.cargando,
        storageLibreMB,
        redTipo: red.tipo,
        redWifi: false, // navigator.connection.type no existe en los navegadores actuales — honesto
        heapLimitMB,
      });
      const perfil: PerfilDispositivo = {
        generado: Date.now(),
        os: osDeUA(ua),
        ua,
        nucleos,
        memoriaGB,
        heapLimitMB,
        memoriaUsadaMB: memoriaUsadaMBDe(),
        pantalla: pantallaDe(),
        gpu,
        capacidades: capacidadesDe(),
        camaras,
        red,
        bateria,
        storageLibreMB,
        benchmarks,
        puntuacion,
        tier,
        tierInferido,
      };
      cachePerfil = perfil;
      return perfil;
    })();

    return await enVuelo;
  } catch {
    // Perfil de emergencia — jamás lanzar (el plan y la UI ya tratan nulls).
    const rapido = tierRapido();
    return {
      generado: Date.now(),
      os: "desconocido",
      ua: "",
      nucleos: 1,
      memoriaGB: null,
      heapLimitMB: null,
      memoriaUsadaMB: null,
      pantalla: { anchoPx: null, altoPx: null, dpr: null, pixelesMP: null },
      gpu: { renderer: null, vendor: null, webgl: false },
      capacidades: capacidadesDe(),
      camaras: null,
      red: { tipo: null, downlinkMbps: null, saveData: false },
      bateria: { nivel: null, cargando: null },
      storageLibreMB: null,
      benchmarks: { cpuOpsMs: null, canvasMs: null },
      puntuacion: {
        global: null,
        desglose: { cpu: null, ram: null, gpu: null, red: null, storage: null },
        nota: "perfil de emergencia — el navegador no permitió medir",
      },
      tier: rapido.tier,
      tierInferido: rapido.tierInferido,
    };
  } finally {
    enVuelo = null;
  }
}

/** Test interno (reset del cache del módulo). */
export function __resetPerfilParaTest(): void {
  cachePerfil = null;
  enVuelo = null;
}
