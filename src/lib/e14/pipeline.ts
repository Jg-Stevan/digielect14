/**
 * Pipeline §5 (ARCHIVO y CAMARA comparten etapas y mapeo; ms por etapa en
 * consola).
 *
 * FASE F (plan post-v2.3) — SPLIT DEL BRIDGE: el CUERPO de este pipeline llegó
 * aquí MOVIDO desde `RealCoreBridge.pipeline` (move-only; mismas decisiones,
 * mismos emits, mismo orden). Este repo comparte los helpers de §5 con el
 * pipeline de RECORTE (§7.5), así que en vez de arrastrar ~900 líneas de
 * helpers se reciben INYECTADOS por `PasosPipelineL2` (literal que arma el
 * bridge — «pasos inyectables» del plan). Tipos y funciones auxiliares siguen
 * viviendo en `scanner-core-bridge.ts`: aquí solo se IMPORTA el tipo
 * (`import type` se borra en el emit → la dirección de VALORES es únicamente
 * bridge → pipeline, cero ciclo en runtime).
 */
import {
  detectDocumentEdgesDetail,
  processImage,
} from "@jg-stevan/scanner-core/core/image-processor";
import type { OrigenQuad } from "@jg-stevan/scanner-core/core/image-processor";
import { ocrTextIsValid } from "@jg-stevan/scanner-core/core/ocr";
import type { PageFilter, Quad } from "@jg-stevan/scanner-core/core/types";
import { cargarDivipol } from "@jg-stevan/scanner-core/dominio/divipol";
import {
  clasificarCabecera,
  faltaSeccionInferior,
  PATRON_CABECERA,
  tipoDeBanda,
} from "@jg-stevan/scanner-core/dominio/clasificador";
import { procesadaVaciaDataUrl } from "@jg-stevan/scanner-core/dominio/image-utils";
import {
  ESQUINAS_OK,
  cuatroEsquinasFaltan,
  ladoEsquinaFaltante,
  perdonFaltaFiduciales,
  trazaEsquinas,
} from "@jg-stevan/scanner-core/dominio/integridad";
import {
  verificarCompletitud,
  type ResultadoCompletitud,
} from "@jg-stevan/scanner-core/dominio/completitud";
import { medirZonaVotos } from "@jg-stevan/scanner-core/dominio/marcadores";
import {
  PISO_LECTURA_FUERTE,
  TECHO_LECTURA_DEBIL,
  lazoPerdonadoPorLectura,
  senalDeLectura,
} from "@jg-stevan/scanner-core/dominio/senal-lectura";
import type {
  Acta,
  ActaStatus,
  DiagnosticoActa,
  ProgresoAnalisis,
} from "@jg-stevan/scanner-core/dominio/types";
import { cascadaActiva } from "@jg-stevan/scanner-core/orquestacion/cascada";
import { construirDiagnostico } from "@jg-stevan/scanner-core/dominio/diagnostico";
import { probeOrientacion, rotarDataUrl } from "./orientacion";
import type { ProbeOrientacion } from "./orientacion";
import { brujulaQrOrientacion } from "./orientacion-qr";
import type { BrujulaQr } from "./orientacion-qr";
import { leerFlags } from "./flags";
import { esperaWorkerEfectiva, presupuestoEscaneoEfectivo } from "./adaptacion/plan";
import { logger } from "../logger";
// Tipos del bridge — SOLO tipos (el emit no lleva require alguno).
import type {
  EntradaPipeline,
  InfoCrop,
  OpcionesEscaneoConTimeout,
  ParcialPipeline,
  PasosPipelineL2,
  ResultadoGate,
} from "./scanner-core-bridge";

export async function correrPipelineL2(
  opciones: OpcionesEscaneoConTimeout,
  entrada: EntradaPipeline,
  parcial: ParcialPipeline,
  emitir: (p: ProgresoAnalisis) => void,
  pasos: PasosPipelineL2,
): Promise<Acta> {
  const ms = {
    decode: 0,
    detect: 0,
    proceso: 0,
    calidad: 0,
    ocr: 0,
    total: 0,
    orient: 0,
    cierre: 0,
    // KIT e14-velocidad-5s-v1 — `orient` era un bloque de ~1 s SIN DUEÑO:
    // se subdivide (brújula QR vs. lo demás: esquinas/completitud/visor).
    brujula: 0,
    esq: 0,
  };
  const inicio = performance.now();

  // 1) Entrada → data URL crudo (F-IMPORT del core: HEIC/EXIF/12MP seguros;
  //    en CAMARA sin archivo el dataUrl ya vino del grab del <video>).
  emitir({ etapa: "DETECTANDO", progreso: 0 });
  const fotoOriginal =
    "archivo" in entrada
      ? await pasos.conRampa(
          // Decode con memo POR FILE (re-escaneos del MISMO archivo → HIT).
          pasos.decodeArchivoMemo(entrada.archivo),
          700,
          (f) => ({ etapa: "DETECTANDO", progreso: f * 0.5 }),
          emitir,
        )
      : entrada.dataUrl;
  ms.decode = performance.now() - inicio;
  parcial.fotoOriginal = fotoOriginal;

  // e64-qr T-2.1 — CAPA 0 QR también en cámara (kit FASE 2 / hermano C-1):
  // el MISMO decodificador de la capa QR (src/lib/e14/qr — reubicada tras
  // la eliminación del módulo masiva; import DINÁMICO — el bundle crítico
  // del escaneo no engorda), señal ADITIVA — jamás afecta score/gate/OCR
  // ni consume intento. Se lanza EN PARALELO al pipeline (el tier base
  // resuelve en ~0.3-0.5 s — mucho antes del OCR) y se ESPETA donde el
  // acta se construye. tiers "base" — ADAPTACIÓN DECLARADA: la cadena
  // completa (~15-17 s sin-QR, bloques sync) rompería el timeout del
  // flujo individual. El catch es el fallback silencioso del kit: sin la
  // señal, el flujo de cámara sigue intacto.
  // KIT e14-capa0-qr-worker-v1 — la cadena corre en WORKER (port D40+R1.1+
  // R1.4-b de supervision-e14): presupuesto real por tier (unificada 8 s ·
  // BAJO 5 s sin rescate 4096 — floor anti-OOM), fases/fin telemetría y
  // cero bloques sync en el hilo UI. El wrapper del cliente cae al camino
  // de HOY (tiers "base" en main) si el worker no corrió — kill-switch
  // `capa0QrWorker: false` ⇒ byte-idéntico a este bloque de siempre.
  const qrCamPromesa: Promise<ParcialPipeline["qrCam"]> = (async () => {
    try {
      const { decodificarQrCapa0Camara } = await import("./qr/capa0-qr.client");
      return await decodificarQrCapa0Camara(fotoOriginal);
    } catch {
      try {
        const { decodificarQrDeCapture } = await import("@jg-stevan/scanner-core/qr/identidad-qr");
        return await decodificarQrDeCapture(fotoOriginal, { tiers: "base" });
      } catch {
        return null; // sin-payload — el flujo de cámara sigue intacto
      }
    }
  })();
  // KIT e14-velocidad-5s-v1 — el techo de ESPERA, no el de la cadena: la
  // señal QR es ADITIVA (líneas arriba: jamás toca score/gate/OCR), así que
  // el pipeline NO puede pagarla. Con el CPU saturado por el rec, el worker
  // capa0 no muere — va LENTO, y el único tope real era el hard-kill a
  // presupuesto+gracia (8 000+1 500 ms) seguido del rescate en MAIN: el
  // `await` de abajo cargaba con los ~3,1 s que Medición separó como
  // `cierreMs` en 084854/084939 (chg→rev 14.176 con worker ON vs 9.606 con
  // el mismo rec cortado). El rescate en MAIN es aún peor: `capa0QrWorker:
  // false` medido bloqueó el hilo que el warp necesita → procesoMs 4.215
  // (vs 1.517). Se espera 400 ms (el tier base resuelve en ~0,3-0,5 s) y si
  // no llega, se sigue SIN ella — la brújula ya aporta el payload cuando lo
  // vio, así que en el caso común no hay nada que esperar.
  const ESPERA_QR_CAM_MS = 400;
  let qrCamAterrizado = false;
  const aterrizarQrCam = async (): Promise<void> => {
    if (qrCamAterrizado) return;
    qrCamAterrizado = true;
    if (parcial.qrCam) return; // la brújula ya la trajo — nada que esperar
    const noLlego = new Promise<{ listo: false }>((r) =>
      setTimeout(() => r({ listo: false }), ESPERA_QR_CAM_MS),
    );
    const señal = await Promise.race([
      qrCamPromesa.then(
        (v) => ({ listo: true, v }) as const,
        () => ({ listo: true, v: null }) as const,
      ),
      noLlego,
    ]);
    if (señal.listo) parcial.qrCam = señal.v;
  };

  // 2) Detección de bordes (worker OpenCV → fallback Sobel del core).
  //    §D8.3 (SPEC-e14-score-ocr Rev. 3): con sinRecorte la detección NO
  //    corre — «el recorte es la foto entera»: pasos.quadIdentidad (se imprime
  //    en el log como hoy, traza de auditoría). SOLO alcanzable desde la
  //    rama SIMULACIÓN (ARCHIVO/CÁMARA corren detect byte a byte, AC15).
  const sinRecorte = "archivo" in entrada && entrada.sinRecorte === true;
  let quad: Quad;
  // KIT e14-quad-sobel-v1 (P1 §4-B): quién fabricó el quad de verdad —
  // "worker" (la cascada ganó) o "sobel" (el fallback, incluido el catch del
  // propio Sobel con rect por defecto). null SOLO si ni siquiera corrió una
  // detección (n/d jamás miente — misma filosofía del T-A).
  let quadOrigen: OrigenQuad | "pagina-completa" | null = null;
  // KIT e14-masiva-ux-v1 (T1): trazabilidad del arreglo en el log — si
  // corrió el reintento (§3-T1.2). Solo AÑADIR campos al final del
  // formato (los instrumentos del dueño lo parsean).
  let detectReintento = false;
  const tDetect = performance.now();
  if (sinRecorte) {
    quad = pasos.quadIdentidad;
  } else {
    try {
      // T1.1: worker frío → esperar su warm-up con tope de 5 s (mecanismo
      // del core — el mismo que ScanView invoca al montar). Si a los 5 s
      // no está listo, continuar como hoy (no bloquear más).
      await pasos.esperarWorkerCaliente(esperaWorkerEfectiva());
      let detalle = await pasos.conRampa(
        detectDocumentEdgesDetail(fotoOriginal),
        900,
        (f) => ({ etapa: "DETECTANDO", progreso: 0.5 + f * 0.4 }),
        emitir,
      );
      // T1.2: el fallback Sobel FABRICÓ el quad (worker frío/ocupado) →
      // esperar de nuevo (tope 5 s) y reintentar UNA sola vez. Si el
      // reintento viene del worker, manda ese quad; si no, conservar el
      // quad original (comportamiento actual — kit §3-T1.2).
      if (detalle.origen === "sobel") {
        const caliente = await pasos.esperarWorkerCaliente(esperaWorkerEfectiva());
        if (caliente) {
          detectReintento = true;
          try {
            const reintento = await detectDocumentEdgesDetail(fotoOriginal);
            if (reintento.origen === "worker") detalle = reintento;
          } catch {
            /* reintento falló → quad original (kit §3-T1.2) */
          }
        }
      }
      quad = detalle.quad;
      quadOrigen = detalle.origen;
    } catch {
      // El core SIEMPRE devuelve Quad; una EXCEPCIÓN aquí = imagen no
      // detectable → RECHAZADA ILEGIBLE inmediata (§5 paso 1, spec §7.5).
      // El piso escénico D16 de ANALIZANDO completa la animación solo.
      await aterrizarQrCam(); // e64-qr T-2.1: la señal QR viaja si terminó
      return pasos.construirActa(opciones, parcial, {
        score: 0,
        scoreVisual: 0,
        status: "RECHAZADA",
        rechazo: { tipo: "ILEGIBLE", detalle: pasos.DETALLE_ILEGIBLE },
      });
    }
  }
  ms.detect = performance.now() - tDetect;
  emitir({ etapa: "DETECTANDO", progreso: 1 });

  // KIT e14-velocidad-5s-v1 — la CALIDAD se mide sobre la ORIGINAL + quad
  // (NO necesita el warp): se LANZA aquí, así su muestreo no suma ~180 ms en
  // serie justo antes del OCR. El `await` queda en el paso 4 de siempre —
  // mismos emits, misma semántica, mismo orden de lectura de `infoCrop`.
  const infoCrop: InfoCrop = { w: 0, h: 0, fallback: false };
  const calidadPromise = pasos.calidadDeActa(fotoOriginal, quad, infoCrop);

  // GUARD-BORDE Rev. 2 (§3b, D1/D3/D4): la señal de ACTA COMPLETA ya NO se
  // decide aquí con la geometría (el falso positivo del dueño: quad al filo
  // con la imagen perfecta — score 6.4). El cálculo se MUEVE a DESPUÉS del
  // paso 3 (recorte): la condena exige analizar la TINTA del recorte al
  // filo («la geometría sospecha, la tinta condena»). Helper ÚNICO
  // verificarCompletitud (AC11) — con `simular` la verificación SE OMITE
  // (completa = true forzado): la foto del chip MEDIO ES una acta cortada a
  // propósito y jamás debe caer INCOMPLETA desde un chip (AC3/AC6 de
  // simulacion-scores; AC7 del guard).

  // 3) Recorte + realce (warp real INTER_CUBIC + filtro default "bw").
  //    §D8.3 (SPEC-e14-score-ocr Rev. 3): con sinRecorte se OMITE
  //    processImage — fotoProcesada = fotoOriginal (sin warp, sin filtro
  //    "bw", sin realce: la b/n del dueño YA trae su filtro · la borrosa
  //    queda original), motor "canvas" (solo traza) y el acta nace con
  //    filtro "original" (veracidad en el editor — al elegir B/N aplica
  //    sobre la foto completa). Los ramps RECORTANDO/REALZANDO se
  //    CONSERVAN (misma animación de ANALIZANDO — la etapa resuelve al
  //    instante). El editor (recortar/cambiarFiltro) sigue operando normal
  //    con quadDetectado = identidad.
  emitir({ etapa: "RECORTANDO", progreso: 0.2 });
  const tProceso = performance.now();
  // KIT e14-velocidad-5s-v1 — lado mayor de trabajo del warp (flag, con
  // default del contrato). 4032 = args de siempre (camino byte-idéntico).
  const ladoTrabajo = leerFlags().ladoMaxTrabajoPx;
  let fotoProcesada: string;
  let filtroActa: PageFilter;
  let motor: "worker" | "canvas";
  // KIT e14-ocr-lee-original-v1 (PROD-1 §4.1): variante de ENTRADA del OCR +
  // traza de su origen (§4.4). "original" = crudo del warp (warp sin realce,
  // misma geometría que la bw — §3 del kit) · "original-as-is" = SIM (la
  // original YA es la entrada) · "bw-fallback" = la variante nueva falló y
  // el OCR lee la bw (comportamiento de hoy — §5: el pipeline JAMÁS muere
  // por la variante nueva, pitfall §9.6).
  let fotoOcr: string;
  let ocrIn: "original" | "original-as-is" | "bw-fallback";
  if (sinRecorte) {
    fotoProcesada = fotoOriginal;
    filtroActa = "original";
    motor = "canvas";
    // PROD-1 (§4.1): SIM as-is — la entrada del OCR YA era la original:
    // cero llamadas nuevas (chips SIM 8.2/7.0/4.3 intactos por construcción).
    fotoOcr = fotoOriginal;
    ocrIn = "original-as-is";
    emitir({ etapa: "REALZANDO", progreso: 1 });
  } else {
    // PROD-1 (§4.1): DOS variantes bajo la MISMA conRampa — bw para
    // MOSTRAR/GUARDAR (hoy) y "original" (warp sin realce) para LEER.
    // .catch(() => null) DENTRO del Promise.all (aclaración final del kit):
    // si processImage("original") rechaza, Promise.all NO rechaza — decide
    // con el resultado null → bw-fallback (§5). El pipeline NUNCA muere por
    // la variante nueva.
    // KIT e14-velocidad-5s-v1 (`ocrLeerBw`): el segundo warp cuesta ~0,9 s en
    // el A56 y la CPU está saturada (7,7 de 8 núcleos durante el rec) — con
    // el flag ON se lee la bw y el warp del OCR NO corre. Default OFF = HOY
    // byte a byte; el A/B es el de siempre (override en el celular).
    const leerBw = leerFlags().ocrLeerBw;
    // KIT e14-velocidad-5s-v1 (`ladoOcrPx`): el acta que se MUESTRA/GUARDA se
    // trabaja a `ladoMaxTrabajoPx`, pero la que se LEE no necesita tanto: el
    // det se capa a 1280 en la 1.ª pasada y el rec lee líneas a 32 px de alto.
    // 0 = el mismo lado de siempre (byte-idéntico). PISO PRÁCTICO 1920: la
    // 2.ª pasada del escalonado y el rescate ROI re-leen `fotoOcr` a cap 1920
    // — por debajo de eso la escalada pierde resolución y son exactamente las
    // fotos duras las que necesitan escalar.
    const ladoOcr = leerFlags().ladoOcrPx;
    const ladoLectura = ladoOcr > 0 ? Math.min(ladoOcr, ladoTrabajo) : ladoTrabajo;
    const [resultado, resultadoOcr] = await pasos.conRampa(
      Promise.all([
        // (captura arranca en B/N adaptativo) + types.ts L50 (default del
        // producto) — D36: e14 no tiene ajustes → el default fijo es "bw".
        // KIT e14-velocidad-5s-v1 (`ladoMaxTrabajoPx`): el warp escala
        // ~cuadrático con el lado y el det del OCR se capa a 1280/1920 de
        // todos modos — trabajar a 2560 recorta el warp+enhance+encode sin
        // tocar lo que el motor ve. override {"ladoMaxTrabajoPx":4032} ⇒
        // args de siempre (byte-idéntico, WYSIWYG a resolución del lente).
        processImage(fotoOriginal, quad, "bw", 0, { maxLongSide: ladoTrabajo }),
        // PROD-1: la misma geometría (mismo warp, MISMA convención
        // POST-warp — pitfall §9.5), solo cambia el filtro final.
        leerBw
          ? Promise.resolve(null)
          : processImage(fotoOriginal, quad, "original", 0, {
              maxLongSide: ladoLectura,
            }).catch(() => null),
      ]),
      // msEstimados 1400→2200 (§4.1): el segundo warp (~0.6-1.3 s, §1.4)
      // se cubre con la MISMA rampa (el core serializa en su worker).
      2200,
      // RECORTANDO .2→.6 (warp) → REALZANDO .4→1 (enhance), interpolado.
      (f) =>
        f < 0.55
          ? { etapa: "RECORTANDO", progreso: 0.2 + (f / 0.55) * 0.4 }
          : { etapa: "REALZANDO", progreso: 0.4 + ((f - 0.55) / 0.45) * 0.6 },
      emitir,
    );
    ms.proceso = performance.now() - tProceso;
    emitir({ etapa: "REALZANDO", progreso: 1 });
    fotoProcesada = resultado.processed;
    filtroActa = "bw";
    motor = resultado.precision?.engine ?? "canvas";
    // PROD-1 (§4.1) — entrada del OCR, con fallback que JAMÁS rompe el
    // pipeline: fotoOcr queda = fotoProcesada (comportamiento de hoy).
    fotoOcr = fotoProcesada;
    ocrIn = "original";
    if (resultadoOcr?.processed) {
      fotoOcr = resultadoOcr.processed;
    } else {
      ocrIn = "bw-fallback";
    }
  }
  // KIT e14-orientacion-auto-v1 (T-A2): probe de orientación DESPUÉS de fijar
  // fotoOcr (tras el warp, §2.1) y ANTES del OCR completo y de TODA medición
  // downstream (esquinas/completitud/visor ven el acta YA derecha). SIM:
  // OMITIDO (§2.2 — mismo guard del banda/esquinas; chips 8.2/7.0/4.3
  // intactos). sinRecorte solo existe en SIM en esta base → cubierto por el
  // MISMO guard. Al aplicar se giran fotoOcr Y fotoProcesada (re-encode
  // JPEG q0.92, §2.1 paso 4) para que el acta visible/guardada quede
  // derecha; JAMÁS lanza (catch interno — el pipeline no depende, §5).
  // D57 — KIT e14-instrumentos-espera-v1 (T2): coste del probe persistido
  // en el diagnóstico (aditivo — la traza de consola D51 ya existe; esto la
  // vuelve permanente en la ficha). null si el probe no corrió (SIM o error).
  let probeMsOrientacion: number | null = null;
  // WAVE2 A1 — sub-decisión de la miniatura descartada por el fallo seguro
  // (datos para calibración wave 3 — jamás cambia la decisión de HOY).
  let probeMiniOrientacion: ProbeOrientacion["orientacionProbeMini"] | null =
    null;
  // NOTA (eliminación del módulo masiva): la rama e66/e70 (skip por EXIF de
  // cámara con confirmación del probe) viajaba con `origenSenales`, señal
  // que SOLO llenaba el runner MASIVA — retirada con la cola. El probe
  // plano de abajo es el único camino de sondeo ahora (como en el flujo
  // individual de siempre sin la señal).
  // KIT e14-orientacion-qr-v1 (T-A) — QR-BRÚJULA PRIMERO: el cuadrante del
  // QR (hogar del E-14: TL del acta derecha) manda la rotación SIN OCR
  // (bench v8.3 del dueño: 4/4 con fotos arrugadas/blotchy donde jsQR
  // sobre el warp daba 0/4 — el rescate hi-res guiado por el quad con
  // ZXing rescató TODAS). El sondeo OCR de abajo SOLO corre si la brújula
  // NO decidió (red de seguridad — comportamiento de HOY byte a byte).
  // Kill-switch: flags.qrBrujulaOrientacion (OFF = byte-idéntico a hoy).
  // Guards: SIM jamás (§2.2 — chips 8.2/7.0/4.3 intactos) · sinRecorte no
  // tiene warp/quad real (SIM-only en esta base → cubierto igualmente).
  let brujula: BrujulaQr | null = null;
  // KIT e14-velocidad-5s-v1 — el hueco entre el warp y la CALIDAD (brújula
  // QR + probe + rotación + esquinas + completitud + procesadaVacia) no
  // estaba medido: en el A56 eran ~1,1 s sin dueño dentro de totalMs.
  const tOri = performance.now();
  if (!opciones.simular && !sinRecorte && leerFlags().qrBrujulaOrientacion) {
    brujula = await brujulaQrOrientacion(fotoOcr, fotoOriginal, quad);
    if (brujula) {
      if (brujula.rot !== 0) {
        // Misma aplicación del probe (T-A2 §2.1 paso 4): se giran fotoOcr Y
        // fotoProcesada (re-encode q0.92) para que el acta visible/guardada
        // quede derecha. rotarDataUrl JAMÁS lanza (catch interno, §5).
        fotoOcr = await rotarDataUrl(fotoOcr, brujula.rot);
        fotoProcesada = await rotarDataUrl(fotoProcesada, brujula.rot);
      }
      // e64-qr T-2.1 — señal de identidad ADITIVA: si la capa base no leyó
      // y la brújula sí, el payload OPACA viaja como qrCam (mismo contrato
      // de construirActa — SOLO presencia, red line 10).
      if (!parcial.qrCam) {
        parcial.qrCam = { payload: brujula.payload };
      }
    }
  }
  if (brujula === null && !opciones.simular) {
    // Merge e14-gama-baja-20s + tessbest (PR #118): el presupuesto del probe
    // se resuelve DENTRO de orientacion.ts por tier (BAJO 150 s · MEDIO 60 s ·
    // ALTO 12 s — presupuestoProbeOrientacionEfectivo); el fail-fast de 6 s
    // del kit original quedó subsumido (evidencia: sondeo cortado ⇒ acta
    // RECHAZADA — ver KNOBS_OCR_POR_TIER en adaptacion/plan.ts).
    const probe = await probeOrientacion(fotoOcr);
    if (probe != null) probeMsOrientacion = probe.ms; // D57 T2
    probeMiniOrientacion = probe?.orientacionProbeMini ?? null; // WAVE2 A1 — la mini que el fallo seguro descartó
    if (probe?.aplicado) {
      fotoOcr = await rotarDataUrl(fotoOcr, probe.rot);
      fotoProcesada = await rotarDataUrl(fotoProcesada, probe.rot);
    }
  }
  // KIT e14-velocidad-5s-v1 — corte de la medición: todo lo de arriba es
  // DECISIÓN DE ORIENTACIÓN (brújula QR o, si no, sondeo OCR); lo que sigue
  // son MEDICIONES SOBRE LA YA ORIENTADA (esquinas/completitud/visor).
  ms.brujula = performance.now() - tOri;
  const tEsq = performance.now();
  // KIT consenso-frankfurt-v1 (FASE 2, §3): esquinas fiduciales ANTES del
  // guard — la marca presente es PRUEBA POSITIVA de que el papel está
  // entero dentro del cuadro (ANALISIS §5.1) → verificarCompletitud la
  // consulta y perdona la sospecha geométrica (§0-F2: Frankfurt 746 al
  // filo condenaba INCOMPLETA 6.4 falso). UNA sola medición (helper único
  // esquinasDeActa — §4.4); SOLO fuera de SIM (assets de la demo sin
  // marcas calibradas — chips 8.2/7.0/4.3 intactos, MISMO guard del kit
  // identificacion-codigo-v1). <80×120 → null (n/d — jamás condena).
  const esquinas = opciones.simular ? ESQUINAS_OK : await pasos.esquinasDeActa(fotoProcesada);
  const ladoEsquina = esquinas ? ladoEsquinaFaltante(esquinas) : null;
  const trazaEsq = opciones.simular ? "sim" : trazaEsquinas(esquinas);
  // GUARD-BORDE Rev. 2 (§3b): la verificación de completitud corre DESPUÉS
  // del paso 3 — fotoProcesada ya existe (la tinta al filo se mide SOBRE el
  // recorte, no sobre la foto cruda). Helper ÚNICO (D3/AC11). El análisis
  // SOLO arranca si la geometría sospecha (D4: quad sano → costo cero) y
  // vuela EN PARALELO con CALIDAD/OCR: se espera justo antes del gate
  // (presupuesto propio <30 ms p95 — §3d/AC9). Con `simular` NO corre
  // (completa = true forzado — AC7). Nota sinRecorte: SOLO alcanzable desde
  // la rama SIMULACIÓN (AC15 score-ocr) → también cubierto por el skip.
  // FASE 2 (§3): recibe las esquinas — 4 fiduciales presentes → la
  // sospecha geométrica NO condena (papel entero demostrado).
  const verificacion: Promise<ResultadoCompletitud> | null = opciones.simular
    ? null
    : verificarCompletitud(quad, fotoProcesada, esquinas);
  // §D4 (SPEC-e14-score-ocr): visor nunca vacío — tinta de la PROCESADA
  // (muestreo 64×64): un warp sin tinta (quad degenerado sobre superficie
  // lisa → blanco puro del B/N adaptativo) marca el acta para que REVISIÓN
  // muestre la ORIGINAL con su nota. Con tinta (aunque poca, p. ej. la
  // borrosa B/N) se muestra la procesada como hoy — sin regresión.
  const procesadaVacia = await procesadaVaciaDataUrl(fotoProcesada);
  ms.esq = performance.now() - tEsq;
  ms.orient = performance.now() - tOri;

  // 4) Calidad de la página (Laplaciano + contraste + brillo).
  //    KIT visor-accion-score-v1 (FASE S): se evalúa el RECORTE del acta
  //    (bbox del quad), NO el encuadre completo — la mesa oscura alrededor
  //    ya no hunde el brillo global (§S.0; fallback al frame como hoy).
  emitir({ etapa: "CALIDAD", progreso: 0 });
  const tCalidad = performance.now();
  // (KIT e14-velocidad-5s-v1: la medición se LANZA tras el detect — ver
  //  `calidadPromise` — aquí solo se COSECHA; ms.calidad mide la espera)
  const calidad = await calidadPromise;
  ms.calidad = performance.now() - tCalidad;
  emitir({ etapa: "CALIDAD", progreso: 1 });

  // KIT e14-velocidad-5s-v1 — RECHAZO TEMPRANO (flag `ocrCorteIncompleta`).
  // La verificación de completitud se COSECHA acá (antes se esperaba junto al
  // gate) porque es la única condena que se decide SIN leer una letra: sale de
  // la geometría del quad + los fiduciales sobre `fotoProcesada`, y `completa`
  // se copia de ella (§F-2) — el veto 4/4 de abajo solo puede volverla MÁS
  // falsa. Si ya dijo `completa:false`, el desenlace está bloqueado (RECHAZADA
  // o contingencia, jamás auto-envío) por más texto que saque el OCR, y sin
  // embargo la escalada se corría por inercia. Medido con una acta recortada
  // por un lado (corte-lado, 86 % del ancho de 084901): la 1.ª pasada + re-OCR
  // 1920 (3 269 ms) + ROI (1 979) + Tesseract (1 597) = 24 056 ms para un acta
  // que terminó 4.9 RECHAZADA igual. Con el corte: 17 231 ms, mismo 4.9.
  // Se sigue cobrando UNA pasada (el texto alimenta el informe, la nota de
  // REVISIÓN y el panel de corrección con que el operador puede rescatarla) y
  // se corta ahí. No se corta la banda del sello ni el sondeo de orientación:
  // la primera es justamente lo que usa ese panel, y el segundo ya había
  // corrido (vive antes de las esquinas, que son insumo de este guard).
  const verificacionResuelta = verificacion ? await verificacion : null;
  const rechazoTemprano =
    !opciones.simular &&
    leerFlags().ocrCorteIncompleta &&
    verificacionResuelta != null &&
    !verificacionResuelta.completa;

  // 5) OCR sobre la variante de ENTRADA del OCR (PROD-1 §4.1: el recorte
  //    SIN filtro — regla del dueño; la bw pasa a ser SOLO la imagen de
  //    presentación/guardado). KIT e14-ocr-escalonado-v1 (§2): OCR
  //    ESCALONADO — 1.ª pasada det 1280 → re-OCR 1920 SOLO si la lectura
  //    sale débil, el MEJOR manda (el gate JAMÁS ve un texto degradado si
  //    el 1920 lo salva); SIM: flujo de hoy a 1920, 0 trazas (§3). Motor
  //    RapidOCR PP-OCRv4 (PROD-2 §2-C2); progreso REAL por lotes de rec
  //    (§2-C4) — la 2.ª pasada reusa el MISMO emit (§3).
  const tOcr = performance.now();
  const onProgresoOcr = (p: number): void => {
    emitir({ etapa: "OCR", progreso: Math.min(1, Math.max(0, p)) });
  };
  // §3 presupuesto: el timeout EXISTENTE del pipeline manda (opcional por
  // OpcionesEscaneoConTimeout; default presupuestoEscaneoEfectivo() — plan
  // por tier del KIT e14-ocr-tessbest-v1).
  const cfgOcr = {
    simular: opciones.simular === true,
    presupuestoMs: (opciones as OpcionesEscaneoConTimeout).timeoutMs ?? presupuestoEscaneoEfectivo(),
    inicioMs: inicio,
    // KIT e14-velocidad-5s-v1 — el cuadrante del QR YA dijo cómo va el acta
    // (rotación aplicada arriba si hacía falta): el sondeo cls del motor es
    // redundante. Sin brújula (QR no leído) → false = cls de siempre.
    orientacionDecidida: brujula !== null,
    // KIT e14-velocidad-5s-v1 — ver `rechazoTemprano` arriba: con el veredicto
    // bloqueado antes del OCR, ninguna escalada (1920, ROI, motor de rescate)
    // cambia el desenlace.
    corteIncompleta: rechazoTemprano,
  };
  // KIT e14-ocr-cascada-v1 (K3 fase 2): SOLO con `ocrCascada` ON (antes
  // `masivaOcrTesseract` — renombrado al retirar la cola MASIVA) y fuera
  // de SIM corre la cascada (gate entre motores + rescate ROI — ancla del
  // brief: «tras SU warp full-res», fotoOcr ya existe); default OFF ⇒ el
  // OCR ESCALONADO de siempre byte a byte (mismos args, misma closure de
  // progreso — smoke flag-OFF).
  const ocrEsc = cascadaActiva(leerFlags().ocrCascada, opciones.simular === true)
    ? await pasos.reconocerRapidOcrCascada(fotoOcr, onProgresoOcr, cfgOcr)
    : await pasos.reconocerRapidOcrEscalonado(fotoOcr, onProgresoOcr, cfgOcr);
  let texto = ocrEsc.texto;
  ms.ocr = performance.now() - tOcr;
  // PROD-2 (§4.2): conf/det/rec de la pasada ELEGIDA (SPRINT-A A4: la
  // captura vive aquí — la dead store ultimoOcr* fue eliminada).
  const confOcr = ocrEsc.conf;
  const detOcr = ocrEsc.detMs;
  const recOcr = ocrEsc.recMs;
  emitir({ etapa: "OCR", progreso: 1 });
  // KIT consenso-frankfurt-v1 (FASE 4, §5): banda dirigida — si el OCR
  // completo no leyó la banda (sello blanco-sobre-negro, §0-F4), SEGUNDA
  // pasada OCR del crop invertido ×2. UNA sola vez, ANTES de
  // clasificarCabecera; el tiempo se suma a ms.ocr (es OCR). SIM: OMITIDO
  // (AC6 — cero llamadas a ocrBanda en SIM; guard opciones.simular).
  if (!opciones.simular && tipoDeBanda(texto) === null) {
    const tBanda = performance.now();
    texto += "\n" + (await pasos.ocrBanda(fotoProcesada));
    ms.ocr += performance.now() - tBanda;
  }
  ms.total = performance.now() - inicio;

  // (motor/filtroActa calculados en el paso 3 — §D8.3: as-is → "canvas"/"original")

  // 6) Mapeo §4 → status/score/rechazo + clasificación de cabecera
  //    (SPEC-cabecera-clasificacion §4: RECHAZADA solo por CALIDAD;
  //    cabecera sin clasificar → EN_REVISION_HUMANA con panel, NUNCA rechazo).
  //    §X (SPEC-score-legible): la clasificación se calcula PRIMERO (barata:
  //    regex + divipol cacheada) y alimenta el score — el OCR y la
  //    identificación manda sobre las métricas globales del crudo.
  const clasificacion = clasificarCabecera(texto, await cargarDivipol());
  // (KIT consenso-frankfurt-v1 FASE 2: las esquinas se miden ANTES del
  // guard — arriba; aquí solo consume ladoEsquina/trazaEsq.)
  // KIT actas-vivas-paginas-v1 (FASE C): RECORTADA por OCR de secciones —
  // P1 sin «SUMA TOTAL» / P≥2 sin «FIRMA» (faltaSeccionInferior);
  // página DESCONOCIDA nunca condena. Techo 7.9 = ADVERTENCIA (NO
  // rechazo — conservador en campo). FASE F: OR con la señal de esquinas.
  // KIT e14-lectura-perdona-lazo-v1 (§4-B): la LECTURA perdona al lazo — un
  // fiducial faltante cuyo lado está demostrado dentro por el OCR es falso
  // positivo (margen corto/sombra). La señal de secciones NUNCA se perdona.
  // En SIM esquinas=ESQUINAS_OK (L955) → helper false → recortada idéntica a
  // hoy (chips 8.2/7.0/4.3 intactos — §2 del kit).
  const faltaSeccion = faltaSeccionInferior(texto, clasificacion.pagina);
  const lazoPerdonado = lazoPerdonadoPorLectura(esquinas, texto, faltaSeccion);
  const recortada = faltaSeccion || (ladoEsquina !== null && !lazoPerdonado);
  const ocrLegible = ocrTextIsValid(texto);
  // §D1 (SPEC-e14-score-ocr): señal de CONTENIDO del acta — alimenta el
  // score (techo 4.9 sin señal) y el desenlace §D3 (rechazo BAJO).
  const senalActa = pasos.senalDeContenido(texto, clasificacion);
  // KIT e14-luz-sim-puntos-v1 (T-D): `senal` se sube aquí (antes vivía
  // tras scoreDeCalidad) — es PURA (misma entrada → misma salida) y el
  // piso-10 necesita las anclas dentro del scoreDeCalidad. El bloque C3
  // de abajo queda idéntico leyendo esta misma const.
  const senal = senalDeLectura(texto, clasificacion.parciales);
  // KIT e14-luz-sim-puntos-v1 (T-D): LAS 4 condiciones de §4.1. Todas o
  // ninguna (conservador — G3).
  const pisoPerfecto =
    senal.nivel === "FUERTE" &&
    senal.anclas >= 8 &&
    calidad.sharpnessHi >= 90 &&
    calidad.contrastPapel >= 75;
  let score = pasos.scoreDeCalidad(calidad, {
    ocrLegible,
    identificada: clasificacion.nivel === "AUTO",
    conSenal: senalActa,
    pisoPerfecto,
  });
  // KIT e14-diagnostico-autoenvio-v1 (§3-A): score visual = bruto de
  // scoreDeCalidad ANTES de los caps del sitio (escudo-fondo/recortada/
  // incompleta/sin-votos) — el `final` es el que imprime el log.
  // ORDEN del merge (kit e14-diag-campos-aditivos-v1 §4-A.3):
  // scoreDeCalidad → scoreVisual → bloque C3 → inyección SIM → caps.
  const scoreVisual = score;
  // KIT e14-score-lectura-v1 (C3): ajuste por LECTURA — el OCR manda (§3):
  // FUERTE (mesa+4 anclas o 6) sube el score a ≥8.5 (el piso vence al techo
  // fair pero NUNCA al poor — level del core "poor" es evidencia física
  // dura); DEBIL techo 5.9; MEDIA no toca. El texto es el POST-banda
  // (ocrBanda ya sumó — pitfall §9.8; SIN llamada OCR nueva — costo 0).
  // Va EXACTAMENTE aquí (§4-B3): tras scoreDeCalidad y ANTES de la
  // inyección SIM (pitfall §9.5 — los chips 8.2/7.0/4.3 mandan) y de los
  // caps posteriores (escudo fondo/recortada/gate siguen MANDANDO —
  // pitfall §9.4). Mismo criterio en el pipelineRecorte (pitfall §9.9).
  // KIT e14-luz-sim-puntos-v1 (T-D): la declaración de `senal` se SUBIÓ
  // (ahora vive antes de scoreDeCalidad — el piso-10 necesita las anclas
  // dentro del score). Este bloque C3 queda byte a byte leyendo esa const.
  if (senal.nivel === "FUERTE" && calidad.level !== "poor") {
    score = Math.max(score, PISO_LECTURA_FUERTE);
  } else if (senal.nivel === "DEBIL") {
    score = Math.min(score, TECHO_LECTURA_DEBIL);
  }
  // §D3 (SPEC-e14-simulacion-scores): inyección determinista del chip —
  // reemplaza el calculado DESPUÉS de scoreDeCalidad y ANTES del gate.
  // §G3 (KIT e14-gate-v2): SIN re-aplicación del piso de identificada
  // (la constante ya no existe) — el chip manda: 8.2 → OPTIMA por
  // statusDeScore (auto-envío normal) · 7.0 → ADVERTENCIA · 4.3 →
  // RECHAZADA (§D4). Nada se fuerza a mano: `evaluarGate` decide.
  if (opciones.simular && opciones.scoreSimulado != null) {
    score = opciones.scoreSimulado;
  }
  // §F-2 (SPEC-camara-funcional) + GUARD-BORDE Rev. 2: acta INCOMPLETA →
  // resolución por la vía de rechazo SIN tocar evaluarGate (el veto sigue
  // VIVIENDO FUERA del gate — §7 score-ocr intocado, D6/AC10). La decisión
  // del guard llega aquí: la sospecha geométrica SOLO condena con tinta
  // cortada al filo del recorte (D1 — el falso positivo del quad al filo
  // con imagen perfecta queda curado). El resto del pipeline corrió igual
  // (recorte/calidad/OCR) para que REVISIÓN muestre la imagen y el operador
  // entienda el problema — con una excepción (KIT e14-velocidad-5s-v1): el
  // OCR, que con `rechazoTemprano` cobró UNA pasada y paró, porque el
  // desenlace ya estaba bloqueado antes de leer la primera letra.
  // (La `verificacionResuelta` se cosecha arriba, antes del OCR — la MISMA
  //  promesa y el MISMO objeto, solo más temprano.)
  // NOTA (eliminación del módulo masiva): el gate de ESCANEOS por MARCO
  // IMPRESO (D63-C T2) y el perdón de marco (e63d F0.2) corrían SOLO para
  // entradas del runner MASIVA (`origenActa === "escaneo"`) — retirados
  // con la cola. El guard de fotos (verificarCompletitud) manda igual.
  let completa = opciones.simular ? true : (verificacionResuelta?.completa ?? true);
  // e71 (P10) — VETO 4/4 FIDUCIALES (kit e71-consolidación): la medición
  // de integridad encontró LAS 4 esquinas ausentes (traza
  // `esquinas=FALTA_tl+tr+bl+br`) → el papel NO está demostrado entero y
  // el gate NO puede ser completa. Va DESPUÉS del perdón del marco (la
  // lectura perdona al marco impreso, pero NUNCA a la ausencia total de
  // fiduciales — evidencia física manda). En SIM esquinas=ESQUINAS_OK →
  // el veto es inalcanzable (guard explícito, chips 8.2/7.0/4.3 intactos).
  // KIT e14-velocidad-5s-v1 — el perdón por evidencia física fuerte
  // (`perdonFaltaFiduciales`, helper ÚNICO y MISMO criterio en el recorte,
  // §9.9): «0 de 4 marcas» ALSO significa «las marcas no se ven» cuando el
  // resto del pipeline demuestra el papel entero con las varas duras —
  // lectura FUERTE ≥8 anclas, nitidez ≥90, contraste de papel ≥75 y ningún
  // guard (geométrico ni de secciones) dice recortada. Evidencia:
  // 20261028_084854 — visual 10, sharpness 100, 9 anclas, 617 caracteres,
  // votos 9,7 %, recortada:false → RECHAZADA 6.4 con «EL ACTA ESTÁ CORTADA
  // EN EL ENCUADRE» en una corrida y 10 ÓPTIMA en las tres siguientes.
  if (
    !opciones.simular &&
    cuatroEsquinasFaltan(esquinas) &&
    !perdonFaltaFiduciales(pisoPerfecto, recortada)
  ) {
    completa = false;
  }
  // GATE-MARCADORES (KIT e14-gate-v2, FASE G2) — marcador OBLIGATORIO de
  // votos, FUERA de evaluarGate (MISMO patrón del veto INCOMPLETA: D6/
  // AC10). Fallo del 2026-10-16: acta sin votos llegó OPTIMA y se
  // auto-envió sin que nadie mirara la zona de votos. Medición sobre
  // fotoProcesada (<30 ms p95, motor compartido motorTinta —
  // marcadores.ts). Corre TAMBIÉN en `simular` (default del dueño —
  // calibración: los 3 assets SIM pasan la zona 8.83-57.5% ≫ 0.8%, la
  // demo no se rompe · decisión D41 del catálogo). INCOMPLETA
  // manda primero: el veto de votos SOLO condena actas completas sin
  // tinta en la zona de votos.
  const marcadores = await medirZonaVotos(fotoProcesada, undefined);
  // KIT actas-vivas-paginas-v1 (FASE C): gate de votos SOLO P1 — la pág 2
  // (constancias) NO tiene zona de votos (hoy pasaba por la tinta de las
  // líneas impresas: de la suerte). Página desconocida → se mide
  // (conservador). Log: votos=skip-pag2 cuando aplique.
  const votosSkipPag2 = clasificacion.pagina?.index === 2;
  const marcadoresOk = completa ? (votosSkipPag2 ? true : marcadores.hayVotos) : true;
  // D10 — escudo anti-fondo: franja(s) ≥85% oscura(s) al filo = fondo/sombra
  // incluida por el warp (NO tinta cortada) → el acta pasa al gate con
  // TECHO 7.9 (nunca ÓPTIMA — statusDeScore: ≥8; el recorte trae fondo y el
  // operador puede preferir repetir) sin copy nuevo. SOLO actas completas
  // (la condenada por tinta no llega al gate).
  if (completa && verificacionResuelta?.fondo) {
    score = Math.min(score, pasos.TECHO_ESCUDO_FONDO);
  }
  // KIT actas-vivas-paginas-v1 (FASE C): acta RECORTADA (OCR de secciones)
  // → techo 7.9 — ADVERTENCIA, NO rechazo (conservador en campo). Cap
  // DESPUÉS de la inyección SIM (mismo sitio que el escudo de fondo — el
  // recorte físico manda sobre cualquier score).
  if (recortada) {
    score = Math.min(score, pasos.TECHO_ESCUDO_FONDO);
  }
  const gate: ResultadoGate = !completa
    ? {
        // intento < maxIntentos → RECHAZADA · al AGOTAR → contingencia
        // automática C4 (EN_REVISION_HUMANA con el MISMO rechazo).
        status:
          opciones.intento >= opciones.maxIntentos
            ? ("EN_REVISION_HUMANA" as ActaStatus)
            : ("RECHAZADA" as ActaStatus),
        rechazo: {
          tipo: "INCOMPLETA",
          detalle: pasos.DETALLE_INCOMPLETA,
        },
        clasificacion: null,
      }
    : !marcadoresOk
      ? {
          // KIT e14-gate-v2 (G2): rechazo DIRECTO por marcador
          // obligatorio fallido — mismo desenlace por intentos que
          // INCOMPLETA (repetir; al AGOTAR, contingencia C4 con el
          // MISMO rechazo SIN_VOTOS — un impreso sin votos no puede
          // quedarse en bucle infinito). Copy CORTO, sin guía.
          status:
            opciones.intento >= opciones.maxIntentos
              ? ("EN_REVISION_HUMANA" as ActaStatus)
              : ("RECHAZADA" as ActaStatus),
          rechazo: { tipo: "SIN_VOTOS", detalle: pasos.DETALLE_SIN_VOTOS },
          clasificacion: null,
        }
      : pasos.evaluarGate(score, texto, clasificacion, opciones.intento, opciones.maxIntentos);
  if (!completa) score = Math.min(score, 6.4);
  // Cap del veto de votos (mismo patrón del INCOMPLETA): RECHAZADA
  // implica <6.5 (statusDeScore) — el score queda coherente con el status.
  if (completa && !marcadoresOk) score = Math.min(score, 6.4);

  // §D3 (SPEC-e14-score-ocr): desenlace «SCORE BAJO» determinista — sin
  // señal de contenido, el rechazo se sustituye por BAJO SEA CUAL SEA el
  // status (el status lo sigue decidiendo el gate/los intentos: al agotar,
  // contingencia C4 con su rechazo BAJO real). Con señal, nada cambia
  // (INCOMPLETA/ILEGIBLE/GENERICO como hoy). Mismo patrón que INCOMPLETA:
  // FUERA de evaluarGate (§7 prohibido tocarlo).
  const rechazoFinal: Acta["rechazo"] = senalActa
    ? gate.rechazo
    : { tipo: "BAJO", detalle: pasos.DETALLE_BAJO };

  const evidenciaSim =
    opciones.simular && opciones.scoreSimulado != null ? ` sim=${opciones.scoreSimulado}` : "";
  // §D8.3: traza de auditoría del as-is (solo cuando sinRecorte).
  const evidenciaAsis = sinRecorte ? " recorte=as-is" : "";
  // §3c (GUARD-BORDE) — log de auditoría del guard: SOLO cuando hubo
  // sospecha geométrica se añaden los campos nuevos (AC8: sin sospecha el
  // log queda como hoy). `borde=` lados sospechosos ("S|E"), `tintaFilo=`
  // condena, `franja=` densidades de tinta en % por lado sospechoso (mismo
  // orden que borde) y `fondo=` escudo D10.
  // KIT e14-esquinas-suaves-v1 (Q1): token `perdon=` añadido AL FINAL del
  // segmento (tokens NUEVOS solo al final — la línea `senal=` queda byte a
  // byte; perdón por PAR fiducial del lado — Q1).
  const evidenciaBorde =
    verificacionResuelta && verificacionResuelta.sospecha
      ? ` borde=${verificacionResuelta.sospecha}` +
        ` tintaFilo=${verificacionResuelta.tintaFilo}` +
        ` franja=[${verificacionResuelta.densidades.map((d) => d.toFixed(1)).join(",")}]` +
        ` fondo=${verificacionResuelta.fondo}` +
        (verificacionResuelta.perdonLado ? ` perdon=${verificacionResuelta.perdonLado}` : "")
      : "";
  // FASE S (§S.1.5): crop= bbox real usado por calidadDeActa (px) — WxH;
  // `full` si el fallback al frame completo se activó (diagnóstico en campo).
  const cropLog = infoCrop.fallback ? "full" : `${infoCrop.w}x${infoCrop.h}`;
  // KIT e14-diagnostico-autoenvio-v1 (C1/§6-B): techos capturados con las
  // MISMAS condiciones que ya aplicaron los caps — orden real de aplicación
  // (techo-fair/poor/sin-senal de scoreDeCalidad → escudo-fondo → recortada
  // → incompleta → sin-votos). Los de lectura-DEBIL/piso-FUERTE llegan con
  // score-lectura (PR #13, §8 — campos aditivos).
  const techosDiag: string[] = [];
  if (calidad.level === "fair") techosDiag.push("techo-fair:7.9");
  if (calidad.level === "poor") techosDiag.push("techo-poor:6.4");
  if (!senalActa) techosDiag.push(`sin-senal:${pasos.TECHO_SIN_SENAL}`);
  // KIT e14-diag-campos-aditivos-v1 (§8 score-lectura): ajustes de LECTURA
  // del score v2 — NO son caps: observabilidad del ajuste (piso sube,
  // techo baja). Condición espejo exacta del C3 (L1050-1055) — el C3
  // aplica DESPUÉS de scoreDeCalidad y ANTES de los caps del sitio.
  if (senal.nivel === "FUERTE" && calidad.level !== "poor")
    techosDiag.push("piso-lectura-FUERTE:8.5");
  if (senal.nivel === "DEBIL") techosDiag.push("lectura-DEBIL:5.9");
  if (completa && verificacionResuelta?.fondo)
    techosDiag.push(`escudo-fondo:${pasos.TECHO_ESCUDO_FONDO}`);
  if (recortada) techosDiag.push(`recortada:${pasos.TECHO_ESCUDO_FONDO}`);
  if (!completa) techosDiag.push("incompleta:6.4");
  if (completa && !marcadoresOk) techosDiag.push("sin-votos:6.4");
  // C1: el registro nace junto al log (todo en scope — §9.6). SIM nunca
  // (§9.2). Observación PASIVA: si falla, el desenlace NO se toca (§9.7).
  let diag: DiagnosticoActa | null = null;
  if (!opciones.simular) {
    try {
      diag = construirDiagnostico({
        actaId: "", // se parcha con el id REAL tras construirActa
        intento: opciones.intento,
        maxIntentos: opciones.maxIntentos,
        status: gate.status,
        rechazo: rechazoFinal,
        scoreVisual,
        scoreFinal: score,
        techos: techosDiag,
        metricas: {
          sharpness: calidad.sharpness,
          // KIT e14-diag-campos-aditivos-v1: métricas v2 REALES (§3).
          sharpnessHi: calidad.sharpnessHi,
          brightness: calidad.brightness,
          contrast: calidad.contrast,
          contrastPapel: calidad.contrastPapel,
          contrasteEfectivo: pasos.contrasteEfectivoDe(calidad, ocrLegible),
        },
        level: calidad.level,
        lecturaChars: texto.length,
        // KIT e14-diag-campos-aditivos-v1: la señal del C3 — MISMA
        // instancia, sin recálculo (pitfall §9.10).
        senalLectura: { nivel: senal.nivel, anclas: senal.anclas },
        senalActa,
        ocrValido: ocrTextIsValid(texto),
        gate: {
          completa,
          fondo: verificacionResuelta?.fondo ?? false,
          recortada,
          ladoEsquina: ladoEsquina ?? null,
          votos: {
            densidadPct: marcadores.densidadVotosPct,
            skipPag2: votosSkipPag2,
            ok: marcadoresOk,
          },
          procesadaVacia,
          clasifNivel: gate.clasificacion?.nivel ?? "—",
        },
        captura: {
          motor,
          filtro: filtroActa,
          crop: { w: infoCrop.w, h: infoCrop.h, fallback: infoCrop.fallback },
          quad,
          quadOrigen,
        },
        tiempos: {
          procesoMs: ms.proceso,
          calidadMs: ms.calidad,
          ocrMs: ms.ocr,
          totalMs: ms.total,
          // D61 — KIT e14-tiempos-ocultos-v1 (T2): decode/detect YA se medían
          // (ms.decode/ms.detect de este pipeline, hoy en la traza de consola)
          // — ahora PERSISTEN. null honesto si la fase no corrió (video-grab
          // sin archivo → decode=0; sinRecorte → detect=0) — jamás inventar.
          decodeMs: ms.decode > 0 ? Math.round(ms.decode) : null,
          detectMs: ms.detect > 0 ? Math.round(ms.detect) : null,
          // KIT e14-velocidad-5s-v1 — los dos tramos que faltaban (ver
          // tipos.ts): el bloque de orientación/geometría pre-CALIDAD y el
          // cierre post-OCR.
          orientMs: Math.round(ms.orient),
          brujulaMs: Math.round(ms.brujula),
          esqMs: Math.round(ms.esq),
        },
      });
    } catch {
      diag = null;
    }
  }
  // D57 — KIT e14-instrumentos-espera-v1 (T2): orientacionProbeMs al
  // diagnóstico — asignación DEFENSIVA (jamás lanza; sin diagnóstico → se
  // omite — kit §4-T2). ADITIVO: no toca score/status/gate/tiempos.
  if (diag != null && ocrEsc.traza) {
    diag.trazaOcr = ocrEsc.traza;
  }
  if (diag != null && probeMsOrientacion != null) {
    diag.orientacionProbeMs = probeMsOrientacion;
  }
  // WAVE2 A1 — sub-decisión de la miniatura descartada por el fallo seguro
  // (asignación DEFENSIVA — jamás lanza; sin diagnóstico o sin mini → se
  // omite — jamás inventar). Datos de calibración wave 3.
  if (diag != null && probeMiniOrientacion != null) {
    diag.orientacionProbeMini = probeMiniOrientacion;
  }
  // KIT e14-velocidad-5s-v1 — la brújula QR decide y cobra (0.7-1.0 s en el
  // A56): el acta ahora dice QUÉ eslabón leyó y cuánto tardó (warp barato vs
  // rescate hi-res por cuadrantes). ADITIVO, defensivo, jamás inventa.
  if (diag != null && brujula != null) {
    diag.trazaQr = {
      via: brujula.via,
      rot: brujula.rot,
      cuadrante: brujula.cuadrante,
      ms: brujula.ms,
      intentos: brujula.intentos.length,
    };
  }
  logger.info(
    `[e14] pipeline ${opciones.fuente}/${"archivo" in entrada ? "file" : "video-grab"} ` +
      `total=${Math.round(ms.total)}ms ` +
      `(decode=${Math.round(ms.decode)} detect=${Math.round(ms.detect)} ` +
      `proceso=${Math.round(ms.proceso)} calidad=${Math.round(ms.calidad)} ` +
      `ocr=${Math.round(ms.ocr)} motor=${motor} ocrValido=${ocrTextIsValid(texto)} ` +
      `cabeceraE14=${PATRON_CABECERA.test(texto)} completa=${completa} ` +
      `senal=${senalActa} vacia=${procesadaVacia} votos=${votosSkipPag2 ? "skip-pag2" : `${marcadores.densidadVotosPct.toFixed(1)}%`}${marcadoresOk ? "" : " SIN_VOTOS"}${recortada ? " recortada=1" : ""}${ladoEsquina ? ` lado=${ladoEsquina}` : ""}${lazoPerdonado ? " lazo=perdonado" : ""} esquinas=${trazaEsq}${evidenciaAsis}${evidenciaBorde} ` +
      // KIT e14-luz-sim-puntos-v1 (T-D): piso-10 aplicado (grep-able).
      `quad=[${quad.map((p) => `${p.x.toFixed(3)},${p.y.toFixed(3)}`).join(" ")}] piso10=${pisoPerfecto ? 1 : 0}${quadOrigen ? ` origen=${quadOrigen}` : ""} ` +
      `score=${score} filtro=${filtroActa} ocrIn=${ocrIn} ` +
      // KIT e14-motor-rapidocr-v1 (PROD-2 §4.2): token grep-able del motor
      // de producción, junto al ocrIn= del PROD-1 (conf/det/rec del OCR
      // principal — capturados antes de la banda).
      `ocr=rapidocr conf=${confOcr != null ? confOcr.toFixed(2) : "?"} det=${Math.round(detOcr)}ms rec=${Math.round(recOcr)}ms ` +
      // KIT e14-score-lectura-v1 (REBASE): señal de lectura v2 en la traza.
      `lectura=${senal.nivel} anclas=${senal.anclas} piso=${score >= 8.5 && senal.nivel === "FUERTE"} ` +
      `clasif={${pasos.fmtClasif(gate.clasificacion)}} ` +
      `crop=${cropLog} ` +
      `metricas={sharpness:${calidad.sharpness} brightness:${calidad.brightness} ` +
      `contrast:${calidad.contrast} contEff:${pasos.contrasteEfectivoDe(calidad, ocrLegible)} ` +
      `level:${calidad.level}})${evidenciaSim}${diag ? " diag=1" : ""}` +
      // KIT e14-masiva-ux-v1 (T1.3): quién fabricó el quad EN la detección
      // del pipeline + si corrió el reintento post-Sobel (campos AÑADIDOS
      // al final — formato previo intacto).
      `${quadOrigen ? ` detectOrigen=${quadOrigen}` : ""}${detectReintento ? " detectReintento=1" : ""}` +
      // KIT e63f-autoenvio-v1 (F0): balde fino del no-AUTO — token ADITIVO
      // AL FINAL (contrato D51). Ausente si AUTO o sin motivo de los
      // listados (puesto-lugar/tipo/mesa-registro/ruta).
      `${gate.clasificacion?.clasifDebil ? ` ClasifDebil=${gate.clasificacion.clasifDebil}` : ""}`,
  );

  // KIT e14-diagnostico-autoenvio-v1 (C1): adjuntar el registro con el id
  // REAL del acta (el id nace en construirActa — parche post-hoc).
  await aterrizarQrCam(); // e64-qr T-2.1: la señal QR ya aterrizó (corrió en paralelo al OCR)
  const acta = pasos.construirActa(opciones, parcial, {
    fotoProcesada,
    procesadaVacia,
    // KIT actas-vivas-paginas-v1 (FASE C): el acta lleva la bandera del
    // OCR de secciones para la píldora de REVISIÓN.
    recortada,
    // KIT identificacion-codigo-v1 (FASE F): LADO de la esquina faltante
    // (píldora «ACTA RECORTADA · SUP-IZQ») — null si vino SOLO del OCR
    // de secciones o 4/4 presentes.
    recorteLado: ladoEsquina,
    quadDetectado: quad,
    calidad,
    ocrTexto: texto,
    motor,
    // §D8.3 (SPEC-e14-score-ocr Rev. 3): as-is nace "original" (veracidad
    // en el editor — el acta NO pasó por filtro); pipeline normal "bw".
    filtro: filtroActa,
    score,
    scoreVisual,
    status: gate.status,
    rechazo: rechazoFinal,
    clasificacion: gate.clasificacion,
  });
  if (diag) {
    diag.actaId = acta.id;
    acta.diagnostico = diag;
    // KIT e14-observabilidad-v1 (A1-C7, cambio QUIRÚRGICO): emisión perf
    // del desenlace — lazy import + catch total (el rastreo jamás rompe
    // el pipeline, §2.4), mapea SOLO campos ya en scope (§9.10: tiempos/
    // gate/ocrValido leídos de diag — nada re-evaluado). El actaId sale
    // SIEMPRE hasheado (FNV-1a dentro de emitirPerfDeActa, §2.5).
    void import("./obs/captura")
      .then((m) =>
        m.emitirPerfDeActa({
          actaId: acta.id,
          status: acta.status,
          intento: acta.intento,
          tiempos: {
            procesoMs: diag.tiempos.procesoMs,
            calidadMs: diag.tiempos.calidadMs,
            ocrMs: diag.tiempos.ocrMs,
            totalMs: diag.tiempos.totalMs,
          },
          scoreVisual,
          scoreFinal: score,
          gate: gate.status,
          ocrValido: diag.ocrValido,
          lectura: ocrEsc.lectura,
        }),
      )
      .catch(() => {});
  }
  // KIT e14-velocidad-5s-v1 — el cierre REAL (totalMs se corta tras el OCR;
  // clasificación + gate + votos + construirActa iban en el hueco).
  if (diag) diag.tiempos.cierreMs = Math.round(performance.now() - inicio - ms.total);
  return acta;
}
