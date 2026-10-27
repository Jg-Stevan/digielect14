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
export const CLAVE_MODO_DEV = "e14-dev-mode";
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
    if (o.poolWorkers === 1 || o.poolWorkers === 2) limpio.poolWorkers = o.poolWorkers;
    if (typeof o.thumbsOn === "boolean") limpio.thumbsOn = o.thumbsOn;
    // cola-persistente-v1 (ANEXO Agente B): el override del dueño pasa por
    // ESTE whitelist — sin esta línea el MODO PRUEBAS (colaPersistente:false)
    // sería inalcanzable vía e14-flags-overrides.
    if (typeof o.colaPersistente === "boolean") limpio.colaPersistente = o.colaPersistente;
    if (typeof o.ocrThreadsTope === "number" && Number.isFinite(o.ocrThreadsTope)) {
      limpio.ocrThreadsTope = Math.max(1, Math.min(8, Math.round(o.ocrThreadsTope)));
    }
    if (typeof o.telemetriaSalud === "boolean") limpio.telemetriaSalud = o.telemetriaSalud;
    if (o.endpointReportes === null || typeof o.endpointReportes === "string") {
      limpio.endpointReportes = o.endpointReportes;
    }
    // KIT e14-obs-hang-atribucion-v1 (§D) — el kill-switch `hangEnCurso` del
    // dueño pasa por ESTE whitelist: sin esta línea el override localStorage
    // (§G.3.d del smoke) sería inalcanzable — mismo criterio de
    // colaPersistente arriba (el override MANUAL es la máxima prioridad, D6).
    if (typeof o.hangEnCurso === "boolean") limpio.hangEnCurso = o.hangEnCurso;
    // KIT e14-dhash-resize-v1 (§D — parche P3) — mismo criterio: sin esta
    // línea el override localStorage de `dhashResize` sería inalcanzable
    // (el whitelist de leerOverridesFlags es INDEPENDIENTE del de
    // sanearFlags en flags.ts — cada puerta necesita su línea).
    if (typeof o.dhashResize === "boolean") limpio.dhashResize = o.dhashResize;
    // W1 (KIT k1-obs-prioridad — brief Agente A) — mismo criterio: sin esta
    // línea el override localStorage de `masivaPrioridad` sería inalcanzable
    // (DOBLE whitelist — cada puerta necesita su línea, lección dhashResize).
    if (typeof o.masivaPrioridad === "boolean") limpio.masivaPrioridad = o.masivaPrioridad;
    // KIT flujo-dueno-v1 (K2 — brief Agente B) — mismo criterio: sin estas
    // líneas los overrides localStorage de los kill-switches K2 serían
    // inalcanzables (el whitelist de leerOverridesFlags es INDEPENDIENTE del
    // de sanearFlags en flags.ts — cada puerta necesita su línea).
    if (typeof o.masivaWarpIngesta === "boolean") limpio.masivaWarpIngesta = o.masivaWarpIngesta;
    if (typeof o.masivaRotacionQr === "boolean") limpio.masivaRotacionQr = o.masivaRotacionQr;
    if (typeof o.masivaSondeoCrudo === "boolean") limpio.masivaSondeoCrudo = o.masivaSondeoCrudo;
    // KIT e14-ocr-cascada-v1 (K3 fase 2) — mismo criterio: sin esta línea
    // el override localStorage de `masivaOcrTesseract` sería inalcanzable.
    if (typeof o.masivaOcrTesseract === "boolean") limpio.masivaOcrTesseract = o.masivaOcrTesseract;
    // KIT e14-solo-warp-qr-v1 (prueba de consola del dueño) — mismo criterio:
    // sin esta línea el override localStorage de `sondeoQrPrecoz` (kill-switch
    // e73) sería inalcanzable — ya estaba en el whitelist de sanearFlags
    // (flags.ts) pero FALTABA ESTA puerta (DOBLE whitelist — cada puerta su
    // línea, lección dhashResize). Con el override en false el dueño apaga el
    // sondeo de ingesta para aislar la hambruna de CPU en pruebas dry run.
    if (typeof o.sondeoQrPrecoz === "boolean") limpio.sondeoQrPrecoz = o.sondeoQrPrecoz;
    // KIT e14-solo-warp-qr-v1 (DRY RUN del dueño) — mismo criterio: sin esta
    // línea el override localStorage de `masivaSoloWarpQr` (toggle SOLO QR de
    // MASIVA) sería inalcanzable (DOBLE whitelist — cada puerta su línea).
    if (typeof o.masivaSoloWarpQr === "boolean") limpio.masivaSoloWarpQr = o.masivaSoloWarpQr;
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
