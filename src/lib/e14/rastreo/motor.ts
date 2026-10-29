/**
 * KIT e14-rastreo-tiempos-v1 — MOTOR del rastreo de tiempos.
 *
 * Observador PASIVO del ciclo real de digitalización: se suscribe al
 * useE14Store y cronometra «cómo lo usaría un usuario normal» SIN tocar
 * el pipeline, el gate, los scores ni ninguna regla de negocio (regla de
 * oro del repo: observación jamás altera el desenlace). Lo que mide:
 *
 *  · UNIDAD DE DIGITALIZACIÓN — captura → resuelto → revisión → decisión
 *    (enviada / escalada / dejada pendiente), con reintentos del mismo
 *    hueco agrupados en la MISMA unidad.
 *  · FASES del pipeline REAL (diagnóstico del bridge: decode/detect/
 *    calidad/ocr/proceso/total/envío) + revisión humana (pared).
 *  · NAVEGACIÓN — permanencia por vista y visitas (cómo se mueve el
 *    operador).
 *  · SESIÓN — todo lo anterior entre «activar» y «detener», con
 *    throughput (actas/hora).
 *
 * Persistencia: localStorage e14-rastreo-v1 (metadatos livianos — SIN
 * fotos/OCR/contenido; ids con hash fnv1a8). La sesión activa sobrevive a
 * recargas (el operador cierra el navegador a mitad de la prueba y al
 * volver sigue midiendo — mismo criterio de la jornada L6).
 *
 * Reacciones jamás lanzan: cualquier fallo del rastreo se traga en
 * silencio (§2.4 de obs — la app es idéntica con esto en marcha).
 */
import { useE14Store } from "../store";
import { fnv1a8 } from "../obs/identidad";
import type { Acta } from "../types";
import type {
  EventoRastreo,
  FuenteRastreo,
  HistorialRastreo,
  SesionRastreo,
  TiemposPipeline,
  UnidadRastreo,
} from "./tipos";
import { CAP_ACTAS, CAP_EVENTOS, CAP_SESIONES, CLAVE_RASTREO } from "./tipos";

// ─── Estado del módulo (module state — mismo patrón de operacion.ts) ────────

let instalado = false; // suscripción única (bootstrap idempotente)
let activo = false; // el rastreo SOLO corre cuando el dueño lo activa
let sesion: SesionRastreo | null = null;
let unidad: UnidadRastreo | null = null; // unidad EN CURSO (tsFin === null)

/** performance.now del disparo en curso (captura → resuelto). */
let t0Captura: number | null = null;
/** performance.now de la entrada a REVISIÓN con acta sin resolver. */
let tsRevision: number | null = null;
/** Vista en la que está parado el operador (dwell). */
let vistaActual: string | null = null;
let tsVista: number | null = null;

let ultimoPersistMs = 0;

// ─── Persistencia (localStorage — metadatos livianos) ───────────────────────

function vacio(): HistorialRastreo {
  return { version: 1, activa: null, cerradas: [] };
}

/** Carga el historial persistido (saneado — jamás confiar en storage). */
function cargar(): HistorialRastreo {
  try {
    const crudo = window.localStorage.getItem(CLAVE_RASTREO);
    if (!crudo) return vacio();
    const p = JSON.parse(crudo) as HistorialRastreo;
    if (p?.version !== 1 || !Array.isArray(p.cerradas)) return vacio();
    if (p.activa && (p.activa.version !== 1 || !Array.isArray(p.activa.actas))) {
      p.activa = null;
    }
    return p;
  } catch {
    return vacio();
  }
}

function persistir(inmediato = false): void {
  try {
    const ahora = Date.now();
    if (!inmediato && ahora - ultimoPersistMs < 2000) return; // throttle barato
    ultimoPersistMs = ahora;
    if (!sesion) return;
    const h = cargar();
    if (sesion.activa) {
      h.activa = sesion;
    } else {
      h.cerradas = [sesion, ...h.cerradas.filter((s) => s.id !== sesion!.id)].slice(0, CAP_SESIONES);
      // El puntero de sesión activa sale si ya no es una sesión VIVA (evita
      // duplicados y fantasmas en storage tras detener/archivar).
      if (h.activa && (h.activa.id === sesion.id || !h.activa.activa)) h.activa = null;
    }
    window.localStorage.setItem(CLAVE_RASTREO, JSON.stringify(h));
  } catch {
    /* modo privado / storage lleno → el rastreo vive en RAM */
  }
}

// ─── Helpers internos ───────────────────────────────────────────────────────

function evento(e: Omit<EventoRastreo, "t">): void {
  if (!sesion) return;
  sesion.eventos.push({ ...e, t: Date.now() });
  if (sesion.eventos.length > CAP_EVENTOS) {
    sesion.eventos = sesion.eventos.slice(-CAP_EVENTOS);
  }
}

function nuevaUnidad(ahoraTs: number): UnidadRastreo {
  return {
    idHash: "",
    fuente: "N/D",
    intentos: 0,
    statusFinal: "EN_PROCESO",
    enviada: false,
    autoEnvio: false,
    pipelineMs: null,
    revisionMs: null,
    totalMs: null,
    scoreFinal: null,
    pipelineInterno: null,
    statusPorIntento: [],
    maxIntentos: 4,
    tsInicio: ahoraTs,
    tsFin: null,
    sim: false,
  };
}

/** ¿El ciclo de la unidad abierta puede CONTINUAR con otra captura? —
 *  ESPEJO EXACTO del ciclo de repetición del store (§7): RECHAZADA
 *  continúa siempre; EN_REVISION_HUMANA solo «repetir-primero» (intento
 *  bajo el tope). OPTIMA/ADVERTENCIA/ENVIADA cerraron el ciclo. */
function cicloContinua(u: UnidadRastreo): boolean {
  const ultimo = u.statusPorIntento[u.statusPorIntento.length - 1];
  return (
    ultimo === "RECHAZADA" ||
    (ultimo === "EN_REVISION_HUMANA" && u.intentos < u.maxIntentos)
  );
}

/** Cierra la unidad en curso (empuja a la sesión y limpia el puntero).
 *  Idempotente: una unidad REABIERTA ya vive en sesion.actas (mismo
 *  objeto) — no se duplica. */
function cerrarUnidad(ahoraTs: number): void {
  if (!sesion || !unidad) return;
  unidad.tsFin = ahoraTs;
  unidad.totalMs = Math.max(0, ahoraTs - unidad.tsInicio);
  if (!sesion.actas.includes(unidad)) {
    sesion.actas.push(unidad);
    if (sesion.actas.length > CAP_ACTAS) {
      sesion.actas = sesion.actas.slice(-CAP_ACTAS);
    }
  }
  unidad = null;
  persistir(true);
}

/** Desglose interno REAL del último intento (DiagnosticoActa.tiempos). */
function extraerTiempos(acta: Acta): TiemposPipeline | null {
  const t = acta.diagnostico?.tiempos;
  if (!t) return null; // SIM nunca trae diagnóstico (§9.2) — honesto
  return {
    decodeMs: typeof t.decodeMs === "number" ? t.decodeMs : null,
    detectMs: typeof t.detectMs === "number" ? t.detectMs : null,
    calidadMs: typeof t.calidadMs === "number" ? t.calidadMs : null,
    ocrMs: typeof t.ocrMs === "number" ? t.ocrMs : null,
    procesoMs: typeof t.procesoMs === "number" ? t.procesoMs : null,
    totalMs: typeof t.totalMs === "number" ? t.totalMs : null,
    envioMs: typeof t.envioMs === "number" ? t.envioMs : null,
  };
}

/** Cierra el dwell de la vista actual (llamado al cambiar de vista o al
 *  detener la sesión). */
function cerrarDwell(ahoraPerf: number): void {
  if (!sesion || vistaActual === null || tsVista === null) return;
  const m = Math.max(0, Math.round(ahoraPerf - tsVista));
  const nav = sesion.navegacion[vistaActual] ?? { vista: vistaActual, ms: 0, visitas: 0 };
  nav.ms += m;
  sesion.navegacion[vistaActual] = nav;
}

/** Acumula dwell y anota la navegación en la línea de tiempo. */
function registrarNavegacion(desde: string, hacia: string, ahoraPerf: number): void {
  cerrarDwell(ahoraPerf);
  const m = vistaActual !== null && tsVista !== null ? Math.max(0, Math.round(ahoraPerf - tsVista)) : 0;
  evento({ tipo: "navegacion", detalle: `${desde} → ${hacia}`, ms: m });
  vistaActual = hacia;
  tsVista = ahoraPerf;
  if (sesion) {
    const entrada = sesion.navegacion[hacia] ?? { vista: hacia, ms: 0, visitas: 0 };
    entrada.visitas += 1;
    sesion.navegacion[hacia] = entrada;
  }
}

// ─── Procesador de transiciones del store (corazón del motor) ───────────────

function procesar(s: ReturnType<typeof useE14Store.getState>, prev: ReturnType<typeof useE14Store.getState>): void {
  if (!sesion) return;
  const ahoraPerf = performance.now();
  const ahoraTs = Date.now();

  // ── SIM encendido/apagado (contexto de la sesión) ──
  if (s.modoSimulacion !== prev.modoSimulacion) {
    sesion.conSim = sesion.conSim || s.modoSimulacion;
    evento({ tipo: "sim", detalle: s.modoSimulacion ? "SIM ENCENDIDO" : "SIM APAGADO", ms: null });
  }

  // ── Mesa archivada (hueco OK/RESCANEO → solo cuenta, sin contenido) ──
  const nPrev = Object.keys(prev.archivadas).length;
  const nNow = Object.keys(s.archivadas).length;
  if (nNow > nPrev) {
    evento({ tipo: "archivo-mesa", detalle: `HUECO ARCHIVADO (+${nNow - nPrev})`, ms: null });
  }

  // ── Cambio de vista ──
  if (s.vista !== prev.vista) {
    // Salgo de REVISIÓN con unidad abierta → SE CIERRA (los KPIs cuentan lo
    // cerrado). Si su ciclo puede continuar (RECHAZADA/EN_RH «repetir-
    // primero»), la unidad queda REABRIBLE: el próximo disparo con la MISMA
    // acta previa (mismo idHash + mismo ciclo del store §7) la reabre — el
    // grupo de reintentos se conserva sin dejar unidades fantasma abiertas.
    if (unidad && unidad.tsFin === null && prev.vista === "revision" && s.vista !== "revision") {
      if (tsRevision !== null) {
        unidad.revisionMs = Math.max(0, Math.round(ahoraPerf - tsRevision));
      }
      cerrarUnidad(ahoraTs);
    }
    registrarNavegacion(prev.vista, s.vista, ahoraPerf);
    persistir();
  }

  // ── Entrada a REVISIÓN con acta sin resolver → arranca el reloj de
  //    revisión humana (auto-envío entra con ENVIADA ya puesto: excluido) ──
  if (
    s.vista === "revision" &&
    prev.vista !== "revision" &&
    s.actaActual &&
    s.actaActual.status !== "ENVIADA"
  ) {
    tsRevision = ahoraPerf;
  }

  // ── INICIO DE CAPTURA (dispararEscaneo: vista→analizando + acta nula) ──
  if (s.vista === "analizando" && prev.vista !== "analizando" && s.actaActual === null) {
    t0Captura = ahoraPerf;
    tsRevision = null;
    if (!unidad || unidad.tsFin !== null) {
      // ¿REINTENTO de la unidad recién cerrada? El store continúa el ciclo
      // cuando el acta previa sigue RECHAZADA/EN_RH-bajo-tope (§7) — si la
      // ÚLTIMA cerrada es ESE MISMO acta (idHash), se REABRE (mismo grupo).
      const previa = prev.actaActual;
      const ultima = sesion.actas[sesion.actas.length - 1];
      const continuaPrevio =
        !!previa &&
        (previa.status === "RECHAZADA" ||
          (previa.status === "EN_REVISION_HUMANA" && previa.intento < previa.maxIntentos));
      if (
        continuaPrevio &&
        previa &&
        ultima &&
        ultima.tsFin !== null &&
        ultima.idHash !== "" &&
        ultima.idHash === fnv1a8(previa.id)
      ) {
        unidad = ultima; // REABRE (mismo objeto en sesion.actas)
        unidad.tsFin = null;
      } else {
        unidad = nuevaUnidad(ahoraTs); // ciclo nuevo
      }
    } else if (!cicloContinua(unidad)) {
      // Unidad abierta pero su ciclo YA se cerró (ADVERTENCIA sin decisión
      // que quedó en el aire, etc.) → se cierra con su desenlace y nace una.
      cerrarUnidad(ahoraTs);
      unidad = nuevaUnidad(ahoraTs);
    } // si cicloContinua → REINTENTO de la MISMA unidad (intento lo pone el
      // desenlace con statusPorIntento.push)
    const reintento = unidad.intentos > 0;
    evento({ tipo: "captura", detalle: reintento ? `REINTENTO ${unidad.intentos + 1}` : "CAPTURA", ms: null });
    persistir(true);
    return; // nada más que procesar en este set (acta es null)
  }

  // ── RESOLUCIÓN del pipeline (acta null → acta real con analisisResuelto) ──
  if (prev.actaActual === null && s.actaActual !== null && unidad && unidad.tsFin === null) {
    unidad.pipelineMs = t0Captura !== null ? Math.max(0, Math.round(ahoraPerf - t0Captura)) : null;
    const fuenteActa = (s.actaActual.fuente ?? "N/D") as FuenteRastreo;
    unidad.fuente = fuenteActa;
    unidad.sim = fuenteActa === "SIMULACION";
    unidad.scoreFinal = s.actaActual.score;
    unidad.pipelineInterno = extraerTiempos(s.actaActual);
    if (!unidad.idHash && s.actaActual.id) unidad.idHash = fnv1a8(s.actaActual.id);
    if (typeof s.actaActual.maxIntentos === "number" && s.actaActual.maxIntentos > 0) {
      unidad.maxIntentos = s.actaActual.maxIntentos;
    }
    unidad.statusPorIntento.push(s.actaActual.status);
    unidad.intentos = unidad.statusPorIntento.length;
    unidad.statusFinal = s.actaActual.status;
    evento({
      tipo: "desenlace",
      detalle: `${s.actaActual.status} (intento ${unidad.intentos})`,
      ms: unidad.pipelineMs,
    });
    if (s.actaActual.status === "RECHAZADA") {
      evento({ tipo: "rescaneo", detalle: "RECHAZADA → RE-ESCANEO", ms: null });
    }
    t0Captura = null;
    persistir(true);
  }

  // ── Cambios de desenlace SIN re-captura (escalación/panel/corrección) ──
  const stPrev = prev.actaActual?.status;
  const stNow = s.actaActual?.status;
  if (unidad && unidad.tsFin === null && stPrev && stNow && stPrev !== stNow) {
    unidad.statusFinal = stNow;
    if (stNow === "EN_REVISION_HUMANA") {
      evento({ tipo: "revision-humana", detalle: "ESCALADA A REVISIÓN HUMANA", ms: null });
    }
  }

  // ── ENVÍO (auto por ÓPTIMA o manual del operador) — desenlace terminal ──
  if (stPrev !== "ENVIADA" && stNow === "ENVIADA" && unidad && unidad.tsFin === null) {
    const huboRevision = tsRevision !== null;
    unidad.revisionMs =
      tsRevision !== null ? Math.max(0, Math.round(ahoraPerf - tsRevision)) : null;
    unidad.enviada = true;
    unidad.autoEnvio = !huboRevision;
    unidad.statusFinal = "ENVIADA";
    unidad.scoreFinal = s.actaActual?.score ?? unidad.scoreFinal;
    const envioMs = s.actaActual?.diagnostico?.tiempos?.envioMs;
    if (unidad.pipelineInterno && typeof envioMs === "number") {
      unidad.pipelineInterno.envioMs = envioMs;
    }
    evento({
      tipo: "envio",
      detalle: unidad.autoEnvio ? "ENVÍO AUTOMÁTICO (ÓPTIMA)" : "ENVÍO MANUAL",
      ms: unidad.pipelineInterno?.envioMs ?? null,
    });
    tsRevision = null;
    cerrarUnidad(ahoraTs);
  }
}

// ─── API pública (el PanelDev consume SOLO esto) ────────────────────────────

/** Bootstrap (idempotente — el shell lo llama una vez): instala la
 *  suscripción y RETOMA una sesión activa si quedó de una recarga. No
 *  inicia sesiones nuevas por su cuenta. */
export function iniciarRastreo(): void {
  if (instalado || typeof window === "undefined") return;
  instalado = true;
  try {
    useE14Store.subscribe((s, prev) => {
      if (!activo) return;
      try {
        procesar(s, prev);
      } catch {
        /* el rastreo jamás rompe la app (§2.4) */
      }
    });
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "hidden") persistir(true);
    });
    // Retomar sesión activa (recarga a mitad de la prueba).
    const h = cargar();
    if (h.activa && h.activa.activa) {
      sesion = h.activa;
      activo = true;
      vistaActual = useE14Store.getState().vista;
      tsVista = performance.now();
    }
  } catch {
    /* silencioso */
  }
}

/** Activa el rastreo: retoma la sesión activa si existe, o abre una nueva.
 *  Devuelve la sesión en curso. */
export function activarRastreo(): SesionRastreo | null {
  try {
    if (!instalado) iniciarRastreo();
    const h = cargar();
    if (h.activa && h.activa.activa) {
      sesion = h.activa; // retoma (recarga a mitad de prueba)
    } else if (!sesion || !sesion.activa) {
      sesion = {
        version: 1,
        id: `r-${Date.now()}-${Math.floor(Math.random() * 0xffff).toString(16)}`,
        inicio: Date.now(),
        fin: null,
        activa: true,
        actas: [],
        navegacion: {},
        eventos: [{ t: Date.now(), tipo: "sesion", detalle: "RASTREO ACTIVADO", ms: null }],
        conSim: false,
      };
    } else {
      sesion.activa = true;
    }
    activo = true;
    vistaActual = useE14Store.getState().vista;
    tsVista = performance.now();
    evento({ tipo: "sesion", detalle: "RASTREO ACTIVADO", ms: null });
    persistir(true);
    return sesion;
  } catch {
    return null;
  }
}

/** Detiene el rastreo: cierra unidad/dwell abiertos, sella la sesión y la
 *  archiva en el historial (quedará disponible para los informes). */
export function detenerRastreo(): void {
  try {
    if (!sesion) {
      activo = false;
      return;
    }
    const ahoraPerf = performance.now();
    const ahoraTs = Date.now();
    if (unidad && unidad.tsFin === null) cerrarUnidad(ahoraTs); // deja lo que haya
    cerrarDwell(ahoraPerf);
    tsRevision = null;
    t0Captura = null;
    evento({ tipo: "sesion", detalle: "RASTREO DETENIDO", ms: null });
    sesion.activa = false;
    sesion.fin = ahoraTs;
    activo = false;
    persistir(true);
    sesion = null; // la sesión vive en storage (cerradas)
    vistaActual = null;
    tsVista = null;
  } catch {
    /* silencioso */
  }
}

/** ¿El rastreo está corriendo en este momento? */
export function estaActivo(): boolean {
  return activo && sesion?.activa === true;
}

/** Fase EN VIVO (para el cronómetro del panel — lectura barata, sin React). */
export interface FaseRastreo {
  /** Vista donde está parado el operador. */
  vista: string;
  /** ms de permanencia en la vista actual. */
  msVista: number | null;
  /** ¿Hay una unidad de digitalización abierta? */
  unidadAbierta: boolean;
  /** Fase de la unidad abierta: PIPELINE (captura→resuelto) o REVISIÓN. */
  fase: "PIPELINE" | "REVISIÓN" | "—";
  /** ms de la fase actual. */
  msFase: number | null;
  intentosUnidad: number;
}

export function faseActual(): FaseRastreo {
  const vista = useE14Store.getState().vista;
  const ahora = performance.now();
  const base: FaseRastreo = {
    vista,
    msVista: tsVista !== null ? Math.max(0, Math.round(ahora - tsVista)) : null,
    unidadAbierta: unidad !== null && unidad.tsFin === null,
    fase: "—",
    msFase: null,
    intentosUnidad: unidad?.intentos ?? 0,
  };
  if (!base.unidadAbierta) return base;
  if (t0Captura !== null) {
    base.fase = "PIPELINE";
    base.msFase = Math.max(0, Math.round(ahora - t0Captura));
  } else if (tsRevision !== null) {
    base.fase = "REVISIÓN";
    base.msFase = Math.max(0, Math.round(ahora - tsRevision));
  }
  return base;
}

/** Sesión en curso (referencia viva — la UI la copia al render). */
export function sesionActiva(): SesionRastreo | null {
  return sesion;
}

/** Sesiones cerradas (historial — la más reciente primero). */
export function sesionesCerradas(): SesionRastreo[] {
  try {
    return cargar().cerradas;
  } catch {
    return [];
  }
}

/** Borra TODO (sesión activa + historial). El rastreo se apaga. */
export function descartarRastreo(): void {
  try {
    if (activo) detenerRastreo();
    window.localStorage.removeItem(CLAVE_RASTREO);
  } catch {
    /* silencioso */
  }
  sesion = null;
  unidad = null;
  activo = false;
}
