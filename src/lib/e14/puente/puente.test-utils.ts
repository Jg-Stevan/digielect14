/**
 * KIT e14-puente-supervision-v2 — UTILIDADES de la suite del puente (solo
 * tests; jamás importado por código de producción).
 */
import type { EntradaPuente } from "./tipos";

/** Entrada válida de prueba (contrato puente/tipos.ts). */
export function crearEntradadePrueba(
  puesto = "88_335_005_02",
  mesa = "001",
  paginaIndex = 1,
): EntradaPuente {
  return {
    idEnlace: puesto,
    mesa,
    formulario: "TRANSMISION",
    paginaIndex,
    paginaTotal: 2,
    srcFoto: `data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==${puesto}-${paginaIndex}`,
    impresion: {
      consulado: "CONSULADO QA",
      pais: "PAÍS QA",
      zona: "005",
      puesto: "02",
      mesa,
      lugar: "LUGAR QA",
    },
    nombreArchivo: `E14_${puesto}_${mesa}_TRANSMISION-${paginaIndex}.png`,
    score: 8.2,
    statusActa: "AUTO",
  };
}

/** Resetear el singleton del transporte y dejar la cola vacía entre tests. */
export async function resetearPuenteParaTests(): Promise<void> {
  const { borrarPendiente, leerPendientes } = await import("./cola");
  const { __resetEstadoParaTests } = await import("./envio");
  __resetEstadoParaTests();
  for (const fila of await leerPendientes()) {
    await borrarPendiente(fila.hash);
  }
}
