"use client";

/**
 * useSelectorFuente — SPRINT-B (B1, refactor/ui-hooks-v1): hook dedicado a
 * la SELECCIÓN DE FUENTE del escaneo. MOVIMIENTO PURO desde
 * screens/ScanView.tsx (mismos cuerpos, mismos refs, mismas dependencias —
 * el hook no registra efectos).
 *
 * Contiene (extraído tal cual de ScanView.tsx):
 *  · reintentoCamara — el TOKEN del §E (SPEC-camara-funcional): [ACTIVAR
 *    CÁMARA] incrementa este contador y re-dispara el efecto de ARRANQUE que
 *    vive en useSesionCamara (deps [fuente, reintentoCamara] intactas).
 *  · alElegirArchivo (IMPORTAR = fuente ARCHIVO + análisis inmediato + capa
 *    3 H2 + guards F-IMPORT/HEIC del lab L937-948).
 *  · alElegirFotoCamara (ruta iOS HQ — la foto nativa entra al MISMO
 *    pipeline, con los mismos guards).
 *  · pareceImagen / esHeic (helpers de módulo del lab, remediación H5).
 *
 * La fuente (SIM/CÁMARA/IMPORTAR) vive en el store — el segmented del JSX
 * (ScanView) la cambia con setFuente; este hook la CONSUME vía acciones
 * inyectadas con identidad exacta.
 */
import { useState, type ChangeEvent, type RefObject } from "react";
import { useE14Store } from "@/lib/e14/store";
import type { FuenteCaptura } from "@/lib/e14/types";

// Fuente: apps/scanner-lab/src/components/scanner/CameraView.tsx L927-L948
// (F-IMPORT robusto + F-HEIC — el MISMO onFilePicked del lab sirve a sus dos
//  inputs, galería y cámara nativa iOS; aquí igual, remediación H5).
/** ¿El archivo es una imagen visible en el picker? (el picker filtra por
 *  accept, pero en desktop se puede elegir «todos los archivos»). */
function pareceImagen(archivo: File): boolean {
  return (
    archivo.type.startsWith("image/") ||
    /\.(heic|heif|jpe?g|png|webp|bmp|gif|avif)$/i.test(archivo.name)
  );
}

/** ¿Parece HEIC? Heurística del lab: los «.jpg» de iPhone transportados por
 *  apps pueden traer contenido HEIC; si la decodificación nativa falla
 *  también irán al rescate (F-HEIC del core), pero no se puede saber de
 *  antemano → aviso solo si es HEIC explícito. */
function esHeic(archivo: File): boolean {
  return /heic|heif/i.test(archivo.type) || /\.hei[cf]$/i.test(archivo.name);
}

/** Parámetros del hook — inyección de propietarios (movimiento puro). */
interface UseSelectorFuenteParams {
  /** Gate anti doble-captura (propietario: ScanView). */
  procesandoRef: RefObject<boolean>;
  /** Franja de avisos del visor (propietario: ScanView). */
  mostrarAviso: (texto: string, tono: "crit" | "warn", ms?: number) => void;
  /** Flujo de captura (useDestello) — tope por GAMA (capa 3 H2). */
  archivoDentroDeTope: (archivo: File, robusto: boolean) => Promise<File | null>;
  /** Acciones del store + flujo (identidad exacta del original). */
  setArchivoPendiente: (archivo: File) => void;
  setFuente: (fuente: FuenteCaptura) => void;
  dispararEscaneo: () => Promise<unknown>;
  despacharArchivo: (blobOArchivo: Blob, robusto: boolean) => Promise<void>;
}

export function useSelectorFuente({
  procesandoRef,
  mostrarAviso,
  archivoDentroDeTope,
  setArchivoPendiente,
  setFuente,
  dispararEscaneo,
  despacharArchivo,
}: UseSelectorFuenteParams) {
  // §E (SPEC-camara-funcional): aviso de cámara (denied/perdido) con
  // reintento — fin del rebote silencioso a SIMULACIÓN. reintentoCamara es
  // el token que re-dispara el efecto de arranque ([ACTIVAR CÁMARA]).
  const [reintentoCamara, setReintentoCamara] = useState(0);

  /** Elegir imagen = fuente ARCHIVO + análisis inmediato (L2) + capa 3 H2:
   *  la foto de galería (12–48 MP) entra al pipeline YA dentro del tope
   *  (decode único + downscaleImage por GAMA — dispatch L574-589 del lab).
 *  Guard F-IMPORT/HEIC del lab L937-948 (remediación H5). */
  const alElegirArchivo = (e: ChangeEvent<HTMLInputElement>) => {
    const archivo = e.target.files?.[0];
    e.target.value = ""; // permite re-elegir el MISMO archivo (REPETIR FOTO)
    if (!archivo) return;
    // FIX M4 (auditoría 2-b): guard temprano — con una captura en vuelo el
    // archivo se procesaría (tope/HEIC) para nada y el disparo se ignora.
    if (procesandoRef.current || useE14Store.getState().vista === "analizando") {
      mostrarAviso("ESPERA — YA HAY UNA CAPTURA EN CURSO", "warn", 2500);
      return;
    }
    if (!pareceImagen(archivo)) {
      mostrarAviso("ARCHIVO NO VÁLIDO — el archivo seleccionado no es una imagen.", "crit");
      return;
    }
    // HEIC explícito → aviso de conversión (puede tardar unos segundos; la
    // conversión vive en el F-HEIC del core, dentro del pipeline).
    if (esHeic(archivo)) {
      mostrarAviso("CONVIRTIENDO HEIC… la conversión puede tardar unos segundos.", "warn", 3000);
    }
    void (async () => {
      const final = await archivoDentroDeTope(archivo, true);
      if (!final) {
        // Fuente: apps/scanner-lab/src/components/scanner/CameraView.tsx
        // L954-L961 (error path de F-IMPORT) — franja del visor (§3.1.4).
        mostrarAviso(
          esHeic(archivo)
            ? "NO SE PUDO PROCESAR LA IMAGEN — no se pudo convertir el HEIC. El archivo parece dañado o protegido. Prueba con otro."
            : "NO SE PUDO PROCESAR LA IMAGEN — el archivo puede estar corrupto o ser un formato no soportado. Prueba con otro.",
          "crit",
          6000,
        );
        return;
      }
      setArchivoPendiente(final);
      setFuente("ARCHIVO");
      void dispararEscaneo();
    })();
  };

  /** Ruta iOS (HQ-iOS §5.2): la foto de la cámara nativa entra como archivo
   *  al MISMO pipeline (fuente ya es CÁMARA — spec §7 "como ARCHIVO, L2") +
   *  capa 3 H2: la foto nativa (12–48 MP, puede ser HEIC) pasa por el tope
   *  y la conversión robusta del core ANTES de tocar el bridge. Guard
   *  F-IMPORT/HEIC del lab L937-948 (remediación H5 — el mismo handler del
   *  lab sirve a sus dos inputs). */
  const alElegirFotoCamara = (e: ChangeEvent<HTMLInputElement>) => {
    const archivo = e.target.files?.[0];
    e.target.value = "";
    if (!archivo) return;
    // FIX M4 (auditoría 2-b): mismo guard del IMPORTAR (ruta iOS nativa).
    if (procesandoRef.current || useE14Store.getState().vista === "analizando") {
      mostrarAviso("ESPERA — YA HAY UNA CAPTURA EN CURSO", "warn", 2500);
      return;
    }
    if (!pareceImagen(archivo)) {
      mostrarAviso("ARCHIVO NO VÁLIDO — el archivo seleccionado no es una imagen.", "crit");
      return;
    }
    if (esHeic(archivo)) {
      mostrarAviso("CONVIRTIENDO HEIC… la conversión puede tardar unos segundos.", "warn", 3000);
    }
    void despacharArchivo(archivo, true);
  };

  return { reintentoCamara, setReintentoCamara, alElegirArchivo, alElegirFotoCamara };
}
