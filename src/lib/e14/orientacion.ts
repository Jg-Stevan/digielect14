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
 * KIT e70-orientacion-condicional-v1 (P4.1 del dueño): el EXIF de cámara YA
 * NO omite el sondeo por sí solo — dice cómo estaba el TELÉFONO, no cómo
 * quedó el acta (evidencia: 3 fotos landscape con EXIF rechazadas score 4.9,
 * anclas 0, cabeceraE14 false). El bridge entra en MODO CONFIRMACIÓN
 * (opciones.confirmar): la pasada 0° de este probe (det cap rápido + rec
 * sobre los crops) ES la «primera pasada de OCR rápido» del criterio — quad
 * del WORKER (no del fallback sobel) + anclas >= 3 Y conf >= 0.7 a 0° ⇒
 * orientación CONFIRMADA ⇒ cortes=confirmada (sin challengers). Cualquier
 * condición fallida (anclas 0, conf 0.3, quad de fallback) ⇒ sondeo completo
 * 0/90/180/270 y el MARGEN decide. En este modo el atajo T1 sana NO aplica
 * (su MEDIA por chars>=150 perdonaba lecturas basura de actas de lado — el
 * criterio del dueño es EL gate). Sin opciones → comportamiento de hoy byte
 * a byte (recorte manual y flujos sin EXIF). Traza: exif=0|1 ADITIVO AL
 * FINAL (1 = el caller pidió modo confirmación).
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

type Rotacion = 0 | 90 | 180 | 270;

interface ProbeOrientacion {
  rot: Rotacion; // ganadora (aplicada o 0 si no rota)
  aplicado: boolean;
  scores: Partial<Record<Rotacion, number>>;
  anclas: Partial<Record<Rotacion, number>>;
  conf: Partial<Record<Rotacion, number>>;
  ms: number;
}

/** e70 (P4.1) — opciones del probe. Su PRESENCIA activa el MODO
 *  CONFIRMACIÓN (solo el branch exif-camara del bridge): el criterio del
 *  dueño reemplaza al atajo T1 sana como ÚNICO gate a 0°. quadWorker=false
 *  → sin atajo («el quad se detectó mal» — fallback sobel fabricó la
 *  geometría → sondeo completo). Ausente → comportamiento de hoy byte a
 *  byte (recorte manual, flujos sin EXIF). */
export interface OpcionesProbeOrientacion {
  confirmar?: { quadWorker: boolean };
}

/** §2.2 — tope duro del probe: a mitad, abortar y seguir con 0° (hoy).
 *  D56 §3 T3: 4000 → 12000 — presupuesto HONESTO. El caso roto del dueño
 *  (HP 4 cores: det a 1920 = 3037 ms) ya agotaba 4000 con el baseline a 0°.
 *  Con det del probe a DET_CAP_RAPIDO (T2) el caso roto cabe: det ~1.2 s +
 *  rec0 ~3 s + rec90 ~3 s + rec270 ~3 s ≈ 10.2 s < 12 s. Solo lo pagan actas
 *  con lectura DEBIL a 0° (las sanas salen por el atajo T1 en ~4 s). */
const PROBE_BUDGET_MS = 12000;
/** §2.1 paso 3 — margen mínimo sobre score(0) para aplicar la rotación. */
const MARGEN_ORIENTACION = 1.5;
/** §2.1 paso 1 — K crops repartidos por el acta. */
const PROBE_K_CROPS = 8;
/** Tope del score por rotación (§2.1 «con tope por rotación»: 5 anclas ya
 *  saturan la señal; el MARGEN compara igual en 0..10). */
const TOPE_SCORE = 10;

// ─── KIT e14-probe-adaptativo-v1 (D62 T1): ganador persistente del sondeo ───
// El patrón del escáner/fotógrafo del dueño es consistente (lote 15:04: CCW →
// ganador rot=270): con el ganador sondeado ANTES que el resto, cada acta
// rotada se ahorra una pasada completa (~2-4 s). Persistencia en localStorage
// (clave e14-probe-ganador-v1) con try/catch TOTAL — modo privado / cuota /
// SSR / ambiente sin storage ⇒ sin ganador ⇒ comportamiento de hoy byte a
// byte (el probe JAMÁS tumba el pipeline, §5).

const CLAVE_GANADOR = "e14-probe-ganador-v1";
const ANILLO_TOPE = 10;

/** [D62-anillo-inicio]
 * Anillo de los ÚLTIMOS 10 desenlaces del probe con aplicado=1 (solo rot 90/
 * 180/270 — 0 nunca se aplica). El ganador se DERIVA del anillo: la rot más
 * frecuente; empate ⇒ la de desenlace más reciente. Formato compacto
 * [{"rot":270,"ts":<epoch>}…] — el kit pedía ~100 bytes con {rot,ts,n}
 * agregado; el anillo es lo mínimo que respeta la ventana de 10 + empate
 * (un agregado solo no puede expulsar al 11.º más viejo) — ver REPORTE §4. */
interface DesenlaceRot {
  rot: Rotacion;
  ts: number;
}

function anilloGanadorLeer(): DesenlaceRot[] {
  try {
    const raw = localStorage.getItem(CLAVE_GANADOR);
    if (raw == null) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const anillo: DesenlaceRot[] = [];
    for (const e of parsed) {
      if (e && typeof e === "object") {
        const r = (e as { rot?: unknown }).rot;
        const t = (e as { ts?: unknown }).ts;
        if ((r === 90 || r === 180 || r === 270) && typeof t === "number") {
          anillo.push({ rot: r, ts: t });
        }
      }
    }
    return anillo.slice(-ANILLO_TOPE); // anillo: solo los últimos 10
  } catch {
    return [];
  }
}

/** Ganador actual del anillo (más frecuente; empate ⇒ más reciente) o null.
 *  La recencia se deriva de la POSICIÓN en el anillo (el último índice es el
 *  desenlace más nuevo) — robusta aunque dos desenlaces caigan en el mismo
 *  ms (Date.now()). */
function ganadorPersistente(): Rotacion | null {
  try {
    const anillo = anilloGanadorLeer();
    if (anillo.length === 0) return null;
    const freq = new Map<Rotacion, { n: number; ultimaPos: number }>();
    anillo.forEach((d, i) => {
      const f = freq.get(d.rot);
      if (f) {
        f.n += 1;
        f.ultimaPos = i;
      } else {
        freq.set(d.rot, { n: 1, ultimaPos: i });
      }
    });
    let ganador: Rotacion | null = null;
    for (const [rot, f] of freq) {
      if (ganador === null) {
        ganador = rot;
        continue;
      }
      const g = freq.get(ganador)!;
      if (f.n > g.n || (f.n === g.n && f.ultimaPos > g.ultimaPos)) ganador = rot;
    }
    return ganador;
  } catch {
    return null;
  }
}

/** Registrar UN desenlace aplicado (aplicado=1). Un fallo del probe (catch →
 * null), el caso vacío o aplicado=0 NUNCA escriben (kit T1.4). */
function anilloGanadorRegistrar(rot: Rotacion): void {
  try {
    const anillo = anilloGanadorLeer();
    anillo.push({ rot, ts: Date.now() });
    while (anillo.length > ANILLO_TOPE) anillo.shift(); // expulsa el más viejo
    localStorage.setItem(CLAVE_GANADOR, JSON.stringify(anillo));
  } catch {
    // sin storage (modo privado/cuota): el sondeo sigue con el orden de hoy
  }
}
/** [D62-anillo-fin] */

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
  opciones?: OpcionesProbeOrientacion,
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
    // Orden de sondeo (§2.1 paso 3): 0° SIEMPRE primero (baseline del MARGEN;
    // el atajo T1 de lectura-sana depende de él — INTACTO) y luego el
    // desafiante probable según la forma de la tira.
    // D62 T1 — orden ADAPTATIVO: con ganador persistente (aplicado=1 reciente)
    // se sondea [0, ganador, resto…] (el resto conserva el orden actual minus
    // ganador); sin ganador ⇒ el orden de HOY sin cambio (rama h > w respetada).
    const gan = ganadorPersistente();
    const base: Rotacion[] = h > w ? [0, 180, 90, 270] : [0, 90, 270, 180];
    const orden: Rotacion[] =
      gan === null || gan === 0
        ? base
        : [0, gan, ...base.filter((r) => r !== 0 && r !== gan)];
    let mejor: Rotacion | null = null;
    // D56 §3 T4 — por qué terminó el sondeo (solo para la traza, aditivo).
    // e70: + "confirmada" (criterio del dueño — valor ADITIVO, los previos
    // no cambian de forma; D51).
    let corte: "sana" | "presupuesto" | "completo" | "confirmada" = "completo";
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
        // e70 — MODO CONFIRMACIÓN (P4.1): el criterio del dueño es EL gate —
        // quad del WORKER + anclas >= 3 Y conf >= 0.7 a 0° ⇒ la primera
        // pasada rápida CONFIRMÓ la orientación ⇒ sin challengers. En este
        // modo T1 sana NO aplica (su MEDIA por chars>=150 perdonaba lecturas
        // basura de actas fotografiadas de lado — el falso positivo exacto
        // del skip por EXIF).
        if (opciones?.confirmar) {
          if (
            opciones.confirmar.quadWorker &&
            nAnclas >= 3 &&
            confMedia >= 0.7
          ) {
            corte = "confirmada";
            break;
          }
          continue;
        }
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
    // D62 T1.4 — el anillo SOLO registra desenlaces APLICADOS (aplicado=1);
    // fallo del probe (catch), vacío y aplicado=0 NUNCA escriben.
    if (aplicado) anilloGanadorRegistrar(rot);
    const ms = Math.round(performance.now() - t0);
    const probeTxt = (Object.keys(scores) as unknown as Rotacion[])
      .map((r) => `${r}:${(scores[r] ?? 0).toFixed(2)}`)
      .join(",");
    console.info(
      `[e14] orientacion crop=${w}x${h} rot=${rot} probe={${probeTxt}} anclas${rot}=${anclas[rot] ?? 0} conf${rot}=${(conf[rot] ?? 0).toFixed(2)} aplicado=${aplicado ? 1 : 0} ms=${ms} cortes=${corte} orden=${orden.join(",")} gan=${gan ?? "-"} exif=${opciones?.confirmar ? 1 : 0}`,
    );
    return { rot, aplicado, scores, anclas, conf, ms };
  } catch {
    return null; // §5: el probe jamás tumba el pipeline (comportamiento de hoy)
  }
}
