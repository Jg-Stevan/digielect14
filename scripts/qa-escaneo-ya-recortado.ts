/**
 * QA headless — kit e63e §4.2 (deuda 1 del kit e63d §6.3): perdón de marco
 * (F0.2) + origen «escaneo» (F1) sobre funciones PURAS, sin red, sin DOM,
 * determinista. Fixtures sintéticos: bitmaps RGBA construidos a mano (nada de
 * actas reales — RED LINE 4). Salida `N/N OK`; exit 1 si algo falla.
 *
 *   bun scripts/qa-escaneo-ya-recortado.ts
 *
 * Bloques:
 *   1. marcoPerdonadoPorLectura — tabla §3-A del kit e63d (8 casos canónicos).
 *   2. evaluarMarcoDeBitmap — 4 bitmaps sintéticos (completo/ceñido/cortado/
 *      no-encontrado).
 *   3. clasificarOrigen — borde-blanco+ratio-hoja · tinta-al-filo simétrica
 *      E-14 · sin simetría · WhatsApp 4:3 sin EXIF (invariancia Fase E) ·
 *      EXIF cámara (regla intacta).
 *   4. Control negativo del perdón (ancla del ANEXO A): escaneo mutilado →
 *      el perdón NO aplica → el cap INCOMPLETA del bridge queda vivo
 *      (bridge: completa=false → RECHAZADA INCOMPLETA + cap 6.4).
 */
import { evaluarMarcoDeBitmap, type MarcoImpreso } from "../src/lib/e14/marco-escaneo";
import {
  clasificarOrigen,
  senalExifCamara,
  tintaAlFiloSimetrica,
  type OrigenBitmap,
} from "../src/lib/e14/masiva/origen";
import { marcoPerdonadoPorLectura } from "../src/lib/e14/scanner-core-bridge";
import type { NivelLectura } from "../src/lib/e14/senal-lectura";

let pasadas = 0;
let fallos = 0;
function ok(cond: boolean, etiqueta: string): void {
  console.log(`${cond ? "OK" : "FAIL"} · ${etiqueta}`);
  pasadas++;
  if (!cond) fallos++;
}

// ---------- fixtures sintéticos (RGBA directo — funciones bajo test PURAS) ----------

const TINTA = 60; // luma oscuro (trazo impreso) — < UMBRAL_TINTA_* (150)
const BLANCO = 250; // margen blanco uniforme (media ≥235, desv baja)
const PAPEL = 235; // papel del formulario
const FOTO = 180; // borde tipo foto: no-blanco (<235), no-tinta (≥150), no-claro (<200)

/** Bitmap WxH pintado por píxel desde una función (RGBA, canal gris). */
function bitmap(w: number, h: number, pintar: (x: number, y: number) => number): OrigenBitmap {
  const rgba = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const L = pintar(x, y);
      const i = (y * w + x) * 4;
      rgba[i] = L;
      rgba[i + 1] = L;
      rgba[i + 2] = L;
      rgba[i + 3] = 255;
    }
  }
  return { ancho: w, alto: h, rgba };
}

/** Marco oscuro continuo: filas/columnas enteras a TINTA (pasan LINEA_MIN_PCT
 *  del detector de marco). Textura interior leve (nunca llega a línea). */
function conMarcoLados(
  w: number,
  h: number,
  filas: number[],
  cols: number[],
  fondo: number = PAPEL,
): OrigenBitmap {
  return bitmap(w, h, (x, y) => {
    if (filas.includes(y) || cols.includes(x)) return TINTA;
    if (x % 97 === 0 && y % 53 === 0) return 120; // textura (≈1% de la línea)
    return fondo;
  });
}

/** JPEG mínimo con APP1 EXIF que trae Make (0x010F, "Test") — suficiente para
 *  senalExifCamara (solo exige la etiqueta con conteo > 0). */
function jpegConExifMake(): Uint8Array {
  const b = new Uint8Array(40);
  b[0] = 0xff; b[1] = 0xd8; // SOI
  b[2] = 0xff; b[3] = 0xe1; // APP1
  b[4] = 0x00; b[5] = 36; // longitud APP1 (payload 34 tras el campo len)
  b[6] = 0x45; b[7] = 0x78; b[8] = 0x69; b[9] = 0x66; b[10] = 0x00; b[11] = 0x00; // "Exif\0\0"
  b[12] = 0x49; b[13] = 0x49; // TIFF "II" (little-endian)
  b[14] = 0x2a; b[15] = 0x00; // magic 42
  b[16] = 0x08; b[17] = 0x00; b[18] = 0x00; b[19] = 0x00; // IFD0 @ 8
  b[20] = 0x01; b[21] = 0x00; // IFD0: 1 entrada
  b[22] = 0x0f; b[23] = 0x01; // tag 0x010F (Make)
  b[24] = 0x02; b[25] = 0x00; // tipo 2 (ASCII)
  b[26] = 0x04; b[27] = 0x00; b[28] = 0x00; b[29] = 0x00; // conteo 4
  b[30] = 0x54; b[31] = 0x65; b[32] = 0x73; b[33] = 0x74; // "Test" (inline, ≤4 bytes)
  b[34] = 0x00; b[35] = 0x00; b[36] = 0x00; b[37] = 0x00; // next IFD = 0
  return b;
}

/** Prefijo ftyp HEIC (formato de cámara Apple — señal conservadora «heic»). */
function prefijoHeic(): Uint8Array {
  const b = new Uint8Array(16);
  b[4] = 0x66; b[5] = 0x74; b[6] = 0x79; b[7] = 0x70; // "ftyp"
  b[8] = 0x68; b[9] = 0x65; b[10] = 0x69; b[11] = 0x63; // "heic"
  return b;
}

// ───────── Bloque 1 · marcoPerdonadoPorLectura — tabla §3-A (8 casos) ─────────
console.log("— Bloque 1 · perdón de marco (tabla §3-A, kit e63d) —");
{
  // NivelLectura = "FUERTE"|"MEDIA"|"DEBIL" (senal-lectura.ts) — la fila «SIN»
  // del kit (sin señal de lectura) no existe como nivel del trío: se ejerce
  // como valor no-FUERTE arbitrario para probar la rama negativa (jamás
  // perdona lo que no es FUERTE).
  const SIN = "SIN" as unknown as NivelLectura;
  const tabla: Array<[MarcoImpreso, NivelLectura, boolean, boolean, string]> = [
    ["cortado", "FUERTE", false, true, "P2 · cortado+FUERTE+secciones → PERDONADO (el caso que e63d debía salvar)"],
    ["cortado", "MEDIA", false, false, "P1 · cortado+MEDIA → condena (el perdón exige FUERTE)"],
    ["cortado", "FUERTE", true, false, "mutilación real (falta sección) → JAMÁS se perdona"],
    ["cortado", "DEBIL", false, false, "cortado+DEBIL → condena"],
    ["cortado", SIN, false, false, "cortado+sin-lectura-FUERTE → condena (rama !FUERTE)"],
    ["completo", "FUERTE", false, false, "completo → no hay nada que perdonar"],
    ["ceñido", "FUERTE", false, false, "ceñido nunca bloquea — el perdón no aplica"],
    ["no-encontrado", "FUERTE", false, false, "no-encontrado → el gate no bloquea (fuera del perdón)"],
  ];
  for (const [veredicto, nivel, faltaSeccion, esperado, etiqueta] of tabla) {
    ok(marcoPerdonadoPorLectura(veredicto, nivel, faltaSeccion) === esperado, etiqueta);
  }
}

// ───────── Bloque 2 · evaluarMarcoDeBitmap — 4 bitmaps sintéticos ─────────
console.log("— Bloque 2 · detector de marco impreso (marco-escaneo.ts) —");
{
  // completo: marco insertado a 10 px (≥ INSET_MIN_PX=5) en los 4 lados.
  const completo = evaluarMarcoDeBitmap(...dimsDe(conMarcoLados(480, 320, [10, 309], [10, 469])));
  ok(completo.veredicto === "completo" && completo.rect != null, `marco inset 4 lados → completo [${completo.veredicto}]`);

  // ceñido: marco pegado al filo en los 4 lados (par vertical + horizontal).
  const cenido = evaluarMarcoDeBitmap(...dimsDe(conMarcoLados(480, 320, [0, 1, 318, 319], [0, 1, 478, 479])));
  ok(cenido.veredicto === "ceñido" && cenido.rect == null, `marco al filo 4 lados → ceñido [${cenido.veredicto}]`);

  // cortado: 3 lados insertados DENTRO del contenido (falta el derecho).
  const cortado = evaluarMarcoDeBitmap(...dimsDe(conMarcoLados(480, 320, [10, 309], [10])));
  ok(cortado.veredicto === "cortado" && cortado.rect == null, `3 lados inset → cortado [${cortado.veredicto}]`);

  // no-encontrado: blanco puro (0 líneas continuas).
  const vacio = evaluarMarcoDeBitmap(...dimsDe(bitmap(480, 320, () => PAPEL)));
  ok(vacio.veredicto === "no-encontrado", `blanco puro → no-encontrado [${vacio.veredicto}]`);
}

/** Desempaqueta un OrigenBitmap para evaluarMarcoDeBitmap(ancho, alto, rgba). */
function dimsDe(b: OrigenBitmap): [number, number, Uint8ClampedArray] {
  return [b.ancho, b.alto, b.rgba];
}

// ───────── Bloque 3 · clasificarOrigen — reglas T1 + e63d F1 ─────────
console.log("— Bloque 3 · origen escaneo/foto/null (masiva/origen.ts) —");
{
  // (a) clásico: borde blanco uniforme + forma de hoja (ratio 0.75) → escaneo.
  const clasico = clasificarOrigen(
    bitmap(300, 400, (x, y) => (x < 18 || x >= 282 || y < 18 || y >= 382 ? BLANCO : PAPEL)),
    null,
  );
  ok(
    clasico.origen === "escaneo" && clasico.senales === "sin-exif+borde-blanco+ratio-hoja",
    `borde-blanco + ratio-hoja → escaneo [${clasico.senales}]`,
  );

  // (b) firma e63d F1: E-14 ceñido (ratio 0.31, tinta al filo simétrica) → escaneo.
  const e14 = conMarcoLados(256, 828, [0, 1, 826, 827], []);
  const cenido = clasificarOrigen(e14, null);
  ok(
    cenido.origen === "escaneo" && cenido.senales === "sin-exif+tinta-al-filo+ratio-e14",
    `tinta-al-filo simétrica + ratio E-14 → escaneo [${cenido.senales}]`,
  );

  // (c) SIN simetría — la señal F1 no dispara con un solo lado:
  const unLado = conMarcoLados(256, 828, [0, 1], []);
  ok(tintaAlFiloSimetrica(unLado) === false, "tinta solo en filo superior → tintaAlFiloSimetrica=false (exige par opuesto)");
  //   · El MISMO bitmap E-14 cae escaneo POR FORMA (regla 3 — relajación de la
  //     banda E-14 sin blanco, calibración declarada del e63d, REPORTE §2:
  //     «hallazgo vigilado»). El null literal del kit solo es alcanzable FUERA
  //     de la banda E-14 (ver caso siguiente).
  const porForma = clasificarOrigen(unLado, null);
  ok(
    porForma.origen === "escaneo" && porForma.senales === "sin-exif+ratio-e14",
    `E-14 un lado (sin simetría) → escaneo POR FORMA banda E-14 [${porForma.senales}]`,
  );
  //   · ratio-fuera + tinta en un solo lado + sin blanco → null (sin simetría
  //     no hay escaneo por la vía F1 ni por forma).
  const unLadoFuera = bitmap(400, 400, (x, y) => (y === 0 ? TINTA : x < 6 || x >= 394 || y >= 394 ? FOTO : PAPEL));
  const nulo = clasificarOrigen(unLadoFuera, null);
  ok(
    nulo.origen === null && nulo.senales === "sin-exif+borde-no-blanco+ratio-fuera",
    `ratio-fuera + tinta un lado (sin simetría) → null [${nulo.senales}]`,
  );

  // (d) WhatsApp 4:3 sin EXIF → null (invariancia Fase E — regla intacta).
  const whatsapp = clasificarOrigen(bitmap(640, 480, (x, y) => (x < 8 || x >= 632 || y < 8 || y >= 472 ? FOTO : PAPEL)), null);
  ok(
    whatsapp.origen === null && whatsapp.senales === "sin-exif+borde-no-blanco+ratio-hoja",
    `WhatsApp 4:3 sin EXIF → null [${whatsapp.senales}]`,
  );

  // (e) EXIF de cámara → foto (regla intacta — el EXIF manda sobre el bitmap).
  ok(senalExifCamara(jpegConExifMake()) === "exif-camara", "JPEG sintético con Make → señal exif-camara");
  ok(senalExifCamara(prefijoHeic()) === "heic", "prefijo ftyp heic → señal heic");
  const conExif = clasificarOrigen(bitmap(640, 480, () => FOTO), "exif-camara");
  ok(conExif.origen === "foto", `EXIF cámara → foto (intocado) [${conExif.origen}]`);
}

// ───────── Bloque 4 · control negativo del perdón (ancla ANEXO A) ─────────
console.log("— Bloque 4 · control negativo: la mutilación real JAMÁS se perdona —");
{
  // Escaneo mutilado: marco cortado (3 lados inset) + falta de sección
  // inferior (faltaSeccionInferior — señal de tinta OCR, jamás perdonada).
  const mutilado = conMarcoLados(256, 828, [10, 818], [10]);
  const veredicto = evaluarMarcoDeBitmap(...dimsDe(mutilado));
  ok(veredicto.veredicto === "cortado", `escaneo mutilado → veredicto cortado [${veredicto.veredicto}]`);
  // AUN con lectura FUERTE: el perdón exige secciones presentes → false →
  // el cap INCOMPLETA del bridge queda vivo (completa=false → RECHAZADA
  // INCOMPLETA + cap 6.4 — ANEXO A caso 1: rechazo correcto por diseño).
  ok(
    marcoPerdonadoPorLectura("cortado", "FUERTE", true) === false,
    "cortado+FUERTE+faltaSeccion → NO perdonado → cap INCOMPLETA vivo (ANEXO A caso 1)",
  );
  ok(
    marcoPerdonadoPorLectura("cortado", "MEDIA", false) === false,
    "cortado+MEDIA → NO perdonado → cap INCOMPLETA vivo (ANEXO A caso 2)",
  );
}

console.log(`QA escaneo-ya-recortado: ${pasadas - fallos}/${pasadas} OK`);
if (fallos > 0) {
  console.log(`QA FALLÓ: ${fallos} caso(s) en rojo`);
  process.exit(1);
}
