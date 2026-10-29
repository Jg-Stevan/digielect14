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
import { appendEvento } from "./buffer";
import { digestDe } from "./digest";
import { obtenerBreadcrumbs } from "./breadcrumbs";
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
 *  manual del dueño, D6). JSON corrupto → {} silencioso. */
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
    if (o.endpointReportes === null || typeof o.endpointReportes === "string") {
      limpio.endpointReportes = o.endpointReportes;
    }
    // KIT e14-obs-hang-atribucion-v1 (§D) — el kill-switch `hangEnCurso` del
    // dueño pasa por ESTE whitelist: sin esta línea el override localStorage
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
    // el kill-switch {"adaptacionDispositivo": false} del dueño pasa por
    // ESTE whitelist (prioridad máxima, D6 — plan.ts ya lo respeta).
    if (typeof o.adaptacionDispositivo === "boolean") limpio.adaptacionDispositivo = o.adaptacionDispositivo;
    // KIT e14-ocr-tessbest-v1 (GO-B) — mismo criterio (DOBLE whitelist):
    // override MANUAL del presupuesto del escaneo (null o ms clampados).
    if (o.presupuestoEscaneoMs === null) limpio.presupuestoEscaneoMs = null;
    if (typeof o.presupuestoEscaneoMs === "number" && Number.isFinite(o.presupuestoEscaneoMs)) {
      limpio.presupuestoEscaneoMs = Math.max(30_000, Math.min(900_000, Math.round(o.presupuestoEscaneoMs)));
    }
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
