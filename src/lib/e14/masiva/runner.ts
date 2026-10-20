"use client";

/**
 * KIT e14-carga-masiva-v1 (T2): motor SECUENCIAL del módulo MASIVA — UNA
 * foto a la vez, SIEMPRE. Por qué secuencial y no en paralelo: el OCR es
 * wasm mono-hilo (GH Pages sin SAB — AUDITORIA §2); dos OCR en paralelo se
 * reparten el mismo CPU → NO hay ganancia y la UI sí sufre. Secuencial =
 * throughput máximo real (~1 acta / 15-18 s → 100 actas ≈ 25-30 min).
 *
 * REGLA DE ORO (kit §0): llama getBridge().escanearActa(...) igual que la
 * app normal — MISMO pipeline, MISMO gate, MISMO desenlace. Nunca escribe
 * actaActual, nunca navega vistas, NUNCA simula. La orquestación vive aquí;
 * el store del flujo normal solo ve las 3 acciones de integración (T3).
 */
import { getBridge } from "../get-bridge";
// KIT e14-masiva-ux-v1 (T4): tipo con el presupuesto de timeout opcional
// (intersección LOCAL en el bridge — kit §1 prohíbe tocar bridge.ts).
// KIT e14-masiva-tiempos-v1 (PR-2): precargarDecodeArchivo — MISMA memo
// WeakMap del pipeline: el prefetch comparte la instancia del File y el
// decode de la fila N+1 golpea HIT (~0 ms) cuando le toca.
import { precargarDecodeArchivo, type OpcionesEscaneoConTimeout } from "../scanner-core-bridge";
import { useE14Store } from "../store";
import { guardarRegistro, leerRegistro } from "./cola";
import { useMasivaStore } from "./store";
import { clasificarOrigenDeArchivo } from "./origen"; // D63-A — detector de origen (kit e63a-origen-escaneo-v1)
import { paginaDeActa, tituloDeActa, type FilaMasiva, type RegistroMasiva } from "./tipos";
import type { ProgresoAnalisis } from "../types";

/** KIT e14-masiva-ux-v1 (T4): presupuesto del pipeline en MASIVA — 120 s.
 *  Masiva es cola de fondo (no bloquea la UI): con multihilo el pipeline
 *  real tarda ~21 s (informe Vercel del dueño 19/10) y el default de 15 s
 *  falsamente RECHAZADA cada acta con el resultado real descartándose (y el
 *  runner solapando N pipelines compitiendo por CPU). El flujo individual
 *  sigue en 15 s (default de escanearActa); el timeout REAL (>120 s) sigue
 *  resolviendo RECHAZADA «TIEMPO DE PROCESADO EXCEDIDO». */
const TIMEOUT_MASIVA_MS = 120_000;

/** Throttle del progreso (~200 ms — kit §4 regla 3): el OCR emite decenas
 *  de eventos por etapa; la bandeja solo necesita el último. */
const PROGRESO_MS = 200;

let corriendoFlag = false;
let stopFlag = false;
let ultimoProgresoEn = 0;

/** Patch INMUTABLE de UNA fila (la bandeja pinta filas livianas). */
function marcarFila(id: string, patch: Partial<FilaMasiva>): void {
  const filas = useMasivaStore.getState().filas;
  useMasivaStore.setState({
    filas: filas.map((f) => (f.id === id ? { ...f, ...patch } : f)),
  });
}

function progresoThrottled(id: string, p: ProgresoAnalisis): void {
  const ahora = Date.now();
  if (ahora - ultimoProgresoEn < PROGRESO_MS) return;
  ultimoProgresoEn = ahora;
  useMasivaStore.setState({ progreso: { id, etapa: p.etapa, fraccion: p.progreso } });
}

/** Thumb de la bandeja: canvas 2d, lado mayor 320, JPEG 0.7 (kit §4 regla 4).
 *  Con loadImageMemo NO (el thumb es una foto distinta; decode directo y
 *  fuera — la RAM muere con el canvas). También lo usa el mini-store al
 *  re-sincronizar un acta editada en REVISIÓN (thumb fresco tras recorte). */
export async function hacerThumb(
  dataUrl: string | null | undefined,
): Promise<string | undefined> {
  if (!dataUrl) return undefined;
  try {
    const img = new Image();
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error("THUMB_NO_DECODE"));
      img.src = dataUrl;
    });
    const ladoMayor = Math.max(img.naturalWidth, img.naturalHeight) || 1;
    const escala = Math.min(1, 320 / ladoMayor);
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(img.naturalWidth * escala));
    canvas.height = Math.max(1, Math.round(img.naturalHeight * escala));
    const ctx = canvas.getContext("2d");
    if (!ctx) return undefined;
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/jpeg", 0.7);
  } catch {
    return undefined; // thumb es cosmético — nunca tumba el desenlace
  }
}

function motivoCorto(err: unknown): string {
  const crudo = err instanceof Error ? err.message : String(err);
  const corto = crudo.replace(/\s+/g, " ").trim().slice(0, 48);
  return (corto || "ERROR DEL PIPELINE").toUpperCase();
}

/** Siguiente PENDIENTE o DUPLICADA (FIFO por agregadaEn) — el ORDEN vive en
 *  las filas livianas (mini-store), los DATOS viven en IDB (leerRegistro
 *  uno-a-uno). Las filas temporales (copia a IDB aún en vuelo — «GUARDANDO
 *  N…») se saltan: su id real llega al resolver agregarLote y el loop las
 *  toma en la siguiente pasada. KIT e14-masiva-tiempos-v1 (PR-1): las
 *  DUPLICADAS ENTRAN al loop — su procesamiento es la copia rápida (<1 s). */
function siguientePendiente(): FilaMasiva | null {
  const pendientes = useMasivaStore
    .getState()
    .filas.filter(
      (f) =>
        (f.estado === "PENDIENTE" || f.estado === "DUPLICADA") &&
        !f.id.startsWith("masiva-temp-"),
    )
    .sort((a, b) => a.agregadaEn - b.agregadaEn);
  return pendientes[0] ?? null;
}

/** KIT e14-masiva-tiempos-v1 (PR-1): la fila DUPLICADA REUTILIZA el resultado
 *  de su original (kit §2 — copia registro+status+thumb, sin pipeline, sin
 *  contadores: el desenlace del acta gemela YA fue registrado con la
 *  original). El acta copiada se RE-IDENTIFICA con el id de ESTA fila
 *  (contrato de sincronizarAlVolver: acta.id === id de la fila abierta).
 *  Devuelve false ante CUALQUIER falta (original quitada/ERROR/sin acta) →
 *  la fila cae al reproceso completo — jamás inventar. */
async function reutilizarResultado(fila: FilaMasiva, t0: number): Promise<boolean> {
  if (!fila.dupOf) return false;
  try {
    const [registro, original] = await Promise.all([
      leerRegistro(fila.id),
      leerRegistro(fila.dupOf),
    ]);
    const actaOrigen = original.acta;
    if (!actaOrigen) return false; // original sin desenlace (ERROR/en vuelo)
    if (!useMasivaStore.getState().filas.some((f) => f.id === fila.id)) return false;
    const actaCopia = { ...actaOrigen, id: fila.id };
    const registroListo: RegistroMasiva = {
      ...registro,
      estado: "LISTA",
      acta: actaCopia,
      thumb: original.thumb,
      // D59 — KIT e14-info-acta-filas-v1 (T2): la gemela ES el mismo acta →
      // mismo título (honesto — copia el desenlace, copia la info).
      infoTitulo: tituloDeActa(actaCopia),
      hashDedup: registro.hashDedup,
      dupOf: fila.dupOf,
    };
    await guardarRegistro(registroListo);
    const ms = Date.now() - t0;
    console.info(
      `[e14] dedup fila=${fila.id} dupOf=${fila.dupOf} reutiliza score=${actaCopia.score ?? "-"} ms=${ms}`,
    );
    marcarFila(fila.id, {
      estado: "LISTA",
      statusActa: actaCopia.status,
      score: actaCopia.score,
      nivel: actaCopia.clasificacion?.nivel ?? null,
      pagina: paginaDeActa(actaCopia),
      infoTitulo: tituloDeActa(actaCopia), // D59 — KIT e14-info-acta-filas-v1 (T2)
      motivo: actaCopia.rechazo?.tipo ?? null,
      thumb: original.thumb,
      enviadaAuto: actaCopia.status === "ENVIADA" && !!actaCopia.enviadoAutomaticamente,
      envioEnCola: actaCopia.hashSha256 === "EN COLA",
      error: null,
    });
    return true;
  } catch {
    return false; // original fuera de la cola / IDB caído → reprocesa completo
  }
}

/** Desenlace de UNA foto — byte a byte el pipeline real (kit §6-C: el
 *  desenlace DEBE ser idéntico al del IMPORTAR normal).
 *  KIT e14-masiva-tiempos-v1 (PR-2): `archivoPredecode` = la MISMA instancia
 *  de File que el prefetch ya decodificó (memo HIT, decode ~0 ms) — null si
 *  no hubo prefetch (decode de siempre, identidad intacta AC-P3). */
async function procesarUno(
  filaEntrante: FilaMasiva,
  archivoPredecode: File | null = null,
): Promise<void> {
  // KIT e14-masiva-tiempos-v1 (PR-1): rama DEDUP — copia del resultado de la
  // original (<1 s). Si la original no sirve, la fila cae al pipeline
  // completo AQUÍ MISMO (fallback honesto — el dueño nunca pierde la foto).
  let fila = filaEntrante;
  if (fila.estado === "DUPLICADA") {
    marcarFila(fila.id, { estado: "PROCESANDO", error: null });
    const t0 = Date.now();
    if (await reutilizarResultado(fila, t0)) return;
    // Fallback: des-marcar y reprocesar como fila normal (mismo pase).
    fila = { ...fila, estado: "PENDIENTE", dupOf: null };
    marcarFila(fila.id, { estado: "PENDIENTE", dupOf: null });
    try {
      const registro = await leerRegistro(fila.id);
      await guardarRegistro({ ...registro, estado: "PENDIENTE", dupOf: undefined });
    } catch {
      /* IDB caído — la fila ya está PENDIENTE en memoria (honesto) */
    }
    console.info(`[e14] dedup fila=${fila.id} sin-original reprocesa-completo`);
  }
  marcarFila(fila.id, { estado: "PROCESANDO", error: null });
  useMasivaStore.setState({ progreso: { id: fila.id, etapa: "DETECTANDO", fraccion: 0 } });
  let registro: RegistroMasiva | null = null;
  try {
    registro = await leerRegistro(fila.id);
    const archivo = registro.archivo;
    // IDB clona el File original (sigue siendo File — structured clone de
    // File API). El guard honesto evita alimentar al bridge con un Blob
    // genérico (OpcionesEscaneo.archivo espera File — A5).
    if (!(archivo instanceof File)) throw new Error("ARCHIVO_FUERA_DE_LA_COLA");

    // KIT e14-masiva-tiempos-v1 (PR-2): si el prefetch ya decodificó ESTA
    // fila, pasar la MISMA instancia del File → el pipeline golpea la memo
    // del bridge (decode ~0 ms — AC-P1). Sin prefetch → el archivo de
    // SIEMPRE (identidad de desenlace intacta, AC-P3).
    const archivoPipeline = archivoPredecode ?? archivo;

    // D63-A — KIT e63a-origen-escaneo-v1 (punto ÚNICO del kit, T1/T2):
    // origen del archivo — detector heurístico conservador (origen.ts),
    // calculado UNA vez por fila AL INICIO del pipeline. SOLO visibilidad:
    // no alimenta score/gate (calibra D63-B/D63-C). Falla → null (el
    // detector jamás tumba el pipeline). Traza aditiva propia (contrato
    // D51: solo-AÑADIR) + campos en el diagnóstico (parche D57 de abajo).
    const veredictoOrigen = await clasificarOrigenDeArchivo(archivoPipeline);
    console.info(
      `[e14] origen=${veredictoOrigen.origen ?? "null"} senales=${veredictoOrigen.senales ?? "null"}`,
    );

    // T4: variable tipada con la intersección (sin excess-check de literal —
    // el parámetro de la interfaz E14Bridge sigue siendo OpcionesEscaneo).
    const opcionesMasiva: OpcionesEscaneoConTimeout = {
      objetivo: null, // A4 — la clasificación REAL manda (viene del OCR)
      intento: 1, // A6 — semántica de PRIMERA captura
      maxIntentos: 4, // fallos → RECHAZADA repetible / rescate por recorte manual
      fuente: "ARCHIVO", // A5 — MASIVA SIEMPRE archivo
      archivo: archivoPipeline,
      onProgreso: (p) => progresoThrottled(fila.id, p),
      timeoutMs: TIMEOUT_MASIVA_MS, // T4 — ver constante (individual: 15 s intacto)
    };
    // D57 — KIT e14-instrumentos-espera-v1 (T1): espera en cola → inicio del
    // pipeline. tInicio capturado JUSTO ANTES de escanearActa (kit §4-T1):
    // esperaMs = tInicio − fila.agregadaEn (≥ 0 defensivo — jamás inventar).
    // SOLO masiva lo llena (el flujo individual no tiene espera de cola).
    const tInicio = Date.now();
    const esperaMs = Math.max(0, tInicio - fila.agregadaEn);
    const actaBruta = await getBridge().escanearActa(opcionesMasiva);
    // D57 (T1): parche INMUTABLE del diagnóstico (kit §4-T1). ADITIVO — no
    // toca score/status/gate; si el diagnóstico no existe (no debería: el
    // bridge lo monta en todo desenlace fuera de SIM), se omite el campo.
    // D63-A (T2): las trazas de origen viajan en el MISMO parche (aditivas,
    // al final del contrato D57 — origen/origenSenales, ver origen.ts).
    const acta =
      actaBruta.diagnostico != null
        ? {
            ...actaBruta,
            diagnostico: {
              ...actaBruta.diagnostico,
              tiempos: { ...actaBruta.diagnostico.tiempos, esperaMs },
              origen: veredictoOrigen.origen,
              origenSenales: veredictoOrigen.senales,
            },
          }
        : actaBruta;

    // FIX M8 (auditoría 2-c): la decisión del dueño manda TAMBIÉN para el
    // ENVÍO — si quitó la fila mientras el OCR corría, el desenlace NO se
    // transmite (antes registrarEnvioMasiva corría ANTES del guard: fila de
    // historial + completadas + hueco archivado de un acta descartado).
    if (!useMasivaStore.getState().filas.some((f) => f.id === fila.id)) return;

    // Desenlace → la MISMA vía que el flujo normal (T3.3/T3.2). El envío
    // automático reutiliza registrarEnvio (historial + completadas + hueco
    // archivado + cola offline); el resto cae al contador T5 con las
    // MISMAS claves.
    let actaFinal = acta;
    let enviadaAuto = false;
    // D61 — KIT e14-tiempos-ocultos-v1 (T3): coste del ENVÍO del desenlace —
    // registrarEnvioMasiva (hash + historial + completadas + hueco archivado +
    // cola offline; la sección síncrona del envío). SOLO hay envío real ONLINE:
    // offline/EN COLA y no-OPTIMA → campo OMITIDO (jamás 0 falso — kit §2-T3).
    let envioMs: number | null = null;
    if (acta.status === "OPTIMA") {
      // KIT e14-masiva-ux-v1 (T3.2): el envío respeta la conexión del momento
      // (misma semántica que registrarEnvio para actaActual): OFFLINE →
      // hashSha256 "EN COLA" — la fila pinta «EN COLA» y refrescarEnviosTrasDrenaje
      // la drena al reconectar. Online → el hash lo maneja el flujo normal.
      const onlineAlEnviar = useE14Store.getState().online;
      const tEnvio = onlineAlEnviar ? performance.now() : 0;
      useE14Store.getState().registrarEnvioMasiva(acta);
      actaFinal = {
        ...acta,
        status: "ENVIADA",
        enviadoAutomaticamente: getBridge().horaEnvio(),
        ...(onlineAlEnviar ? {} : { hashSha256: "EN COLA" }),
      };
      enviadaAuto = true;
      if (onlineAlEnviar) envioMs = Math.round(performance.now() - tEnvio);
    } else {
      useE14Store.getState().contarMotivoNoEnvioActa(acta);
    }
    // D61 (T3): parche INMUTABLE del diagnóstico con envioMs — MISMO patrón
    // del parche esperaMs de D57 (spread, solo si diagnostico != null). Va
    // ANTES de construir registroListo → viaja en la PRIMERA persistencia.
    if (envioMs != null && actaFinal.diagnostico != null) {
      actaFinal = {
        ...actaFinal,
        diagnostico: {
          ...actaFinal.diagnostico,
          tiempos: { ...actaFinal.diagnostico.tiempos, envioMs },
        },
      };
    }

    const thumb = await hacerThumb(acta.fotoProcesada ?? acta.fotoOriginal);
    const registroListo: RegistroMasiva = {
      ...registro,
      estado: "LISTA",
      acta: actaFinal,
      thumb,
      // D59 — KIT e14-info-acta-filas-v1 (T2): título con la info reconocida
      // del desenlace REAL (persiste — desviación aditiva de thumb).
      infoTitulo: tituloDeActa(actaFinal),
    };
    // FIX M14 (auditoría 2-c): persistencia fallida TRAS el envío — la fila
    // NO pasa a ERROR (el acta SÍ se transmitió; una fila ERROR invita a
    // reprocesar → doble envío tras recarga) y el registro JAMÁS queda
    // PENDIENTE con el archivo (el reproceso automático re-enviaría).
    // Reintento MÍNIMO: estado LISTA + desenlace liviano, SIN el acta
    // completa (la causa típica del fallo es quota — el registro con acta
    // de ~15 MB no cabe; el liviano sí).
    // D61 — KIT e14-tiempos-ocultos-v1 (T3): la MISMA ventana mide ahora la
    // persistencia del desenlace (guardarRegistro principal + fallback
    // liviano — kit §2-T3): persistMs = coste REAL del write que el usuario
    // experimenta. Si ambos writes fallan, el campo se OMITE (sin dato —
    // jamás inventar).
    let persistMs: number | null = null;
    const tPersist = performance.now();
    try {
      await guardarRegistro(registroListo);
      persistMs = Math.round(performance.now() - tPersist);
    } catch {
      try {
        await guardarRegistro({ ...registro, estado: "LISTA", thumb });
        persistMs = Math.round(performance.now() - tPersist);
      } catch {
        /* IDB caída del todo — la fila vive honesta en memoria (LISTA);
           persistMs se omite (sin dato — jamás inventar). */
      }
    }
    // D61 (T3) — re-save de INSTRUMENTO (FUERA del desenlace): persistMs nace
    // DEL write que lo mide (paradoja del instrumento — no puede viajar dentro
    // de él). Con el valor ya medido, parchea el diagnóstico (patrón inmutable
    // de esperaMs) y re-persiste para que sobreviva la recarga (kit T5 — IDB).
    // Best-effort y SILENCIOSO: si falla, IDB se queda con el write 1 —
    // desenlace INTACTO (sin este campo; honesto). El liviano del fallback no
    // lleva acta → sin diagnóstico → no hay nada que parchear (omitido).
    if (persistMs != null && registroListo.acta?.diagnostico != null) {
      try {
        await guardarRegistro({
          ...registroListo,
          acta: {
            ...registroListo.acta,
            diagnostico: {
              ...registroListo.acta.diagnostico,
              tiempos: {
                ...registroListo.acta.diagnostico.tiempos,
                persistMs,
              },
            },
          },
        });
      } catch {
        /* el write 1 manda — persistMs viaja solo si este re-save cabe */
      }
    }
    marcarFila(fila.id, {
      estado: "LISTA",
      statusActa: actaFinal.status,
      score: actaFinal.score,
      nivel: actaFinal.clasificacion?.nivel ?? null,
      pagina: paginaDeActa(actaFinal),
      infoTitulo: tituloDeActa(actaFinal), // D59 — KIT e14-info-acta-filas-v1 (T2)
      motivo: actaFinal.rechazo?.tipo ?? null,
      thumb,
      enviadaAuto,
      envioEnCola: actaFinal.hashSha256 === "EN COLA", // KIT e14-masiva-ux-v1 (T3.2)
      error: null,
    });
  } catch (err) {
    // Errores de IDB/decode/pipeline NUNCA tumban la UI (kit §3): la
    // entrada pasa a ERROR con motivo corto (repetible — quitar y
    // re-soltar la foto vuelve a encolarla).
    // FIX M8-b (auditoría 2-c): el guard anti-zombi TAMBIÉN en el catch —
    // re-persistir el registro de una fila QUITADA lo revivía al recargar.
    if (!useMasivaStore.getState().filas.some((f) => f.id === fila.id)) return;
    // D59 — KIT e14-info-acta-filas-v1 (T2): la fila ERROR NUNCA muestra
    // título viejo (infoTitulo: null — limpiar en el catch).
    marcarFila(fila.id, {
      estado: "ERROR",
      error: motivoCorto(err),
      infoTitulo: null,
      thumb: undefined,
    });
    if (registro) {
      try {
        await guardarRegistro({ ...registro, estado: "ERROR" });
      } catch {
        /* IDB otra vez — la fila ya quedó ERROR en memoria (honesto) */
      }
    }
  } finally {
    const progreso = useMasivaStore.getState().progreso;
    if (progreso?.id === fila.id) useMasivaStore.setState({ progreso: null });
  }
}

async function bucle(): Promise<void> {
  while (!stopFlag) {
    const fila = siguientePendiente();
    if (!fila) break;
    // KIT e14-masiva-tiempos-v1 (PR-2): prefetch de 1 slot — al INICIAR el
    // procesamiento de N, disparar el decode de N+1 en background (kit §3):
    // el decode HEIC (~1-2 s) queda OCULTO tras el OCR de N (AC-P1). Primero
    // se CONSUME el slot de ESTA fila (capturado — la misma instancia que la
    // memo ya decodificó); en fila DUPLICADA el slot SE CONSERVA (la copia
    // no decoda — el prefetch en vuelo sirve a la siguiente pipeline-able).
    const predecode =
      prefetchSlot && prefetchSlot.id === fila.id ? prefetchSlot.archivo : null;
    if (predecode || fila.estado !== "DUPLICADA") prefetchSlot = null;
    dispararPrefetch(fila.id);
    await procesarUno(fila, predecode);
  }
}

/** KIT e14-masiva-tiempos-v1 (PR-2): prefetch de decode — guarda la MISMA
 *  instancia del File de la próxima fila pipeline-able (PENDIENTE, no temp,
 *  no DUPLICADA — la copia no decoda) y precalienta la memo del bridge.
 *  Fallo → catch silencioso + slot fuera: la fila re-decodifica sola
 *  (comportamiento de hoy — jamás bloquea, AC-P2). stopFlag/pausa → no
 *  dispara (el prefetch en vuelo muere solo — nadie lo consume). El ciclo
 *  de vida del slot vive en bucle() (captura → null → disparo siguiente). */
let prefetchSlot: { id: string; archivo: File } | null = null;

function dispararPrefetch(filaActualId: string): void {
  if (stopFlag) return;
  const proxima = useMasivaStore
    .getState()
    .filas.filter(
      (f) =>
        f.estado === "PENDIENTE" &&
        f.id !== filaActualId &&
        !f.id.startsWith("masiva-temp-"),
    )
    .sort((a, b) => a.agregadaEn - b.agregadaEn)[0];
  if (!proxima) return;
  // Ya hay prefetch (en vuelo o listo) para ESA fila → no re-disparar con
  // otra instancia (sería un segundo decode del mismo contenido).
  if (prefetchSlot && prefetchSlot.id === proxima.id) return;
  prefetchSlot = null;
  void (async () => {
    try {
      const registro = await leerRegistro(proxima.id);
      const archivo = registro.archivo;
      if (!(archivo instanceof File)) return;
      prefetchSlot = { id: proxima.id, archivo };
      const t0 = Date.now();
      await precargarDecodeArchivo(archivo);
      console.info(
        `[e14] masiva-prefetch fila=${proxima.id} listo ms=${Date.now() - t0}`,
      );
    } catch {
      // Decode fallido: la memo del bridge ya liberó la entrada — la fila
      // re-decodifica en su turno (comportamiento actual, AC-P2).
      if (prefetchSlot?.id === proxima.id) prefetchSlot = null;
    }
  })();
}

/** UN solo runner global (módulo singleton) — `iniciar()` double-call →
 *  no-op (kit §4 regla 1). */
export function iniciarRunner(): void {
  if (corriendoFlag) return;
  corriendoFlag = true;
  stopFlag = false;
  useMasivaStore.setState({ corriendo: true });
  void bucle().finally(() => {
    corriendoFlag = false;
    useMasivaStore.setState({ corriendo: false, progreso: null });
  });
}

/** Pausa MANUAL: stop = true — el OCR en vuelo TERMINA (no hay aborto a
 *  mitad de pipeline; la fila queda LISTA/ERROR y el loop no toma la
 *  siguiente). PROCESAR retoma donde iba. También lo llama la AUTO-PAUSA
 *  al abrir un acta en REVISIÓN (kit §4 regla 2 — el flujo de revisión usa
 *  el main thread y actaActual, no pelear). Reanudar es MANUAL (botón). */
export function pausarRunner(): void {
  stopFlag = true;
}
