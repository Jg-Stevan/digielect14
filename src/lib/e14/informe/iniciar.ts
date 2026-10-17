/**
 * iniciar.ts — INFORME-TELEMETRÍA v1 (SPEC-informe-telemetria-ocr-v1 §4.8)
 *
 * Orquestador del informe: corre en 2.º plano tras CADA captura (gancho
 * §6.2 del store). Guard de concurrencia (gana la ÚLTIMA captura), delay
 * inicial 800 ms (deja pintar REVISIÓN/ENVIADA antes de competir por CPU),
 * matriz OCR, explicarScore, conclusiones, blobs TXT/JSON + auto-descarga.
 * Errores: catch general → estado "error" — NUNCA lanza hacia el store.
 */
import type { Acta } from "../types";
import { loadImage } from "@jg-stevan/scanner-core/image-processor";
import {
  evento,
  reiniciarEventos,
  limpiarBlobsInforme,
  informeStore,
  nombreArchivoInforme,
  tomarUltimoPipeline,
} from "./telemetria";

import { correrMatriz, resetInitsMatriz, type MatrizResultado } from "./matriz";
import { construirInforme, emitirInforme } from "./generar";
import type { Quad } from "@jg-stevan/scanner-core/types";

export interface CtxInforme {
  fuente: "SIMULACION" | "CAMARA" | "ARCHIVO";
  intento: number;
  maxIntentos: number;
  objetivo: { mesaId: string; tipo: string; pagina: 1 | 2 } | null;
  simular: boolean;
}

let flagCancelado = false;
let corriendo = false;

export async function iniciarInformeCaptura(acta: Acta, ctx: CtxInforme): Promise<void> {
  // Guard de concurrencia: gana la ÚLTIMA captura (aborta el informe anterior)
  if (corriendo) {
    flagCancelado = true;
    evento("informe/abortado", "una captura nueva ganó — el informe anterior se aborta");
  }
  corriendo = true;
  const miTicket = Symbol("informe");
  const cancelado = () => flagCancelado;

  try {
    // estado visible: procesando (la píldora SOLO aparece al estar "listo")
    informeStore.setState({ estado: "procesando", nombreBase: null, error: null });
    limpiarBlobsInforme();
    reiniciarEventos();
    resetInitsMatriz();
    evento(
      "informe/inicio",
      `fuente=${ctx.fuente} intento=${ctx.intento}/${ctx.maxIntentos} simular=${ctx.simular} · acta ${acta.id}`,
    );

    // delay inicial 800 ms (deja pintar REVISIÓN/ENVIADA)
    await new Promise((r) => setTimeout(r, 800));
    if (cancelado()) return;

    // dims de la foto original (para el informe; falla → null, no aborta)
    let fotoW = 0;
    let fotoH = 0;
    if (acta.fotoOriginal) {
      try {
        const img = await loadImage(acta.fotoOriginal);
        fotoW = img.naturalWidth || img.width;
        fotoH = img.naturalHeight || img.height;
      } catch {
        evento("informe/aviso", "la foto original no se pudo decodificar para dims");
      }
    }

    // matriz OCR (guards internos: sin foto/quad → omitida con motivo, AC-3)
    const foto: { original: string; quad: Quad | null; rotacion?: number } = {
      original: acta.fotoOriginal ?? "",
      quad: acta.quadDetectado ?? null,
      rotacion: acta.rotation,
    };
    const matriz: MatrizResultado = await correrMatriz(foto);
    evento(
      "informe/matriz",
      `${matriz.celdas.length} celdas en ${matriz.duracionMs} ms${matriz.omitidaMotivo ? ` · OMITIDA: ${matriz.omitidaMotivo}` : ""}`,
    );
    if (cancelado()) return;
    void fotoW;
    void fotoH;

    // salida temprana del pipeline → marcar NO registrado (AC-3)
    if (!tomarUltimoPipeline()) {
      evento("informe/aviso", "pipeline sin registro (salida temprana) — informe con AC-3");
    }

    // informe completo + blobs + auto-descarga
    const informe = await construirInforme(
      acta,
      {
        fuente: ctx.fuente,
        intento: ctx.intento,
        maxIntentos: ctx.maxIntentos,
        objetivo: ctx.objetivo,
        simular: ctx.simular,
      },
      matriz,
    );
    if (cancelado()) return;

    const base = nombreArchivoInforme("txt").replace(/\.txt$/, "");
    await emitirInforme(informe, matriz.textos, base);
    if (cancelado()) return;

    informeStore.setState({ estado: "listo", nombreBase: base, error: null });
    evento("informe/listo", `píldora activa — informe ${base}(.txt/.json)`);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    evento("informe/error", msg);
    // log de auditoría en consola (patrón del repo — diagnóstico en campo;
    // el kit §8.6 lo revisa en dev.log/consola)
    console.info("[e14-informe] error:", msg, e instanceof Error ? e.stack : "");
    try {
      informeStore.setState({ estado: "error", nombreBase: null, error: msg });
    } catch {
      /* jamás lanza hacia el store */
    }
  } finally {
    if (!cancelado()) {
      corriendo = false;
      flagCancelado = false;
    }
  }
}
