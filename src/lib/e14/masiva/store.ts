"use client";

/**
 * KIT e14-carga-masiva-v1 (T2): MINI-STORE zustand del módulo MASIVA —
 * el store del flujo normal (useE14Store) NO sabe que MASIVA existe salvo
 * por los 3 puntos de integración T3 (kit §0.4). Estado liviano: filas sin
 * fotos (la RAM real duerme en IndexedDB — lección L7).
 */
import { create } from "zustand";
import { getBridge } from "../get-bridge";
import { useE14Store } from "../store";
import {
  agregarLote,
  borrar,
  guardarRegistro,
  leerRegistro,
  listarMapeados,
  recuperarCola,
  vaciar as vaciarCola,
} from "./cola";
import { hacerThumb, iniciarRunner, pausarRunner } from "./runner";
// D66 — KIT e14-decode-unico-precalor-v1: cableado del PRECALOR (T3) — la
// suscripción al mini-store vive aquí (zona del kit: «flag transitorio
// precalentada + cola de precalor») DESPUÉS de crear el store: precalor.ts
// también importa useMasivaStore (solo DENTRO de funciones — un call en su
// evaluación de módulo sería TDZ por el ciclo runner↔precalor↔store).
import { cablearPrecalor } from "./precalor";
// KIT e14-masiva-ux-v1 (T2): clasificación/extracción de archivos — las
// deps pesadas (fflate/node-unrar-js) viven DETRÁS de extraerArchivo con
// import diferido (D47): el bundle inicial no las carga.
// D60: parecePdfMasiva/extraerPdf añaden la rama PDF (pdfjs diferido ídem).
import {
  extraerArchivo,
  extraerPdf,
  pareceImagenMasiva,
  parecePdfMasiva,
} from "./archivos";
import { dhashDeArchivo, hamming64, DEDUP_HAMMING_MAX } from "./dedup";
import {
  paginaDeActa,
  tituloDeActa,
  type EstadoEntrada,
  type FilaMasiva,
  type RegistroMasiva,
} from "./tipos";
import type { Acta } from "../types";

export type FiltroMasiva =
  | "TODAS"
  | "OPTIMA"
  | "ADVERTENCIA"
  | "RECHAZADA"
  | "EN_REVISION_HUMANA"
  | "ERROR";

/** D65 — KIT e14-progreso-watchdog-dedup-v1 (T3): vocabulario del kit para
 *  la señal de vida de la fila ACTIVA. La fracción SOLO existe en OCR y es
 *  REAL (reconocedor por lotes de rec — §2-C4 del kit ocr-escalonado); las
 *  demás etapas van SIN número (barra animada — jamás inventar %). */
export type EtapaVidaKit = "preparando" | "deteccion" | "ocr" | "verificacion";

/** Progreso de la fila ACTIVA (throttled por el runner 250 ms — D65 T3.1).
 *  Estado TRANSITORIO: NO se persiste en IndexedDB (kit T3.4 — cada tick a
 *  IDB sería caro); al recargar la página las filas vuelven a PENDIENTE como
 *  hoy y no queda % fantasma. */
export interface ProgresoFila {
  id: string;
  etapa: EtapaVidaKit;
  /** 0..1 SOLO cuando etapa === "ocr" — dato REAL del reconocedor. */
  ocrFraccion?: number;
}

interface MasivaStore {
  filas: FilaMasiva[];
  corriendo: boolean;
  progreso: ProgresoFila | null;
  filtro: FiltroMasiva;
  /** Acta abierta en REVISIÓN desde la bandeja (T3.4) — la identidad para
   *  sincronizar al volver. null = ninguna abierta. */
  origenAbierto: string | null;
  /** «GUARDANDO N…» — copia async de files → IDB (zona de carga). */
  guardando: number;
  /** false → píldora de fallback (IndexedDB no disponible — kit §3/§6). */
  colaDisponible: boolean;
  /** FIX (auditoría 2-c C5): true mientras corre «ENVIAR ADVERTENCIAS» —
   *  guard de re-entrancia del lote (doble tap = doble envío). */
  enviandoLote: boolean;

  /** FIX M9 (auditoría 2-c): aviso específico de QUOTA — antes cualquier
   *  fallo de escritura (casi siempre almacenamiento lleno con actas de
   *  ~15 MB/registro) degradaba a «TU NAVEGADOR NO SOPORTA LA COLA» (falso)
   *  y mataba el botón PROCESAR para TODA la bandeja. null = sin aviso. */
  avisoCola: string | null;

  /** Al montar: lista IDB → filas livianas + recuperarCola() (zombis fuera). */
  cargarFilas: () => Promise<void>;
  /** Suelta/selección de fotos: filas PENDIENTES al instante (ids temp) +
   *  copia async a IDB — al resolver, los ids reales reemplazan a los temp. */
  agregarFiles: (files: File[]) => Promise<void>;
  iniciar: () => void;
  pausar: () => void;
  /** ABRIR: auto-pausa del runner + REVISIÓN del acta (vía T3.4). */
  abrirActa: (id: string) => Promise<void>;
  /** Al volver de REVISIÓN: si la identidad coincide, re-persiste el acta
   *  ACTUALIZADA (recorte/filtro/envío — F5) y refresca la fila. Si no,
   *  SOLO limpia origenAbierto (no escribe nada). */
  sincronizarAlVolver: () => Promise<void>;
  quitar: (id: string) => Promise<void>;
  vaciar: () => Promise<void>;
  /** KIT e14-masiva-tiempos-v1 (PR-1): «PROCESAR IGUAL» — des-marca la fila
   *  DUPLICADA (→ PENDIENTE, dupOf fuera) para que el runner la reprocese
   *  COMPLETA (fotos distintas pueden parecer iguales en thumb — kit §2). */
  procesarIgual: (id: string) => Promise<void>;
  /** D59 — KIT e14-info-acta-filas-v1 (T3): «REINTENTAR» de una fila ERROR —
   *  la re-encola (PENDIENTE, error fuera, persistente) para que el dueño
   *  pulse PROCESAR. NO auto-procesa (misma doctrina D45: extraer/re-encolar
   *  NO procesa). Sin archivo original en IDB → la fila SIGUE en ERROR con
   *  SIN_ARCHIVO_ORIGINAL (honesto — registros viejos o filas de formato). */
  reintentar: (id: string) => Promise<void>;
  /** Envío en lote SECUENCIAL de ADVERTENCIAS (cada una vía registrarEnvio
   *  real). NO toca RECHAZADAS ni EN_RH (kit §6). */
  enviarLote: (estado: "ADVERTENCIA") => Promise<void>;
  /** D65 (T3.1): señal de vida de la fila en curso — action NUEVO del kit;
   *  el runner emite con throttle 250 ms vía bucketDeVida. Transitorio
   *  (NUNCA a IDB — kit T3.4). */
  marcarProgreso: (
    id: string,
    progreso: { etapa: EtapaVidaKit; ocrFraccion?: number },
  ) => void;
  setFiltro: (filtro: FiltroMasiva) => void;
}

/** Registro IDB → fila LIVIANA (sin Blob, sin acta — la foto duerme). */
function filaDeRegistro(r: RegistroMasiva): FilaMasiva {
  const acta = r.acta;
  return {
    id: r.id,
    nombre: r.nombre,
    agregadaEn: r.agregadaEn,
    estado: r.estado,
    statusActa: acta?.status,
    score: acta?.score,
    nivel: acta?.clasificacion?.nivel ?? null,
    pagina: acta ? paginaDeActa(acta) : null,
    motivo: acta?.rechazo?.tipo ?? null,
    thumb: r.thumb,
    // D72: el título compuesto usa el formato compacto cuando r.acta existe
    infoTitulo: (r.acta ? tituloDeActa(r.acta) : r.infoTitulo) ?? null,
    enviadaAuto: r.acta?.status === "ENVIADA" && !!r.acta?.enviadoAutomaticamente,
    // KIT e14-masiva-ux-v1 (T3.2): el estado de envío se deriva DEL REGISTRO
    // (kit-literal: hashSha256 === "EN COLA") — sobrevive la recarga.
    envioEnCola: acta?.hashSha256 === "EN COLA",
    // KIT e14-masiva-ux-v1 (T2): el motivo corto de las filas ERROR sin
    // acta (guards de extracción/formato) sobrevive la recarga.
    error:
      r.estado === "ERROR"
        ? (r.error ?? (r.acta ? null : "ERROR DE COLA"))
        : null,
    // KIT e14-masiva-tiempos-v1 (PR-1): dedup persistente — sobrevive la
    // recarga (la fila sigue DUPLICADA y el runner puede copiar igual).
    hashDedup: r.hashDedup ?? null,
    dupOf: r.estado === "DUPLICADA" ? (r.dupOf ?? null) : null,
    // D63-A2 (T1): viaPdf sobrevive la recarga (el override de origen del
    // runner sigue funcionando a mitad de corrida). Ausente = no-PDF.
    ...(r.viaPdf ? { viaPdf: true } : {}),
  };
}

function patchFila(id: string, patch: Partial<FilaMasiva>): void {
  const filas = useMasivaStore.getState().filas;
  useMasivaStore.setState({
    filas: filas.map((f) => (f.id === id ? { ...f, ...patch } : f)),
  });
}

/** KIT e14-masiva-tiempos-v1 (PR-1): cadena de hashing DEDUP en background —
 *  por cada archivo del lote EN ORDEN FIFO: dhash (misma vía del pipeline,
 *  dedup.ts) → persiste hashDedup → compara contra TODAS las filas con hash
 *  (Hamming ≤ 6) → marca DUPLICADA (persistente) apuntando a la ORIGINAL.
 *  NUNCA bloquea la UI ni lanza: fallo de decode/hash → hash null → la fila
 *  procesa normal (conservador). Los guards de existencia hacen el vaciar/
 *  quitar del dueño MANDAR (0 zombis — mismo patrón del runner).
 *  D65 (T2): dedup v2 POR CONTENIDO con EXIF normalizada (dedup.ts) — misma
 *  cadena, y la traza aditiva dedup/dedupDistancia (kit T2.3) persiste en el
 *  MISMO write del hashDedup (campos nuevos al final del contrato D57). */
async function cadenaDedup(lote: { id: string; archivo: File }[]): Promise<void> {
  for (const entrada of lote) {
    try {
      const hash = await dhashDeArchivo(entrada.archivo);
      if (!hash) continue; // decode/hash falló → sin dedup para esta fila
      // Guard anti-zombi: la fila pudo ser quitada/vaciada mientras el decode corría.
      if (!useMasivaStore.getState().filas.some((f) => f.id === entrada.id)) continue;
      let registro: RegistroMasiva;
      try {
        registro = await leerRegistro(entrada.id);
      } catch {
        continue; // fuera de la cola (IDB/vaciar) — nada que marcar
      }
      // ¿Gemela de una fila existente? (filas ANTERIORES con hash — la
      // cadena es FIFO, la original siempre lleva delante). D65: la búsqueda
      // corre ANTES del write para plegar la traza dedup (T2.3) en el MISMO
      // guardarRegistro del hash — mismo nº de writes que v1 (1 por fila, 2
      // para gemelas). Los candidatos salen del STORE (otras filas — esta no
      // es candidata de sí misma): mismo resultado que el orden de v1.
      const filas = useMasivaStore.getState().filas;
      const candidatas = filas.filter(
        (f) => f.id !== entrada.id && f.hashDedup && f.estado !== "ERROR",
      );
      let original: FilaMasiva | null = null;
      let hamming = DEDUP_HAMMING_MAX + 1;
      for (const c of candidatas) {
        const d = hamming64(hash, c.hashDedup as string);
        if (d <= DEDUP_HAMMING_MAX && (original === null || d < hamming || c.agregadaEn < original.agregadaEn)) {
          original = c;
          hamming = d;
        }
      }
      // D65 (T2.3): traza del dedup v2 — "v2" = match (con la distancia REAL
      // del match); "sin-match" = hasheada sin gemela. Sin hash (decode
      // falló) la fila NO trae traza (ausente = instrumento no corrió).
      const trazaDedup: Pick<RegistroMasiva, "dedup" | "dedupDistancia"> = original
        ? { dedup: "v2", dedupDistancia: hamming }
        : { dedup: "sin-match" };
      await guardarRegistro({ ...registro, hashDedup: hash, ...trazaDedup });
      patchFila(entrada.id, { hashDedup: hash });
      if (!original) continue;
      // Solo marca filas aún PENDIENTES (el dueño pudo procesar/quitar mientras el hash corría).
      const filaViva = useMasivaStore.getState().filas.find((f) => f.id === entrada.id);
      if (!filaViva || filaViva.estado !== "PENDIENTE") continue;
      const reg = await leerRegistro(entrada.id);
      await guardarRegistro({ ...reg, estado: "DUPLICADA", dupOf: original.id });
      patchFila(entrada.id, { estado: "DUPLICADA", dupOf: original.id });
      console.info(
        `[e14] dedup fila=${entrada.id} marcada hamming=${hamming} dupOf=${original.id} hash=${hash}`,
      );
    } catch {
      /* un fallo de la cadena JAMÁS tumba el encolado — la fila queda normal */
    }
  }
}

/** KIT e14-masiva-ux-v1 (T3.2): al reactivar la conexión la cola offline del
 *  flujo se drena (alternarConexion del store principal — INTACTO, fuera de
 *  la whitelist §1). Aquí se refrescan las filas MASIVA que quedaron «EN
 *  COLA»: el acta en IDB pasa de hashSha256 "EN COLA" a un hash demo (mismo
 *  formato que el drenaje del flujo normal) y la fila pinta «ENVIADA».
 *  La llama MasivaView al detectar el toggle offline→online. */
export async function refrescarEnviosTrasDrenaje(): Promise<void> {
  const enCola = useMasivaStore
    .getState()
    .filas.filter((f) => f.estado === "LISTA" && f.envioEnCola);
  for (const fila of enCola) {
    try {
      const registro = await leerRegistro(fila.id);
      if (registro.acta?.hashSha256 !== "EN COLA") continue;
      await guardarRegistro({
        ...registro,
        acta: { ...registro.acta, hashSha256: hashDrenaje() },
      });
      patchFila(fila.id, { envioEnCola: false });
    } catch {
      /* IDB caído → la fila queda «EN COLA» (honesto; reintento al recargar) */
    }
  }
}

/** Espejo del hashMock del store principal (3 líneas — hash demo de 12 hex,
 *  mismo formato visible en REVISIÓN/RESUMEN tras el drenaje). Sin import:
 *  store.ts NO está en la whitelist §1 de este kit. */
function hashDrenaje(): string {
  const hex = Array.from({ length: 12 }, () =>
    "0123456789abcdef"[Math.floor(Math.random() * 16)],
  ).join("");
  return `${hex}…`;
}

export const useMasivaStore = create<MasivaStore>((set, get) => ({
  filas: [],
  corriendo: false,
  progreso: null,
  enviandoLote: false,
  filtro: "TODAS",
  origenAbierto: null,
  guardando: 0,
  colaDisponible: true,
  avisoCola: null,

  cargarFilas: async () => {
    try {
      await recuperarCola(); // PROCESANDO zombi → PENDIENTE (caída a mitad de OCR)
      // FIX C6: mapper DENTRO del cursor — los registros completos (acta con
      // dataURLs) viven un instante; la bandeja solo retiene filas livianas.
      const filas = await listarMapeados(filaDeRegistro);
      set({
        filas: filas.sort((a, b) => a.agregadaEn - b.agregadaEn),
        colaDisponible: true,
      });
    } catch {
      // IndexedDB no disponible → píldora de fallback (kit §6). La UI vive.
      set({ colaDisponible: false, filas: [] });
    }
  },

  agregarFiles: async (files) => {
    // KIT e14-masiva-ux-v1 (T2.3): clasificación — imágenes (MIME o
    // extensión, HEIC incluido) pasan directo; .zip/.rar se EXTRAEN
    // client-side (import diferido D47 — extraer NO procesa nada, solo
    // encola: D45 intacto); D60: PDF → páginas JPEG por extraerPdf (pdfjs
    // diferido ídem — cada página hereda TODO); lo demás → fila ERROR
    // FORMATO_NO_SOPORTADO (ya no se descarta en silencio).
    const lista = Array.from(files);
    if (!lista.length) return;
    const imagenes: File[] = [];
    // D63-A2 (T1): páginas nacidas de un PDF — nacen CON viaPdf (calibración
    // por CONSTRUCCIÓN: el pipeline SABE qué filas vienen de PDF sin adivinar
    // por píxeles). Solo la rama PDF llena este Set (fotos/WhatsApp/ZIP
    // jamás lo tocan — prueba de lectura en el REPORTE del kit).
    const paginasPdf = new Set<File>();
    const errores: { nombre: string; motivo: string }[] = [];
    for (const f of lista) {
      if (pareceImagenMasiva(f)) {
        imagenes.push(f);
      } else if (/\.(zip|rar)$/i.test(f.name)) {
        try {
          const resultado = await extraerArchivo(f);
          imagenes.push(...resultado.archivos);
          errores.push(...resultado.errores);
        } catch (err) {
          errores.push({
            nombre: f.name,
            motivo: (
              err instanceof Error ? err.message : "PROTEGIDO_O_CORRUPTO"
            ).slice(0, 48),
          });
        }
      } else if (parecePdfMasiva(f)) {
        // D60 — PDF: render página a página → CADA página cae en `imagenes`
        // (mismo manejo exacto que zip/rar: hereda pipeline/gate/dedup/IDB).
        // D63-A2 (T1): las páginas resultantes entran al Set `paginasPdf` —
        // sus filas nacen con viaPdf=true (memoria + IDB) y el runner las
        // clasifica ESCANEO por construcción (las señales de píxel del
        // detector D63-A quedan PRESERVADAS como prefijo `pdf-render+…`).
        try {
          const resultado = await extraerPdf(f);
          resultado.archivos.forEach((a) => paginasPdf.add(a));
          imagenes.push(...resultado.archivos);
          errores.push(...resultado.errores);
        } catch (err) {
          errores.push({
            nombre: f.name,
            motivo: (
              err instanceof Error ? err.message : "PROTEGIDO_O_CORRUPTO"
            ).slice(0, 48),
          });
        }
      } else {
        errores.push({ nombre: f.name || "ARCHIVO", motivo: "FORMATO_NO_SOPORTADO" });
      }
    }
    if (!imagenes.length && !errores.length) return;
    const base = Date.now();
    // Filas PENDIENTES AL INSTANTE (kit carga-masiva §6) con ids temporales
    // — el runner las salta mientras la copia a IDB está en vuelo.
    const temps = imagenes.map((file, i) => ({
      id: `masiva-temp-${base}-${i}`,
      nombre: file.name || `FOTO_${i + 1}`,
      agregadaEn: base + i,
      estado: "PENDIENTE" as EstadoEntrada,
      // D63-A2 (T1): solo páginas-PDF traen el flag (ausente = no-PDF).
      ...(paginasPdf.has(file) ? { viaPdf: true } : {}),
    }));
    // Filas ERROR (T2): motivo corto ≤48 — persisten en IDB (la bandeja
    // sobrevive la recarga; no hay datos que procesar).
    const filasError = errores.map((e, i) => ({
      id: `masiva-err-${base}-${i}`,
      nombre: e.nombre,
      agregadaEn: base + imagenes.length + i,
      estado: "ERROR" as EstadoEntrada,
      error: e.motivo,
    }));
    set({
      filas: [...get().filas, ...temps, ...filasError],
      guardando: get().guardando + imagenes.length,
    });
    try {
      if (imagenes.length) {
        const ids = await agregarLote(imagenes, paginasPdf); // D63-A2 (T1): viaPdf nace en el PRIMER write
        // FIX M13 (auditoría 2-c): el swap respeta la decisión del dueño TOMADA
        // DURANTE la copia (QUITAR de una fila temp, VACIAR, o recarga de la
        // vista que re-monta cargarFilas): las temps que YA NO están en filas
        // NO reviven con id real — sus registros recién creados se BORRAN de
        // IDB (antes quedaban huérfanos y resucitaban como PENDIENTE al
        // recargar, contra la voluntad del usuario).
        const actuales = get().filas;
        const vivas = new Set(actuales.map((f) => f.id));
        const huerfanos = ids.filter((_, idx) => !vivas.has(temps[idx]!.id));
        set({
          filas: actuales.map((f) => {
            const idx = temps.findIndex((t) => t.id === f.id);
            return idx === -1 ? f : { ...f, id: ids[idx] };
          }),
          guardando: Math.max(0, get().guardando - imagenes.length),
          colaDisponible: true,
          avisoCola: null, // un lote que SÍ entró despeja el aviso de quota
        });
        // FIX M13 (auditoría 2-a): los huérfanos salen de IDB antes de
        // arrancar nada — jamás resucitan.
        for (const id of huerfanos) {
          try {
            await borrar(id);
          } catch {
            /* IDB caída — el orphan muere con el próximo VACIAR */
          }
        }
        // KIT e14-masiva-tiempos-v1 (PR-1): cadena de hashing DEDUP en
        // background (fire-and-forget — NUNCA bloquea el encolado ni la
        // UI; marca DUPLICADAS al aterrizar cada hash, FIFO). Los guards
        // anti-zombi de cadenaDedup ya excluyen filas muertas; aquí el
        // lote deja fuera a los huérfanos borrados (no hashear en balde).
        void cadenaDedup(
          imagenes
            .map((file, i) => ({ id: ids[i], archivo: file }))
            .filter((e) => e.id !== undefined && !huerfanos.includes(e.id)),
        );
      } else {
        set({ guardando: Math.max(0, get().guardando - imagenes.length) });
      }
      for (const fila of filasError) {
        try {
          await guardarRegistro({
            id: fila.id,
            nombre: fila.nombre,
            agregadaEn: fila.agregadaEn,
            estado: "ERROR",
            error: fila.error,
          });
        } catch {
          /* IDB caído: la fila vive SOLO en memoria (honesto) */
        }
      }
    } catch (err) {
      // El lote NO entró a IDB: filas temporales fuera + píldora honesta
      // (errores de IDB NUNCA tumban la UI — kit carga-masiva §3). Las filas
      // ERROR quedan en memoria — su motivo ES la información.
      // FIX M9 (auditoría 2-c): QUOTA ≠ «navegador sin soporte» — la cola
      // SIGUE disponible (hay filas pre-existentes sanas y PROCESAR vale);
      // el aviso explica cómo liberar espacio. Solo un fallo REAL de IDB
      // (abrir/versión) degrada a colaDisponible false.
      const esQuota =
        err instanceof Error &&
        (/quotaexceeded/i.test(err.name) ||
          /quota/i.test(err.message) ||
          /llen|full/i.test(err.message));
      const tempIds = new Set(temps.map((t) => t.id));
      set({
        filas: get().filas.filter((f) => !tempIds.has(f.id)),
        guardando: Math.max(0, get().guardando - imagenes.length),
        ...(esQuota
          ? {
              avisoCola:
                "ALMACENAMIENTO LLENO — vacía la bandeja o importa lotes más pequeños",
            }
          : { colaDisponible: false }),
      });
    }
  },

  iniciar: () => {
    if (!get().colaDisponible) return;
    iniciarRunner();
  },

  pausar: () => pausarRunner(),

  // KIT e14-masiva-tiempos-v1 (PR-1): «PROCESAR IGUAL» — la fila vuelve a
  // PENDIENTE (dupOf fuera, persistente) y el runner la reprocesa COMPLETA
  // como cualquier otra (kit §2 — el dueño fuerza el reproceso de una
  // gemela sospechosa). Si el runner está corriendo la toma en su siguiente
  // pasada (siguientePendiente ya incluye PENDIENTE).
  procesarIgual: async (id) => {
    patchFila(id, { estado: "PENDIENTE", dupOf: null });
    console.info(`[e14] dedup fila=${id} procesar-igual`);
    try {
      const registro = await leerRegistro(id);
      await guardarRegistro({ ...registro, estado: "PENDIENTE", dupOf: undefined });
    } catch {
      /* IDB caído — la fila ya está PENDIENTE en memoria (honesto) */
    }
  },

  // D59 — KIT e14-info-acta-filas-v1 (T3): «REINTENTAR» — la fila ERROR
  // vuelve a PENDIENTE (error fuera, persistente) y el runner la toma en su
  // siguiente pasada (o cuando el dueño pulse PROCESAR). Guard honesto: sin
  // archivo original en IDB (registros viejos o filas de formato) la fila
  // SIGUE en ERROR con SIN_ARCHIVO_ORIGINAL — jamás encolar humo.
  reintentar: async (id) => {
    const fila = get().filas.find((f) => f.id === id);
    if (!fila || fila.estado !== "ERROR") return;
    if (get().progreso?.id === id) return; // no corriendo en ese id (defensivo)
    let registro: RegistroMasiva;
    try {
      registro = await leerRegistro(id);
    } catch {
      return; // sin registro en IDB — nada que reintentar (honesto)
    }
    if (!(registro.archivo instanceof File)) {
      patchFila(id, { error: "SIN_ARCHIVO_ORIGINAL" });
      return;
    }
    patchFila(id, { estado: "PENDIENTE", error: null });
    try {
      await guardarRegistro({ ...registro, estado: "PENDIENTE", error: undefined });
    } catch {
      /* IDB caído — la fila ya está PENDIENTE en memoria (honesto) */
    }
  },

  abrirActa: async (id) => {
    // AUTO-PAUSA (kit §4 regla 2): el flujo de revisión usa el main thread
    // y actaActual — no pelear. Reanudar es MANUAL (botón PROCESAR).
    pausarRunner();
    set({ origenAbierto: id });
    await useE14Store.getState().abrirActaMasiva(id);
  },

  sincronizarAlVolver: async () => {
    const { origenAbierto } = get();
    if (!origenAbierto) return;
    const acta = useE14Store.getState().actaActual;
    // FIX (auditoría 2-c C4): la identidad se resuelve contra el acta GUARDADA
    // en el registro (registro.acta.id === actaActual.id) — NO contra el id de
    // la FILA ("masiva-*" vs "acta-*": prefijos distintos, la comparación
    // directa era SIEMPRE falsa y este bloque entero era código muerto: las
    // ediciones de REVISIÓN jamás volvían a la bandeja/IDB y el usuario,
    // viendo la fila desactualizada, re-abría y re-enviaba la misma acta).
    // El recorte/filtro/rotación conservan acta.id (spread ...acta) → la
    // identidad sobrevive a TODAS las ediciones del editor.
    if (!acta) {
      set({ origenAbierto: null });
      return;
    }
    try {
      const registro = await leerRegistro(origenAbierto);
      if (!registro || registro.acta?.id !== acta.id) {
        // Identidad NO coincide (arrancó una captura normal mientras tanto):
        // SOLO limpiar — no escribir nada (kit §4).
        set({ origenAbierto: null });
        return;
      }
      const actaNueva = acta;
      // Thumb FRESCO si la foto cambió (recorte/filtro/rotación hornean
      // fotoProcesada) — la bandeja no debe mentir.
      const thumb =
        (await hacerThumb(actaNueva.fotoProcesada ?? actaNueva.fotoOriginal)) ??
        registro.thumb;
      await guardarRegistro({ ...registro, acta: actaNueva, thumb });
      patchFila(origenAbierto, {
        estado: "LISTA",
        statusActa: actaNueva.status,
        score: actaNueva.score,
        nivel: actaNueva.clasificacion?.nivel ?? null,
        pagina: paginaDeActa(actaNueva),
        motivo: actaNueva.rechazo?.tipo ?? null,
        thumb,
        enviadaAuto:
          actaNueva.status === "ENVIADA" && !!actaNueva.enviadoAutomaticamente,
        // KIT e14-masiva-ux-v1 (T3.2): el envío manual desde REVISIÓN ya
        // hornea hashSha256 (registrarEnvio — actaFuente === actaActual);
        // la fila lo proyecta.
        envioEnCola: actaNueva.hashSha256 === "EN COLA",
        error: null,
      });
    } catch {
      /* sin registro en IDB → nada que sincronizar; la fila queda como está */
    }
    set({ origenAbierto: null });
  },

  quitar: async (id) => {
    try {
      await borrar(id);
    } catch {
      /* la fila muere igual en la bandeja (IDB falla — kit §3) */
    }
    set({ filas: get().filas.filter((f) => f.id !== id) });
    if (get().origenAbierto === id) set({ origenAbierto: null });
  },

  vaciar: async () => {
    if (get().corriendo) return; // el botón está deshabilitado — doble guard
    try {
      await vaciarCola();
    } catch {
      /* las filas mueren igual en la bandeja */
    }
    set({ filas: [], progreso: null, origenAbierto: null, avisoCola: null });
  },

  enviarLote: async (estado) => {
    if (estado !== "ADVERTENCIA") return; // v1: SOLO advertencias (kit §9)
    // FIX (auditoría 2-c C5): guard de re-entrancia — un doble clic (o doble
    // tap móvil) disparaba DOS lotes que tomaban el MISMO snapshot de filas
    // ADVERTENCIA (el patchFila llegaba tarde) → cada acta pasaba 2× por
    // registrarEnvioMasiva: historial duplicado y completadas inflada.
    if (get().enviandoLote) return;
    const pendientes = get().filas.filter(
      (f) => f.estado === "LISTA" && f.statusActa === "ADVERTENCIA",
    );
    if (pendientes.length === 0) return;
    set({ enviandoLote: true });
    try {
    for (const fila of pendientes) {
      try {
        const registro = await leerRegistro(fila.id);
        const acta = registro.acta;
        if (!acta || acta.status !== "ADVERTENCIA") continue;
        // La MISMA vía que el envío manual del flujo normal (T3.3) —
        // historial + completadas + hueco archivado + cola offline.
        // KIT e14-masiva-ux-v1 (T3.2): si la conexión estaba OFFLINE el
        // envío va a la cola → hashSha256 "EN COLA" (la fila pinta «EN
        // COLA» y refrescarEnviosTrasDrenaje la drena al reconectar).
        const onlineAlEnviar = useE14Store.getState().online;
        useE14Store.getState().registrarEnvioMasiva(acta);
        const actaEnviada: Acta = {
          ...acta,
          status: "ENVIADA",
          enviadoAutomaticamente: getBridge().horaEnvio(),
          ...(onlineAlEnviar ? {} : { hashSha256: "EN COLA" }),
        };
        await guardarRegistro({ ...registro, acta: actaEnviada });
        patchFila(fila.id, {
          statusActa: "ENVIADA",
          score: actaEnviada.score,
          motivo: null,
          envioEnCola: actaEnviada.hashSha256 === "EN COLA",
        });
      } catch {
        /* una fila que falla NO detiene el lote (sigue con la siguiente) */
      }
    }
    } finally {
      set({ enviandoLote: false });
    }
  },

  // D65 (T3.1): señal de vida — estado transitorio (NUNCA a IDB, kit T3.4);
  // el % fantasma no existe: al recargar, progreso vuelve a null.
  marcarProgreso: (id, progreso) => set({ progreso: { id, ...progreso } }),

  setFiltro: (filtro) => set({ filtro }),
}));

// D66 — KIT e14-decode-unico-precalor-v1 (T3): el precalor queda cableado
// al mini-store DESDE AHORA (store ya creado) — respira con la cola aunque
// el dueño nunca pulse PROCESAR (ese es su propósito: trabajar en la
// espera). En SSR el store no emite eventos y las señales de ociosidad lo
// mantienen apagado.
cablearPrecalor();
