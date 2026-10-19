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
    error: r.estado === "ERROR" ? (r.acta ? null : "ERROR DE COLA") : null,
  };
}

function patchFila(id: string, patch: Partial<FilaMasiva>): void {
  const filas = useMasivaStore.getState().filas;
  useMasivaStore.setState({
    filas: filas.map((f) => (f.id === id ? { ...f, ...patch } : f)),
  });
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
    const imagenes = Array.from(files).filter((f) => f.type.startsWith("image/"));
    if (!imagenes.length) return;
    // Filas PENDIENTES AL INSTANTE (kit §6) con ids temporales — el runner
    // las salta mientras la copia a IDB está en vuelo («GUARDANDO N…»).
    const base = Date.now();
    const temps = imagenes.map((file, i) => ({
      id: `masiva-temp-${base}-${i}`,
      nombre: file.name || `FOTO_${i + 1}`,
      agregadaEn: base + i,
      estado: "PENDIENTE" as EstadoEntrada,
    }));
    set({
      filas: [...get().filas, ...temps],
      guardando: get().guardando + imagenes.length,
    });
    try {
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
    } catch {
      // El lote NO entró a IDB: filas temporales fuera + píldora de fallback
      // (errores de IDB NUNCA tumban la UI — kit §3).
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
        useE14Store.getState().registrarEnvioMasiva(acta);
        const actaEnviada: Acta = {
          ...acta,
          status: "ENVIADA",
          enviadoAutomaticamente: getBridge().horaEnvio(),
        };
        await guardarRegistro({ ...registro, acta: actaEnviada });
        patchFila(fila.id, {
          statusActa: "ENVIADA",
          score: actaEnviada.score,
          motivo: null,
        });
      } catch {
        /* una fila que falla NO detiene el lote (sigue con la siguiente) */
      }
    }
  },

  setFiltro: (filtro) => set({ filtro }),
}));
