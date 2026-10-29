/**
 * KIT e14-adaptacion-dispositivo-v1 — INFORME DEL DISPOSITIVO para IA.
 *
 * Petición del dueño: «que se pueda descargar un informe para que una IA
 * lo pueda interpretar fácilmente». Diseño AUTO-DESCRIBITIVO: el JSON
 * lleva sus propias instrucciones de lectura (_como_interpretar), leyenda
 * de tiers, interpretación por medición y recomendaciones ACCIONABLES —
 * una IA (o un humano) lo consume SIN contexto previo del repo.
 *
 * PRIVACIDAD (mismo espíritu D1/D4 del kit obs): solo METADATOS de
 * hardware/red — SIN actas, SIN texto OCR, SIN contenido. El deviceId va
 * truncado (los mismos 14 chars que muestra el PanelDev — suficiente para
 * correlacionar, insuficiente para rastrear). Nada sale sin pulsar
 * «descargar» (D1 — no hay autosend, no hay backend).
 *
 * Formato: JSON pretty-printed (machine-first). Nombre:
 * informe-dispositivo-YYYYMMDD-HHmm.json (sello local — mismo patrón de
 * obs/export.ts).
 */

import { obtenerPerfilDispositivo } from "./perfil";
import { planAdaptativo } from "./plan";
import { appVersion, idDispositivo, idSesion } from "../obs/identidad";

export interface InformeIA {
  "$informe": "digielect14/perfil-dispositivo";
  "$version": 1;
  /** Instrucciones EXPLÍCITAS para la IA que lea este artefacto. */
  "_como_interpretar": string[];
  resumen_ejecutivo: {
    clasificacion: string; // "GAMA ALTA" | "GAMA MEDIA" | "GAMA BAJA"
    tier: "ALTO" | "MEDIO" | "BAJO";
    tier_inferido: boolean;
    puntuacion_global: number | null; // 0..100 (null = sin datos suficientes)
    desglose_puntuacion: Record<string, number | null>;
    veredicto: string;
    recomendaciones: string[];
    plan_aplicado: {
      adaptado: boolean;
      ocr_hilos: number;
      ocr_hilos_fuente: string;
      hilos_wasm_disponibles: boolean;
      /** KIT e14-gama-baja-20s-v1 — knobs OCR del plan por tier (aditivos).
       *  Merge con tessbest (PR #118): probe_budget_ms quedó subsumido por
       *  probe_orientacion_ms / presupuesto_escaneo_ms / espera_worker_ms
       *  (mismos knobs, fuente main). */
      ocr_reocr_modo: "completo" | "roi-cabecera";
      ocr_segunda_presupuesto_ms: number | null;
      probe_orientacion_ms: number;
      presupuesto_escaneo_ms: number;
      espera_worker_ms: number;
      explicacion: string;
    };
  };
  dispositivo: Record<string, unknown>;
  benchmarks: Record<string, unknown>;
  leyenda: Record<string, unknown>;
  contexto: Record<string, unknown>;
}

/** Texto de clasificación legible por tier. */
function textoGama(tier: string): string {
  return tier === "ALTO" ? "GAMA ALTA" : tier === "MEDIO" ? "GAMA MEDIA" : "GAMA BAJA";
}

/** Recomendaciones ACCIONABLES generadas por reglas sobre el perfil. */
export function recomendacionesDe(p: {
  tier: string;
  capacidades: { wasmSimd: boolean; hilosWasm: boolean; webgpu: boolean; offscreenCanvas: boolean };
  red: { tipo: string | null; saveData: boolean; downlinkMbps: number | null };
  storageLibreMB: number | null;
  bateriaNivel: number | null;
  bateriaCargando: boolean | null;
  memoriaGB: number | null;
  puntuacionGlobal: number | null;
}): string[] {
  const out: string[] = [];
  if (!p.capacidades.hilosWasm) {
    out.push(
      "El OCR corre a UN hilo: este origen no sirve SharedArrayBuffer (falta COOP/COEP). " +
        "Abrir la PWA en el dominio multihilo (https://digielect14.pages.dev o Vercel) multiplica el OCR por hasta 6×.",
    );
  }
  if (!p.capacidades.wasmSimd) {
    out.push(
      "El navegador NO soporta WASM SIMD: actualizar Chrome/Edge/Safari a versión moderna acelera el OCR ~2×.",
    );
  }
  if (!p.capacidades.webgpu && p.tier !== "BAJO") {
    out.push(
      "WebGPU no disponible: en Chrome (escritorio/Android) se habilita con chrome://flags → WebGPU. " +
        "De momento el motor usa WASM (correcto, pero más lento para inferencia).",
    );
  }
  if (p.tier === "BAJO") {
    out.push(
      "Dispositivo de gama baja: la app corre el OCR a 2 hilos para no saturar el sistema. " +
        "Cerrar otras apps durante jornadas largas evita congelones y recargas del navegador.",
    );
    if (p.memoriaGB !== null && p.memoriaGB <= 2)
      out.push("RAM ≤ 2 GB: procesar actas de UNA en una (no en lote) para no agotar la memoria del navegador.");
  }
  if (p.tier === "ALTO" && p.puntuacionGlobal !== null && p.puntuacionGlobal >= 70) {
    out.push(
      "Equipo con holgura: si el OCR sigue siendo el cuello, el dueño puede subir el tope de hilos " +
        "con override manual (localStorage e14-flags-overrides → {\"ocrThreadsTope\": 8}).",
    );
  }
  if (p.red.saveData) {
    out.push("«Ahorro de datos» activo: la descarga de modelos OCR (~30 MB) puede diferirse o fallar en 2G — usar wifi para la primera carga.");
  }
  if (p.red.tipo !== null && (p.red.tipo === "2g" || p.red.tipo === "slow-2g")) {
    out.push("Red muy lenta (2G): precargar los modelos OCR por wifi antes de la jornada (quedan cacheados en el Service Worker).");
  }
  if (p.storageLibreMB !== null && p.storageLibreMB < 500) {
    out.push(`Almacenamiento con solo ${Math.round(p.storageLibreMB)} MB libres: liberar espacio — la PWA, el cache de modelos y el buffer de telemetría necesitan margen.`);
  }
  if (p.bateriaNivel !== null && p.bateriaNivel < 0.2 && p.bateriaCargando === false) {
    out.push("Batería < 20% y sin cargar: el rendimiento se degrada (throttling del SO) — conectar a corriente para jornadas largas.");
  }
  if (p.capacidades.offscreenCanvas && p.tier !== "BAJO") {
    out.push("OffscreenCanvas disponible: candidato futuro para mover el pre-procesado de imagen fuera del main thread (eliminar congelones de UI).");
  }
  if (out.length === 0) {
    out.push("Sin advertencias: todas las capacidades clave (SIMD, multihilo, red, storage) están en buen estado.");
  }
  return out;
}

/** Veredicto en prosa (humano + IA). */
function veredictoDe(p: {
  tier: string;
  global: number | null;
  nucleos: number;
  memoriaGB: number | null;
  gpuRenderer: string | null;
  hilos: number;
  adaptado: boolean;
}): string {
  const ram = p.memoriaGB !== null ? `${p.memoriaGB} GB de RAM` : "RAM no revelada por el navegador";
  const gpu = p.gpuRenderer ?? "GPU no revelada";
  const capa = p.adaptado
    ? `la app se ADAPTA sola: el OCR usa ${p.hilos} hilo(s) de trabajo para exprimir los recursos sin saturarlos`
    : `la adaptación automática está APAGADA (kill-switch del dueño): hilos OCR al default histórico`;
  return (
    `Dispositivo clasificado como ${textoGama(p.tier)} (puntuación ${p.global ?? "N/D"}/100): ` +
    `${p.nucleos} núcleos de CPU, ${ram}, GPU «${gpu}». ${capa}. ` +
    `Las reglas de negocio (scores, gates, desenlaces del pipeline) NO cambian — solo los presupuestos de recursos.`
  );
}

// ─── sello local (mismo patrón de obs/export.ts) ───────────────────────────

function selloDe(d: Date): string {
  const p = (x: number) => String(x).padStart(2, "0");
  return (
    `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}` +
    `-${p(d.getHours())}${p(d.getMinutes())}`
  );
}

/** Descarga local: createObjectURL + <a download> + revoke (mismo patrón
 *  de obs/export.ts — sin dependencia nueva). */
function descargarBlob(blob: Blob, nombre: string): void {
  try {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = nombre;
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
  } catch {
    /* silencioso */
  }
}

/** Informe COMPLETO auto-descriptivo (puro — no descarga nada). */
export async function construirInformeIA(): Promise<InformeIA> {
  const perfil = await obtenerPerfilDispositivo();
  const plan = planAdaptativo();
  const idDisp = idDispositivo();
  const recomendaciones = recomendacionesDe({
    tier: perfil.tier,
    capacidades: perfil.capacidades,
    red: perfil.red,
    storageLibreMB: perfil.storageLibreMB,
    bateriaNivel: perfil.bateria.nivel,
    bateriaCargando: perfil.bateria.cargando,
    memoriaGB: perfil.memoriaGB,
    puntuacionGlobal: perfil.puntuacion.global,
  });

  return {
    "$informe": "digielect14/perfil-dispositivo",
    "$version": 1,
    "_como_interpretar": [
      "Este informe lo genera la PWA DigiE14 (digitalizador de actas E-14 colombianas con OCR en el navegador) DESDE el propio dispositivo.",
      "Es AUTO-CONTENIDO: no necesitas ver el código para interpretarlo — cada bloque lleva su explicación.",
      "'tier' es la clasificación de gama: ALTO (Teléfonos/PCs recientes), MEDIO (intermedio), BAJO (equipos modestos). Se calcula con las reglas del módulo obs del repo (RAM + núcleos + red + batería + storage).",
      "'puntuacion_global' (0-100) es la media PONDERADA de los sub-scores presentes: CPU 30%, RAM 30%, GPU 15%, red 10%, storage 15%. Si una dimensión no tiene dato (null), la media renormaliza con lo presente.",
      "Los null son HONESTOS: significan 'el navegador no expone el dato' (típico en iOS/Safari con RAM, batería y memoria JS) — jamás inventados.",
      "'plan_aplicado' es lo que la app ajustó en runtime para exprimir los recursos del dispositivo (solo knobs de performance; las reglas de negocio del OCR no cambian).",
      "'recomendaciones' son acciones concretas priorizadas — empieza por ellas si vas a dar consejos.",
      "PRIVACIDAD: sin actas ni contenido OCR; ids truncados. Nada se envió a ningún servidor — este archivo salió por una descarga manual.",
    ],
    resumen_ejecutivo: {
      clasificacion: textoGama(perfil.tier),
      tier: perfil.tier,
      tier_inferido: perfil.tierInferido,
      puntuacion_global: perfil.puntuacion.global,
      desglose_puntuacion: { ...perfil.puntuacion.desglose },
      veredicto: veredictoDe({
        tier: perfil.tier,
        global: perfil.puntuacion.global,
        nucleos: perfil.nucleos,
        memoriaGB: perfil.memoriaGB,
        gpuRenderer: perfil.gpu.renderer,
        hilos: plan.ocrHilos,
        adaptado: plan.adaptado,
      }),
      recomendaciones,
      plan_aplicado: {
        adaptado: plan.adaptado,
        ocr_hilos: plan.ocrHilos,
        ocr_hilos_fuente: plan.ocrHilosFuente,
        hilos_wasm_disponibles: plan.hilosWasmDisponibles,
        ocr_reocr_modo: plan.ocrReOcrModo,
        ocr_segunda_presupuesto_ms: plan.ocrSegundaPresupuestoMs,
        probe_orientacion_ms: plan.probeOrientacionMs,
        presupuesto_escaneo_ms: plan.presupuestoEscaneoMs,
        espera_worker_ms: plan.esperaWorkerMs,
        explicacion:
          "ocr_hilos = workers del WASM que ejecutan la inferencia OCR (RapidOCR PP-OCRv4). " +
          "Requieren SharedArrayBuffer (COOP/COEP). Fuente: 'override-manual' (decisión del dueño en localStorage), " +
          "'plan-adaptativo' (BAJO 2 · MEDIO 3 · ALTO 6, capado por núcleos reales) o 'default' (4, histórico). " +
          "ocr_reocr_modo / ocr_segunda_presupuesto_ms (KIT e14-gama-baja-20s-v1) = cómo se resuelve " +
          "el 2.º intento OCR cuando la 1.ª pasada sale débil (en BAJO: rescate de la franja cabecera " +
          "0-25% en vez del re-OCR 1920 completo + tope de 15 s para abrir intentos extra). " +
          "probe_orientacion_ms / presupuesto_escaneo_ms / espera_worker_ms (KIT e14-ocr-tessbest-v1) = " +
          "presupuestos por tier del sondeo de orientación, del escaneo completo y de la espera del " +
          "warm-up del worker OpenCV.",
      },
    },
    dispositivo: {
      os: perfil.os,
      nucleos_cpu: perfil.nucleos,
      ram_gb: perfil.memoriaGB,
      ram_nota: perfil.memoriaGB === null ? "navigator.deviceMemory no existe (iOS/Safari) — ver heap_limit_mb como proxy" : undefined,
      heap_limit_mb: perfil.heapLimitMB,
      memoria_js_usada_mb: perfil.memoriaUsadaMB,
      pantalla: {
        ancho_px: perfil.pantalla.anchoPx,
        alto_px: perfil.pantalla.altoPx,
        dpr: perfil.pantalla.dpr,
        megapixeles_fisicos: perfil.pantalla.pixelesMP,
        nota: "px CSS × devicePixelRatio — el tamaño REAL de la matriz de la pantalla",
      },
      gpu: {
        renderer: perfil.gpu.renderer,
        vendor: perfil.gpu.vendor,
        webgl: perfil.gpu.webgl,
        nota: "renderer real vía WEBGL_debug_renderer_info; 'null' = el navegador lo oculta (privacidad)",
      },
      camaras_video: perfil.camaras,
      red: {
        tipo: perfil.red.tipo,
        downlink_mbps: perfil.red.downlinkMbps,
        ahorro_datos: perfil.red.saveData,
        nota: "navigator.connection — null en iOS/Safari (no inventado)",
      },
      bateria: {
        nivel: perfil.bateria.nivel,
        cargando: perfil.bateria.cargando,
        nota: "null en iOS/Safari (Battery API no existe allí)",
      },
      almacenamiento_libre_mb: perfil.storageLibreMB,
      capacidades_web: {
        wasm: perfil.capacidades.wasm,
        wasm_simd: perfil.capacidades.wasmSimd,
        wasm_multihilo: perfil.capacidades.hilosWasm,
        webgpu: perfil.capacidades.webgpu,
        offscreen_canvas: perfil.capacidades.offscreenCanvas,
        service_worker: perfil.capacidades.serviceWorker,
        nota: "SIMD y multihilo son los dos aceleradores clave del OCR; multihilo exige COOP/COEP en el servidor",
      },
    },
    benchmarks: {
      cpu_ops_ms: perfil.benchmarks.cpuOpsMs,
      cpu_interpretacion:
        "operaciones enteras/ms del hilo principal. Referencia: <10k gama baja · 10-100k gama media · >100k gama alta.",
      canvas_ms: perfil.benchmarks.canvasMs,
      canvas_interpretacion:
        "ms de 16 iteraciones (drawImage + getImageData 96×128). Referencia: <30 ms ágil · 30-80 normal · >80 lento.",
      nota: "micro-benchmarks propios (<300 ms), corren una vez por carga de página; comparables entre dispositivos del mismo navegador",
    },
    leyenda: {
      tiers: {
        ALTO: "RAM ≥ 4 GB + núcleos ≥ 6 + red 4g/wifi + sin ahorro de datos (o inferido en iOS: núcleos ≥ 6 + heap ≥ 2 GB)",
        MEDIO: "no cumple BAJO ni ALTO",
        BAJO: "cualquier señal débil: RAM < 2 GB, ≤ 2 núcleos, ahorro de datos, batería < 20% sin cargar, storage < 500 MB",
      },
      escala_puntuacion: "0-100 — ≥70 gama alta · 40-69 media · <40 baja (informativa; el tier del contrato manda)",
      nulls: "null = el navegador no expone el dato (iOS/Safari suele ocultar RAM, batería y memoria JS) — jamás inventado",
    },
    contexto: {
      app: "digielect14",
      app_version: appVersion(),
      generado_iso: new Date().toISOString(),
      id_dispositivo: idDisp ? idDisp.slice(0, 8) : null, // truncado — privacidad
      id_sesion: (() => {
        try {
          const s = idSesion();
          return s ? s.slice(0, 8) : null;
        } catch {
          return null;
        }
      })(),
      user_agent: perfil.ua,
      nota_privacidad:
        "Informe solo-METADATOS (sin actas ni OCR). Ids truncados a 8 hex. Descarga manual (D1: nada sale del dispositivo sin acción explícita).",
    },
  };
}

/** Construye y DESCARGA el informe (JSON pretty). Devuelve nombre+bytes
 *  para la UI (mismo contrato que descargarReporte de obs/export.ts). */
export async function descargarInformeIA(): Promise<{ nombre: string; bytes: number }> {
  const informe = await construirInformeIA();
  const json = JSON.stringify(informe, null, 2);
  const blob = new Blob([json], { type: "application/json" });
  const nombre = `informe-dispositivo-${selloDe(new Date())}.json`;
  descargarBlob(blob, nombre);
  return { nombre, bytes: blob.size };
}
