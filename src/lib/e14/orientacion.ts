/**
 * KIT e14-orientacion-auto-v1 (§2) — probe de orientación por confianza de
 * rec + anclas de lectura. Causa raíz del informe del dueño 19/10 (12
 * RECHAZADAS score 4.9, «BAJO — NO SE RECONOCE INFORMACIÓN», lectura DEBIL:
 * actas físicamente ROTADAS 90°/180° al fotografiarlas — tira Consulado de
 * Egipto, KIT 399). El EXIF ya lo aplica el core (F-IMPORT) — NO es bug de
 * decode: el acta está puesta de costado/cabeza-abajo al fotografiarla. El
 * cls PP-OCR solo corrige 180° DE LÍNEA con umbral conservador sobre crops
 * de baja calidad — nunca 90°/270° ni garantiza el 180° de página.
 *
 * Principio (§2.1): NO correr 4 OCR completos. El det ya encontró las cajas —
 * el texto de una acta rotada en bloque usa LAS MISMAS cajas, solo que los
 * crops salen girados (girar el crop == girar la página y recortar la caja
 * transformada). Basta sondear con rec sobre unos pocos crops girados:
 *
 *   score(r) = anclas(r)·2 + confMedia(r)·(charsLegibles(r)/40)  [tope 10]
 *
 * guard absoluto (§2.1 paso 2): score(r) < 1.0 Y confMedia(r) < 0.55 → NO
 * candidata (jamás inventar). Decisión (paso 3): r* = argmax de candidatas;
 * aplicar SOLO si score(r*) ≥ score(0) + MARGEN (1.5) y r* ≠ 0.
 *
 * Atajos (paso 3): acta VERTICAL (tira E-14, H>W) → caso probable 180°
 * (sondea 180 primero; si dispara contra 0°, ni sondea 90/270) · HORIZONTAL
 * (W>H) → sospecha 90/270 alta (sondea esas dos primero, 180 al final).
 * score(0) SIEMPRE se sondea (baseline del MARGEN — el ejemplo de traza del
 * kit trae las cuatro).
 *
 * Presupuesto (§2.2 / D56 §3 T3): PROBE_BUDGET_MS = 12000 — si a mitad de
 * probe se pasa, aborta y sigue con 0° (comportamiento de hoy; el 4000
 * original NUNCA alcanzó el primer desafiante en la HP 4 cores del dueño:
 * det1920 3037 ms + rec0 ~3000 ms = 6030 > 4000 → aplicado=0 garantizado).
 * SIM: el probe NO corre
 * (guard en el bridge — chips 8.2/7.0/4.3 intactos). Sin recorte: corre igual
 * (no hay quad, pero la rotación del contenido es independiente — §2.2; en
 * ESTA base sinRecorte solo existe en SIM → el guard del bridge lo cubre).
 *
 * Traza en línea PROPIA (§2.1 paso 5 — los instrumentos del dueño parsean por
 * prefijo; NO mezclar campos con pipeline/recorte; solo AÑADIR):
 *   [e14] orientacion crop=WxH rot=R probe={0:a,90:b,180:c,270:d} anclasR=n confR=0.xx aplicado=0|1 ms=NNN cortes=sana|presupuesto|vacio|completo
 * (en probe={} aparecen SOLO las rotaciones sondeadas — los atajos cortan;
 * rot=R es la ganadora, con anclasR/confR de ELLA; aplicado=0 cuando no rota.
 * D56 §3 T4: cortes= es ADITIVO AL FINAL — sana = salió por el atajo T1
 * (lectura a 0° no-DEBIL) · presupuesto = aborto por budget · vacio = det
 * sin cajas · completo = el probe terminó su decisión (incluye el atajo
 * MARGEN que ya decidió ganadora — contrato D51: solo AÑADIR; los campos
 * previos NO cambian de forma).
 * Sin línea si el probe ni siquiera corrió (SIM o error duro de det/init —
 * catch general: el probe JAMÁS tumba el pipeline, §5).
 *
 * PURO orquestación sobre rapidocr.ts (sin sesión nueva, sin descargas —
 * MISMO singleton ORT, §2.2). La rotación JAMÁS cambia el score por sí misma:
 * solo habilita que el OCR lea de verdad; los caps/gate existentes mandan
 * después (escudo-fondo, recortada, sin-votos — §2.2).
 */

import { ANCLAS_LECTURA, norm, senalDeLectura } from "./senal-lectura";
import {
  rapidOcrCropsOrientacion,
  rapidOcrInit,
  rapidOcrRecLote,
} from "./ocr/rapidocr";

export type Rotacion = 0 | 90 | 180 | 270;

export interface ProbeOrientacion {
  rot: Rotacion; // ganadora (aplicada o 0 si no rota)
  aplicado: boolean;
  scores: Partial<Record<Rotacion, number>>;
  anclas: Partial<Record<Rotacion, number>>;
  conf: Partial<Record<Rotacion, number>>;
  ms: number;
}

/** §2.2 — tope duro del probe: a mitad, abortar y seguir con 0° (hoy).
 *  D56 §3 T3: 4000 → 12000 — presupuesto HONESTO. El caso roto del dueño
 *  (HP 4 cores: det a 1920 = 3037 ms) ya agotaba 4000 con el baseline a 0°.
 *  Con det del probe a DET_CAP_RAPIDO (T2) el caso roto cabe: det ~1.2 s +
 *  rec0 ~3 s + rec90 ~3 s + rec270 ~3 s ≈ 10.2 s < 12 s. Solo lo pagan actas
 *  con lectura DEBIL a 0° (las sanas salen por el atajo T1 en ~4 s). */
export const PROBE_BUDGET_MS = 12000;
/** §2.1 paso 3 — margen mínimo sobre score(0) para aplicar la rotación. */
export const MARGEN_ORIENTACION = 1.5;
/** §2.1 paso 1 — K crops repartidos por el acta. */
export const PROBE_K_CROPS = 8;
/** Tope del score por rotación (§2.1 «con tope por rotación»: 5 anclas ya
 *  saturan la señal; el MARGEN compara igual en 0..10). */
const TOPE_SCORE = 10;

/** Dimensiones de canvas o imagen (para girar tanto crops como dataURLs). */
function dimsDe(s: HTMLCanvasElement | HTMLImageElement): { w: number; h: number } {
  return s instanceof HTMLCanvasElement
    ? { w: s.width, h: s.height }
    : { w: s.naturalWidth, h: s.naturalHeight };
}

/** Girar una fuente canvas/img por 90/180/270° (misma equivalencia §2.1:
 *  girar el crop == girar la página y recortar la caja transformada). */
function girarFuente(
  src: HTMLCanvasElement | HTMLImageElement,
  rot: Rotacion,
): HTMLCanvasElement {
  if (rot === 0) {
    // Normaliza a canvas (el caller trabaja SIEMPRE con canvases).
    const { w, h } = dimsDe(src);
    const mismo = document.createElement("canvas");
    mismo.width = w;
    mismo.height = h;
    mismo.getContext("2d")!.drawImage(src, 0, 0);
    return mismo;
  }
  const { w, h } = dimsDe(src);
  const tmp = document.createElement("canvas");
  const ctx = tmp.getContext("2d")!;
  if (rot === 180) {
    tmp.width = w;
    tmp.height = h;
    ctx.translate(w, h);
    ctx.rotate(Math.PI);
    ctx.drawImage(src, 0, 0);
    return tmp;
  }
  tmp.width = h; // 90/270 intercambian dimensiones
  tmp.height = w;
  if (rot === 90) {
    ctx.translate(tmp.width, 0);
    ctx.rotate(Math.PI / 2);
  } else {
    ctx.translate(0, tmp.height);
    ctx.rotate(-Math.PI / 2);
  }
  ctx.drawImage(src, 0, 0);
  return tmp;
}

/** Aplicar (§2.1 paso 4): girar UNA dataURL — canvas rotate + re-encode
 *  JPEG q0.92 (kit literal). JAMÁS lanza: si el re-encode falla devuelve la
 *  entrada sin tocar (el pipeline sigue con 0° — comportamiento de hoy, §5). */
export async function rotarDataUrl(
  dataUrl: string,
  rot: Rotacion,
): Promise<string> {
  if (rot === 0) return dataUrl;
  try {
    const img = new Image();
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error("ORIENTACION_NO_DECODE"));
      img.src = dataUrl;
    });
    return girarFuente(img, rot).toDataURL("image/jpeg", 0.92);
  } catch {
    return dataUrl;
  }
}

/** Probe de orientación (§2.1). Devuelve null SOLO si no pudo correr
 *  (fallo de init/det — el pipeline sigue con 0°; sin traza, «el probe ni
 *  siquiera corrió»). Con det sin cajas: traza con 0:0.00 y aplicado=0
 *  (AC-4 — la traza está en el 100% de las no-SIM donde el probe corrió;
 *  NUNCA se alimenta a rec un lote vacío). */
export async function probeOrientacion(
  fotoOcr: string,
): Promise<ProbeOrientacion | null> {
  const t0 = performance.now();
  try {
    const rt = await rapidOcrInit(); // MISMO singleton (§2.2 — sin sesiones nuevas)
    const { crops, w, h } = await rapidOcrCropsOrientacion(rt, fotoOcr, PROBE_K_CROPS);
    if (crops.length === 0) {
      const msVacio = Math.round(performance.now() - t0);
      console.info(
        `[e14] orientacion crop=${w}x${h} rot=0 probe={0:0.00} anclas0=0 conf0=0.00 aplicado=0 ms=${msVacio} cortes=vacio`,
      );
      return { rot: 0, aplicado: false, scores: { 0: 0 }, anclas: { 0: 0 }, conf: { 0: 0 }, ms: msVacio };
    }
    const scores: Partial<Record<Rotacion, number>> = {};
    const anclas: Partial<Record<Rotacion, number>> = {};
    const conf: Partial<Record<Rotacion, number>> = {};
    // Orden de sondeo (§2.1 paso 3): 0° SIEMPRE primero (baseline del MARGEN)
    // y luego el desafiante probable según la forma de la tira.
    const orden: Rotacion[] = h > w ? [0, 180, 90, 270] : [0, 90, 270, 180];
    let mejor: Rotacion | null = null;
    // D56 §3 T4 — por qué terminó el sondeo (solo para la traza, aditivo).
    let corte: "sana" | "presupuesto" | "completo" = "completo";
    for (const rot of orden) {
      // §2.2 presupuesto: a mitad de probe, abortar y seguir con 0° (hoy).
      if (rot !== 0 && performance.now() - t0 > PROBE_BUDGET_MS) {
        corte = "presupuesto";
        break;
      }
      // 0° usa los crops DIRECTOS (rec no muta canvases — no hace falta copia).
      const girados = rot === 0 ? crops : crops.map((c) => girarFuente(c, rot));
      const lineas = await rapidOcrRecLote(rt, girados);
      const texto = lineas.map((l) => l.texto).join("\n");
      const confMedia =
        lineas.length === 0
          ? 0
          : lineas.reduce((s, l) => s + l.conf, 0) / lineas.length;
      const nAnclas = ANCLAS_LECTURA.filter(([, re]) => re.test(texto)).length;
      const chars = norm(texto).replace(/ /g, "").length;
      scores[rot] = Math.min(TOPE_SCORE, nAnclas * 2 + confMedia * (chars / 40));
      anclas[rot] = nAnclas;
      conf[rot] = confMedia;
      if (rot === 0) {
        // D56 §3 T1 — atajo de lectura-sana: si el texto a 0° YA se lee,
        // ninguna rotación puede necesitar aplicarse y ninguna debe arriesgar
        // la lectura (rotar es riesgo puro). El acta sana sale en ~4 s sin
        // sondear 90/270/180; la rotada del dueño leyó anclas0=0 chars=9 →
        // DEBIL → sigue a los challengers ✓. Regresión nula esperada: el
        // MARGEN ya protegía parcialmente; esto lo hace explícito y barato.
        if (senalDeLectura(texto).nivel !== "DEBIL") {
          corte = "sana";
          break;
        }
        continue;
      }
      // Guard absoluto (§2.1 paso 2): score<1.0 Y conf<0.55 → NO candidata.
      const candidata = (scores[rot] ?? 0) >= 1.0 || (conf[rot] ?? 0) >= 0.55;
      if (!candidata) continue;
      if (mejor === null || (scores[rot] ?? 0) > (scores[mejor] ?? 0)) mejor = rot;
      // Atajo (§2.1 paso 3): el desafiante ya dispara contra 0° → dejar de
      // sondear (ahorra las rotaciones restantes).
      if ((scores[mejor] ?? 0) >= (scores[0] ?? 0) + MARGEN_ORIENTACION) break;
    }
    // Liberar los canvases transitorios (§2.1 paso 4 — sin retener memoria).
    crops.length = 0;
    const aplicado =
      mejor !== null && (scores[mejor] ?? 0) >= (scores[0] ?? 0) + MARGEN_ORIENTACION;
    const rot: Rotacion = aplicado ? mejor! : 0;
    const ms = Math.round(performance.now() - t0);
    const probeTxt = (Object.keys(scores) as unknown as Rotacion[])
      .map((r) => `${r}:${(scores[r] ?? 0).toFixed(2)}`)
      .join(",");
    console.info(
      `[e14] orientacion crop=${w}x${h} rot=${rot} probe={${probeTxt}} anclas${rot}=${anclas[rot] ?? 0} conf${rot}=${(conf[rot] ?? 0).toFixed(2)} aplicado=${aplicado ? 1 : 0} ms=${ms} cortes=${corte}`,
    );
    return { rot, aplicado, scores, anclas, conf, ms };
  } catch {
    return null; // §5: el probe jamás tumba el pipeline (comportamiento de hoy)
  }
}
