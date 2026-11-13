/**
 * KIT e14-simulacion-imagenes-v1 — fixtures de la galería «Simulación».
 *
 * El icono de simulación de ESCANEAR muestra estas imágenes para que cualquier
 * persona que revise el proyecto pruebe el escáner en condiciones ya conocidas
 * (completa, color, rotada, inclinada, con sombras y recortada por arriba o por
 * abajo). Son fotos de prueba incluidas en el repo: la simulación no envía al
 * hub ni ocupa el slot de la jornada.
 *
 * El desenlace NO está predefinido: cada imagen entra por el MISMO pipeline que
 * el botón «Importar» (orientación, completitud, esquinas, OCR y gate reales).
 */
import type { StaticImageData } from "next/image";

import thumbNormal from "@/assets/simuladas/thumbs/sim-normal.thumb.jpg";
import thumbColor from "@/assets/simuladas/thumbs/sim-color.thumb.jpg";
import thumbRotada from "@/assets/simuladas/thumbs/sim-rotada.thumb.jpg";
import thumbInclinada from "@/assets/simuladas/thumbs/sim-inclinada.thumb.jpg";
import thumbSombras from "@/assets/simuladas/thumbs/sim-sombras.thumb.jpg";
import thumbRecorteInferior from "@/assets/simuladas/thumbs/sim-recorte-inferior.thumb.jpg";
import thumbRecorteSuperior from "@/assets/simuladas/thumbs/sim-recorte-superior.thumb.jpg";

export type ImagenSimuladaId =
  | "normal"
  | "color"
  | "rotada"
  | "inclinada"
  | "sombras"
  | "recorte-inferior"
  | "recorte-superior";

export interface ImagenSimulada {
  id: ImagenSimuladaId;
  titulo: string;
  descripcion: string;
  thumb: StaticImageData;
  nombre: string;
  cargar: () => Promise<{ default: StaticImageData }>;
}

export const IMAGENES_SIMULADAS: readonly ImagenSimulada[] = [
  {
    id: "normal",
    titulo: "Normal",
    descripcion: "Acta completa, bien encuadrada y legible.",
    thumb: thumbNormal,
    nombre: "sim-normal.jpg",
    cargar: () => import("@/assets/simuladas/sim-normal.jpg"),
  },
  {
    id: "color",
    titulo: "Foto a color",
    descripcion: "La misma acta completa, con luz y color naturales.",
    thumb: thumbColor,
    nombre: "sim-color.jpg",
    cargar: () => import("@/assets/simuladas/sim-color.jpg"),
  },
  {
    id: "rotada",
    titulo: "Rotada 90°",
    descripcion: "Acta girada; el escáner la orienta automáticamente.",
    thumb: thumbRotada,
    nombre: "sim-rotada.jpg",
    cargar: () => import("@/assets/simuladas/sim-rotada.jpg"),
  },
  {
    id: "inclinada",
    titulo: "Inclinada",
    descripcion: "Encuadre torcido y descentrado, como una foto sin experiencia.",
    thumb: thumbInclinada,
    nombre: "sim-inclinada.jpg",
    cargar: () => import("@/assets/simuladas/sim-inclinada.jpg"),
  },
  {
    id: "sombras",
    titulo: "Con sombras",
    descripcion: "Sombra fuerte sobre el papel y fondo oscuro.",
    thumb: thumbSombras,
    nombre: "sim-sombras.jpg",
    cargar: () => import("@/assets/simuladas/sim-sombras.jpg"),
  },
  {
    id: "recorte-inferior",
    titulo: "Recortada por abajo",
    descripcion: "Falta el pie del acta (SUMA TOTAL).",
    thumb: thumbRecorteInferior,
    nombre: "sim-recorte-inferior.jpg",
    cargar: () => import("@/assets/simuladas/sim-recorte-inferior.jpg"),
  },
  {
    id: "recorte-superior",
    titulo: "Recortada por arriba",
    descripcion: "Falta la cabecera del acta (mesa y código).",
    thumb: thumbRecorteSuperior,
    nombre: "sim-recorte-superior.jpg",
    cargar: () => import("@/assets/simuladas/sim-recorte-superior.jpg"),
  },
];

export function imagenSimuladaPorId(id: ImagenSimuladaId): ImagenSimulada | undefined {
  return IMAGENES_SIMULADAS.find((imagen) => imagen.id === id);
}
