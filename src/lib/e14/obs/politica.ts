/**
 * KIT e14-observabilidad-v1 (A1-C5/C6) — política de datos + modo dev +
 * overrides de flags (claves del contrato README-KITS §4.1, INALTERABLES):
 *  · e14-obs-politica (localStorage) — PoliticaDatos JSON (agente 1)
 *  · e14-dev-mode (localStorage) — "on" | "off" (helpers aquí; UI agente 2)
 *  · e14-flags-overrides (localStorage) — overrides MANUALES de flags
 *    (helpers aquí; kill switch UI agente 2)
 *
 * Defaults D4 (sin excepciones): metadatos ON · textoOcr OFF · miniaturas
 * OFF · saludEnVivo ON. JSON corrupto → defaults + evento warn (jamás
 * inventar la mitad de una política).
 */
import { appendEvento } from "@jg-stevan/scanner-core/obs-base/buffer";
import { digestDe } from "@jg-stevan/scanner-core/obs-base/digest";
import { obtenerBreadcrumbs } from "@jg-stevan/scanner-core/obs-base/breadcrumbs";
import type { FlagsApp, PoliticaDatos } from "./tipos";

const CLAVE_POLITICA = "e14-obs-politica";
const CLAVE_MODO_DEV = "e14-dev-mode";
export const CLAVE_OVERRIDES = "e14-flags-overrides";

/** Defaults del contrato §4.2 (D4). */
export const POLITICA_DEFAULT: PoliticaDatos = {
  metadatos: true,
  textoOcr: false,
  miniaturas: false,
  saludEnVivo: true,
};

/** evento warn del rastreo (mismo ErrorEvento que el logger, sin consola:
 *  el fallo es conocido y esperable — no ensucia la consola del operador). */
function avisarObs(mensaje: string, etiqueta: string): void {
  try {
    const stack = new Error().stack ?? "";
    void appendEvento({
      tipo: "warn",
      ts: Date.now(),
      sesion: "",
      dispositivo: "",
      appVersion: "",
      datos: {
        mensaje,
        stack: stack.slice(0, 2000),
        tipo: etiqueta,
        archivo: null,
        digest: digestDe(mensaje, etiqueta, stack),
        breadcrumbs: obtenerBreadcrumbs(),
      },
    });
  } catch {
    /* silencioso */
  }
}

/** Leer la política — defaults si falta la clave; JSON corrupto → defaults
 *  + evento warn (kit A1-C6). SSR/privaacidad → defaults. */
export function leerPolitica(): PoliticaDatos {
  let existia = false;
  try {
    const raw = window.localStorage.getItem(CLAVE_POLITICA);
    existia = raw != null;
    if (!raw) return { ...POLITICA_DEFAULT };
    const p = JSON.parse(raw) as Partial<PoliticaDatos>;
    if (typeof p !== "object" || p === null) throw new Error("no-objeto");
    return {
      metadatos: p.metadatos !== false, // default TRUE
      textoOcr: p.textoOcr === true, // default FALSE
      miniaturas: p.miniaturas === true, // default FALSE
      saludEnVivo: p.saludEnVivo !== false, // default TRUE
    };
  } catch (e) {
    // corrupta (JSON roto / no-objeto) → defaults + warn. Ausente (la
    // primera lectura o SSR) NO avisa — es el estado de fábrica.
    if (existia) {
      avisarObs(`e14-obs-politica corrupta → defaults (${String(e)})`, "PoliticaCorrupta");
    }
    return { ...POLITICA_DEFAULT };
  }
}

/** Guardar la política (kill switch de toggles del panel agente 2). */
export function guardarPolitica(p: PoliticaDatos): void {
  try {
    window.localStorage.setItem(CLAVE_POLITICA, JSON.stringify(p));
  } catch {
    /* silencioso */
  }
}

/** Modo dev (contrato: "on" | "off" — ausente ≡ off). */
export function leerModoDev(): boolean {
  try {
    return window.localStorage.getItem(CLAVE_MODO_DEV) === "on";
  } catch {
    return false;
  }
}

export function guardarModoDev(on: boolean): void {
  try {
    window.localStorage.setItem(CLAVE_MODO_DEV, on ? "on" : "off");
  } catch {
    /* silencioso */
  }
}

/** Overrides de flags — la MÁXIMA prioridad en leerFlags (kill switch
 *  manual del mantenedor, D6). JSON corrupto → {} silencioso. */
export function leerOverridesFlags(): Partial<FlagsApp> {
  try {
    const raw = window.localStorage.getItem(CLAVE_OVERRIDES);
    if (!raw) return {};
    const o = JSON.parse(raw) as Partial<FlagsApp>;
    if (typeof o !== "object" || o === null) return {};
    const limpio: Partial<FlagsApp> = {};
    if (typeof o.ocrThreadsTope === "number" && Number.isFinite(o.ocrThreadsTope)) {
      limpio.ocrThreadsTope = Math.max(1, Math.min(8, Math.round(o.ocrThreadsTope)));
    }
    if (typeof o.telemetriaSalud === "boolean") limpio.telemetriaSalud = o.telemetriaSalud;
    // 0.5/S3 (plan de remediación) — `endpointReportes` ya no pasa como cualquier
    // string: SOLO null (apagado), un https absoluto válido, o un http de ORIGEN
    // LOCAL (localhost / IP privada / `.local` mDNS — doctrina del hub-local; es
    // lo que usan los harnesses QA y lo que el CSP ya permite). `http://` ajeno
    // o basura ⇒ la clave NO se aplica (default null).
    if (o.endpointReportes === null) {
      limpio.endpointReportes = null;
    } else if (typeof o.endpointReportes === "string" && o.endpointReportes.trim()) {
      try {
        const u = new URL(o.endpointReportes);
        const local =
          u.hostname === "localhost" ||
          u.hostname.endsWith(".local") || // mDNS RFC 6762 — no enrutable
          /^(127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(u.hostname);
        if (u.protocol === "https:" || (u.protocol === "http:" && local)) {
          limpio.endpointReportes = o.endpointReportes;
        }
      } catch {
        /* basura → la clave no se aplica (default null) */
      }
    }
    // KIT e14-obs-hang-atribucion-v1 (§D) — el kill-switch `hangEnCurso` del
    // mantenedor pasa por ESTE whitelist: sin esta línea el override localStorage
    // (§G.3.d del smoke) sería inalcanzable (el override MANUAL es la
    // máxima prioridad, D6; el whitelist de leerOverridesFlags es
    // INDEPENDIENTE del de sanearFlags en flags.ts — cada puerta su línea).
    if (typeof o.hangEnCurso === "boolean") limpio.hangEnCurso = o.hangEnCurso;
    // KIT e14-orientacion-qr-v1 (§D) — mismo criterio (DOBLE whitelist).
    if (typeof o.qrBrujulaOrientacion === "boolean") limpio.qrBrujulaOrientacion = o.qrBrujulaOrientacion;
    // KIT e14-ocr-cascada-v1 (K3 fase 2) — mismo criterio (DOBLE whitelist).
    // Renombrado de `masivaOcrTesseract` al retirar el módulo masiva.
    if (typeof o.ocrCascada === "boolean") limpio.ocrCascada = o.ocrCascada;
    // KIT e14-adaptacion-dispositivo-v1 — mismo criterio (DOBLE whitelist):
    // el kill-switch {"adaptacionDispositivo": false} del mantenedor pasa por
    // ESTE whitelist (prioridad máxima, D6 — plan.ts ya lo respeta).
    if (typeof o.adaptacionDispositivo === "boolean") limpio.adaptacionDispositivo = o.adaptacionDispositivo;
    // KIT e14-ocr-tessbest-v1 (GO-B) — mismo criterio (DOBLE whitelist):
    // override MANUAL del presupuesto del escaneo (null o ms clampados).
    if (o.presupuestoEscaneoMs === null) limpio.presupuestoEscaneoMs = null;
    if (typeof o.presupuestoEscaneoMs === "number" && Number.isFinite(o.presupuestoEscaneoMs)) {
      limpio.presupuestoEscaneoMs = Math.max(30_000, Math.min(900_000, Math.round(o.presupuestoEscaneoMs)));
    }
    // KIT e14-probe-mini768-v1 — mismo criterio (DOBLE whitelist): el lado de la
    // miniatura del sondeo, clamp [320, 1280]. 320 = comportamiento anterior.
    if (typeof o.probeMiniLado === "number" && Number.isFinite(o.probeMiniLado)) {
      limpio.probeMiniLado = Math.max(320, Math.min(1280, Math.round(o.probeMiniLado)));
    }
    // KIT e14-heic-tope-v1 — mismo criterio (DOBLE whitelist). Acá 0 SÍ es un
    // valor válido y es justo el que el mantenedor usa como kill-switch: 0 = sin tope
    // / sin límite = el camino anterior. El clamp es [0, tope] por eso.
    if (typeof o.heicTopeMp === "number" && Number.isFinite(o.heicTopeMp)) {
      limpio.heicTopeMp = Math.max(0, Math.min(60, Math.round(o.heicTopeMp)));
    }
    if (typeof o.heicLimiteMs === "number" && Number.isFinite(o.heicLimiteMs)) {
      limpio.heicLimiteMs = Math.max(0, Math.min(110_000, Math.round(o.heicLimiteMs)));
    }
    // KIT e14-capa0-qr-worker-v1 y KIT e14-autoenvio-recorte-v1 — DOS puertas
    // que faltaban: sin su línea aquí, el override MANUAL (máxima prioridad,
    // D6) de esos dos flags era inalcanzable desde localStorage. Cada puerta
    // su línea — la convención del DOBLE whitelist, no opcional.
    if (typeof o.capa0QrWorker === "boolean") limpio.capa0QrWorker = o.capa0QrWorker;
    if (typeof o.autoEnvioConRecorte === "boolean") limpio.autoEnvioConRecorte = o.autoEnvioConRecorte;
    // ─── KIT e14-velocidad-5s-v1 — mismo criterio (DOBLE whitelist): las
    // ─── cuatro puertas del puesto rápido. Sin estas líneas el A/B en el
    // ─── celular (override localStorage) sería inalcanzable.
    if (typeof o.ladoMaxTrabajoPx === "number" && Number.isFinite(o.ladoMaxTrabajoPx)) {
      limpio.ladoMaxTrabajoPx = Math.max(1024, Math.min(4032, Math.round(o.ladoMaxTrabajoPx)));
    }
    if (typeof o.pisoEscenicoMs === "number" && Number.isFinite(o.pisoEscenicoMs)) {
      limpio.pisoEscenicoMs = Math.max(0, Math.min(1200, Math.round(o.pisoEscenicoMs)));
    }
    if (typeof o.ocrPrimeraPasadaRapida === "boolean") limpio.ocrPrimeraPasadaRapida = o.ocrPrimeraPasadaRapida;
    if (typeof o.importRutaCorta === "boolean") limpio.importRutaCorta = o.importRutaCorta;
    // ─── KIT e14-velocidad-5s-v1 (fase rec) — mismo criterio (DOBLE whitelist):
    // ─── sin estas líneas el A/B del tensor del rec en el celular sería
    // ─── inalcanzable (el override MANUAL es la máxima prioridad, D6).
    if (typeof o.ocrRecWmax === "number" && Number.isFinite(o.ocrRecWmax)) {
      limpio.ocrRecWmax = Math.max(160, Math.min(960, Math.round(o.ocrRecWmax)));
    }
    if (typeof o.ocrRecAltura === "number" && Number.isFinite(o.ocrRecAltura)) {
      limpio.ocrRecAltura = Math.max(24, Math.min(64, Math.round(o.ocrRecAltura / 4) * 4));
    }
    if (typeof o.ocrRecLote === "number" && Number.isFinite(o.ocrRecLote)) {
      limpio.ocrRecLote = Math.max(1, Math.min(12, Math.round(o.ocrRecLote)));
    }
    if (typeof o.ocrLeerBw === "boolean") limpio.ocrLeerBw = o.ocrLeerBw;
    if (typeof o.ocrRecSuave === "boolean") limpio.ocrRecSuave = o.ocrRecSuave;
    if (typeof o.ocrRecWfija === "boolean") limpio.ocrRecWfija = o.ocrRecWfija;
    if (typeof o.ocrRecCabecera === "number" && Number.isFinite(o.ocrRecCabecera)) {
      limpio.ocrRecCabecera = Math.max(0, Math.min(60, Math.round(o.ocrRecCabecera)));
    }
    if (typeof o.ocrRecPie === "number" && Number.isFinite(o.ocrRecPie)) {
      limpio.ocrRecPie = Math.max(0, Math.min(60, Math.round(o.ocrRecPie)));
    }
    if (typeof o.ocrRecBordesRescate === "number" && Number.isFinite(o.ocrRecBordesRescate)) {
      limpio.ocrRecBordesRescate = Math.max(0, Math.min(10, Math.round(o.ocrRecBordesRescate)));
    }
    if (typeof o.ladoOcrPx === "number" && Number.isFinite(o.ladoOcrPx)) {
      limpio.ladoOcrPx = Math.max(0, Math.min(4032, Math.round(o.ladoOcrPx)));
    }
    if (typeof o.cierreInstantaneo === "boolean") limpio.cierreInstantaneo = o.cierreInstantaneo;
    if (typeof o.qrBrujulaWarpPases === "number" && Number.isFinite(o.qrBrujulaWarpPases)) {
      limpio.qrBrujulaWarpPases = Math.max(0, Math.min(3, Math.round(o.qrBrujulaWarpPases)));
    }
    if (typeof o.ocrReOcrRoi === "boolean") limpio.ocrReOcrRoi = o.ocrReOcrRoi;
    if (typeof o.ocrSegundaTopeMs === "number" && Number.isFinite(o.ocrSegundaTopeMs)) {
      limpio.ocrSegundaTopeMs = Math.max(0, Math.min(120_000, Math.round(o.ocrSegundaTopeMs)));
    }
    // KIT e14-remediacion-movil-v1 (A1) — mismo criterio (DOBLE whitelist):
    // ventana de ARRANQUE de la 2.ª pasada como override MANUAL del mantenedor
    // (A/B del knob por tier sin rebuild — el punto 3 del ítem A1). Sin esta
    // línea el override localStorage sería inalcanzable (prioridad máxima, D6).
    if (o.ocrSegundaPresupuestoMs === null) limpio.ocrSegundaPresupuestoMs = null;
    if (typeof o.ocrSegundaPresupuestoMs === "number" && Number.isFinite(o.ocrSegundaPresupuestoMs)) {
      limpio.ocrSegundaPresupuestoMs = Math.max(5_000, Math.min(120_000, Math.round(o.ocrSegundaPresupuestoMs)));
    }
    // KIT e14-velocidad-5s-v1 — mismo criterio (DOBLE whitelist): el kill-switch
    // {"ocrCorteIncompleta": false} del rechazo temprano.
    if (typeof o.ocrCorteIncompleta === "boolean") limpio.ocrCorteIncompleta = o.ocrCorteIncompleta;
    // KIT fusion-evidencia-divipol-v1 (D89) — mismo criterio (DOBLE whitelist):
    // sin esta línea el kill-switch {"fusion_evidencia": true|false} del mantenedor
    // sería inalcanzable desde localStorage (prioridad máxima, D6).
    if (typeof o.fusion_evidencia === "boolean") limpio.fusion_evidencia = o.fusion_evidencia;
    // NOTA (eliminación del módulo masiva): las puertas de los 17 flags
    // exclusivos de la cola se retiraron junto con el módulo.
    return limpio;
  } catch {
    return {};
  }
}

export function guardarOverridesFlags(o: Partial<FlagsApp>): void {
  try {
    const actual = leerOverridesFlags();
    window.localStorage.setItem(CLAVE_OVERRIDES, JSON.stringify({ ...actual, ...o }));
  } catch {
    /* silencioso */
  }
}
