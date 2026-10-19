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
  listarRegistros,
  recuperarCola,
  vaciar as vaciarCola,
} from "./cola";
import { hacerThumb, iniciarRunner, pausarRunner } from "./runner";
// KIT e14-masiva-ux-v1 (T2): clasificación/extracción de archivos — las
// deps pesadas (fflate/node-unrar-js) viven DETRÁS de extraerArchivo con
// import diferido (D47): el bundle inicial no las carga.
import { extraerArchivo, pareceImagenMasiva } from "./archivos";
import {
  paginaDeActa,
  type EstadoEntrada,
  type FilaMasiva,
  type RegistroMasiva,
} from "./tipos";
import type { Acta, EtapaAnalisis } from "../types";

export type FiltroMasiva =
  | "TODAS"
  | "OPTIMA"
  | "ADVERTENCIA"
  | "RECHAZADA"
  | "EN_REVISION_HUMANA"
  | "ERROR";

/** Progreso de la fila ACTIVA (throttled por el runner ~200 ms). */
export interface ProgresoFila {
  id: string;
  etapa: EtapaAnalisis;
  fraccion: number;
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
  /** Envío en lote SECUENCIAL de ADVERTENCIAS (cada una vía registrarEnvio
   *  real). NO toca RECHAZADAS ni EN_RH (kit §6). */
  enviarLote: (estado: "ADVERTENCIA") => Promise<void>;
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
  };
}

function patchFila(id: string, patch: Partial<FilaMasiva>): void {
  const filas = useMasivaStore.getState().filas;
  useMasivaStore.setState({
    filas: filas.map((f) => (f.id === id ? { ...f, ...patch } : f)),
  });
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
  filtro: "TODAS",
  origenAbierto: null,
  guardando: 0,
  colaDisponible: true,

  cargarFilas: async () => {
    try {
      await recuperarCola(); // PROCESANDO zombi → PENDIENTE (caída a mitad de OCR)
      const registros = await listarRegistros();
      set({
        filas: registros
          .map(filaDeRegistro)
          .sort((a, b) => a.agregadaEn - b.agregadaEn),
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
    // encola: D45 intacto); lo demás → fila ERROR FORMATO_NO_SOPORTADO
    // (ya no se descarta en silencio).
    const lista = Array.from(files);
    if (!lista.length) return;
    const imagenes: File[] = [];
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
        const ids = await agregarLote(imagenes);
        // Swap de ids temp → reales (mismo orden del lote).
        set({
          filas: get().filas.map((f) => {
            const idx = temps.findIndex((t) => t.id === f.id);
            return idx === -1 ? f : { ...f, id: ids[idx] };
          }),
          guardando: Math.max(0, get().guardando - imagenes.length),
          colaDisponible: true,
        });
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
    } catch {
      // El lote NO entró a IDB: filas temporales fuera + píldora de fallback
      // (errores de IDB NUNCA tumban la UI — kit carga-masiva §3). Las filas
      // ERROR quedan en memoria — su motivo ES la información.
      const tempIds = new Set(temps.map((t) => t.id));
      set({
        filas: get().filas.filter((f) => !tempIds.has(f.id)),
        guardando: Math.max(0, get().guardando - imagenes.length),
        colaDisponible: false,
      });
    }
  },

  iniciar: () => {
    if (!get().colaDisponible) return;
    iniciarRunner();
  },

  pausar: () => pausarRunner(),

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
    if (!acta || acta.id !== origenAbierto) {
      // Identidad NO coincide (arrancó una captura normal mientras tanto):
      // SOLO limpiar — no escribir nada (kit §4).
      set({ origenAbierto: null });
      return;
    }
    try {
      const registro = await leerRegistro(origenAbierto);
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
    set({ filas: [], progreso: null, origenAbierto: null });
  },

  enviarLote: async (estado) => {
    if (estado !== "ADVERTENCIA") return; // v1: SOLO advertencias (kit §9)
    const pendientes = get().filas.filter(
      (f) => f.estado === "LISTA" && f.statusActa === "ADVERTENCIA",
    );
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
  },

  setFiltro: (filtro) => set({ filtro }),
}));
