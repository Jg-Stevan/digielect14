/**
 * Descriptores del contrato de paridad del motor post-OCR
 * (`scripts/gen-contrato-motor.ts` → `src/lib/e14/__fixtures__/contrato-motor.json`).
 *
 * Cada descriptor es un texto OCR SINTÉTICO de una cabecera E-14, fabricado con
 * los códigos PÚBLICOS de la base DIVIPOL del repo y los códigos 1D ya citados
 * en el propio `clasificador.ts`. NO son actas ni informes reales (RED LINE 7).
 *
 * Los textos se copian DENTRO del golden, así que `supervision-e14` los consume
 * desde ahí; este archivo solo vive para (re)generar.
 */

/** Cabecera EL CAIRO (Egipto: mun 335 · zona 05 · puesto 02 «El Cairo -
 *  Consulado»): kit 399 en REGISTRO_KITS, d9=3 ⇒ TRANSMISIÓN, ver 01 / pag 1 de 2. */
function textoElCairo(
  lugar: string,
  opts: { sinTipo?: boolean; sinCodigo?: boolean; mesa?: string; pag?: string } = {},
): string {
  return [
    "REGISTRADURIA NACIONAL DEL ESTADO CIVIL",
    "E-14",
    "CONSULADO: 88 - CONSULADOS",
    "PAIS: 335 - EGIPTO",
    `ZONA: 05 PUESTO: 02 MESA: ${opts.mesa ?? "001"}`,
    `LUGAR: ${lugar}`,
    ...(opts.sinTipo ? [] : ["TRANSMISIÓN"]),
    ...(opts.sinCodigo ? [] : ["710003993010102"]),
    opts.pag ?? "Ver. 01 Pag: 1 de 2",
  ].join("\n");
}

/** Cabecera ALEMANIA (mun 120): zona 05 puesto 02 «Berlin Consulado» · zona 15
 *  puesto 02 «Frankfurt Consulado». Kit 726 = Berlin (mesa 8) · 745 = Frankfurt
 *  (mesa 12) — `REGISTRO_KITS`. */
function textoBerlin(
  lugar: string,
  opts: {
    sinTipo?: boolean;
    sinCodigo?: boolean;
    zona?: string;
    mesa?: string;
    codigo?: string;
    banda?: string;
    verpag?: string;
  } = {},
): string {
  return [
    "E-14",
    "CONSULADO: 88 - CONSULADOS",
    "PAIS: 120 - ALEMANIA",
    `ZONA: ${opts.zona ?? "05"} PUESTO: 02 MESA: ${opts.mesa ?? "001"}`,
    `LUGAR: ${lugar}`,
    ...(opts.sinTipo ? [] : [opts.banda ?? "TRANSMISIÓN"]),
    ...(opts.sinCodigo ? [] : [opts.codigo ?? "710007263010102"]),
    opts.verpag ?? "Ver. 01 Pag: 1 de 2",
  ].join("\n");
}

interface DescriptorContrato {
  id: string;
  nota: string;
  ocr: string;
}

export const DESCRYPTORES: DescriptorContrato[] = [
  {
    id: "cairo-auto",
    nota: "Ruta completa legible + kit del consenso → AUTO (el caso feliz, igual en el móvil y en el lote); el pie «SUMA TOTAL» visto ⇒ no RECORTADA",
    ocr: textoElCairo("El Cairo - Consulado") + "\nSUMA TOTAL",
  },
  {
    id: "cairo-lugar-ruidoso",
    nota: "LUGAR mal leído («EI Calro-Consulado»): la normalización canónica I↔L lo resuelve igual",
    ocr: textoElCairo("EI Calro-Consulado"),
  },
  {
    id: "cairo-lugar-ilegible-con-kit",
    nota: "LUGAR ilegible y el código 1D corrobora la ruta → AUTO con aviso display LUGAR-DESVIADO",
    ocr: textoElCairo("88-02"),
  },
  {
    id: "cairo-lugar-ilegible-sin-kit",
    nota: "Mismo LUGAR ilegible SIN código → techo de confianza y SUGERIDA por puesto-lugar",
    ocr: textoElCairo("88-02", { sinCodigo: true }),
  },
  {
    id: "cairo-sin-banda",
    nota: "Banda de tipo ausente → el balde fino dice «tipo» (sin tipo de copia nunca es AUTO)",
    ocr: textoElCairo("El Cairo - Consulado", { sinTipo: true, sinCodigo: true }),
  },
  {
    id: "cairo-mesa-nesa",
    nota: "«NESA. 001» (M→N del OCR): la mesa se recupera con la tolerancia de ancla",
    ocr: textoElCairo("El Cairo - Consulado").replace("MESA: 001", "NESA. 001"),
  },
  {
    id: "cairo-sin-verpag",
    nota: "Sin «Ver/Pag» → pagina null; la ruta sigue resuelta (el page index no es ancla de envío)",
    ocr: textoElCairo("El Cairo - Consulado", { pag: "" }),
  },
  {
    id: "berlin-auto",
    nota: "Berlin con su kit de registro (726, mesa 8) → AUTO",
    ocr: textoBerlin("Berlin Consulado", { mesa: "008" }),
  },
  {
    id: "berlin-lugar-de-otra-ciudad",
    nota: "LUGAR de Frankfurt leído en la zona de Berlin, sin código → cap 0.75 + SUGERIDA (control negativo)",
    ocr: textoBerlin("FRANKFURT CONSULADO", { sinCodigo: true }),
  },
  {
    id: "berlin-lugar-de-otra-ciudad-con-tipo-falto",
    nota: "Cap de LUGAR + banda ausente: el balde reporta «puesto-lugar» (prioridad sobre «tipo»)",
    ocr: textoBerlin("FRANKFURT CONSULADO", { sinCodigo: true, sinTipo: true }),
  },
  {
    id: "frankfurt-banda-delegados",
    nota: "Zona 15 puesto 02 con banda DELEGADOS y su kit (745, mesa 12): tipo y página resueltos",
    ocr: textoBerlin("Frankfurt Consulado", {
      zona: "15",
      mesa: "012",
      banda: "DELEGADOS",
      codigo: "710007453020102",
    }),
  },
  {
    id: "frankfurt-mesa-fuera-registro",
    nota: "MESA 005 leída contra el registro 745=12 → MESA_REGISTRO_DISCREPAN y downgrade a SUGERIDA (red line)",
    ocr: textoBerlin("Frankfurt Consulado", { zona: "15", mesa: "005", codigo: "710007453010102" }),
  },
  {
    id: "frankfurt-codigo-con-barras",
    nota: "Código 1D leído «/1000/453010202» (7 impreso como /): tolerancia de candidatos, kit por consenso; «FIRMA» vista en la pág 2 ⇒ no RECORTADA",
    ocr: textoBerlin("Frankfurt Consulado", {
      zona: "15",
      mesa: "012",
      sinCodigo: true,
    }).concat("\n/1000/453010202", "\nFIRMA"),
  },
  // ── Puesto resuelto por NOMBRE del LUGAR (celdas ZONA/PUESTO ilegibles —
  //    foto del móvil emborronada). Aquí vive el umbral UMBRAL_AUTO=0.82: sin
  //    estos tres descriptores el golden NO lo pinsa y se puede mover el
  //    threshold sin que ningún test se entere (medido: 0.82 → 0.85 pasaba
  //    verde con los demás descriptores).
  {
    id: "cairo-puesto-por-lugar-086",
    nota: "Códigos ilegibles, LUGAR «El Ciro - Consulado» → puesto por fuzzy con conf 0.86 → AUTO",
    ocr: textoElCairo("El Ciro - Consulado", { sinCodigo: true }).replace(
      "ZONA: 05 PUESTO: 02 MESA: 001",
      "ZONA: -- PUESTO: -- MESA: 001",
    ),
  },
  {
    id: "cairo-puesto-por-lugar-082",
    nota: "El canto EXACTO del umbral: conf 0.82 y `>=` inclusivo ⇒ sigue siendo AUTO (mover 0.82 un punto lo rompe)",
    ocr: textoElCairo("El Cairo - onsulad", { sinCodigo: true }).replace(
      "ZONA: 05 PUESTO: 02 MESA: 001",
      "ZONA: -- PUESTO: -- MESA: 001",
    ),
  },
  {
    id: "cairo-puesto-por-lugar-078",
    nota: "Justo por debajo: conf 0.78 < 0.82 → SUGERIDA con el puesto igual de resuelto (display sí, autoenvío no)",
    ocr: textoElCairo("El Cairo - CQnsulada", { sinCodigo: true }).replace(
      "ZONA: 05 PUESTO: 02 MESA: 001",
      "ZONA: -- PUESTO: -- MESA: 001",
    ),
  },
  {
    id: "cairo-lugar-parcial-con-codigos",
    nota: "LUGAR leído a medias («El Cairo 02», sim 0.56) con los CÓDIGOS exactos → hoy sin cap y AUTO; si UMBRAL_VERIFICACION_LUGAR sube, esto cae a SUGERIDA",
    ocr: textoElCairo("El Cairo 02", { sinCodigo: true }),
  },
  {
    id: "cairo-lugar-solo-consulado",
    nota: "LUGAR leído solo «Consulado» (sim 0.56) SIN códigos: hoy NO alcanza UMBRAL_SUGERIDA=0.6 y el puesto queda null; si el 0.6 se baja a 0.55 se resuelve solo",
    ocr: textoElCairo("Consulado", { sinCodigo: true }).replace(
      "ZONA: 05 PUESTO: 02 MESA: 001",
      "ZONA: -- PUESTO: -- MESA: 001",
    ),
  },
  {
    id: "ruta-sin-pais",
    nota: "Cabecera sin línea PAIS (rescate por dep): balde «ruta» — el móvil y el lote degradan igual",
    ocr: [
      "REGISTRADURIA NACIONAL DEL ESTADO CIVIL",
      "E-14",
      "CONSULADO: 88 - CONSULADOS",
      "LUGAR: XYZQP SIN SENTIDO",
      "TRANSMISIÓN",
      "710003993010102",
    ].join("\n"),
  },
  {
    id: "no-es-e14",
    nota: "Foto que NO es un E-14 (sin ancla de cabecera) → MANUAL con todo null: el gate lo rechaza en ambos repos",
    ocr: ["FACTURA DE LUZ IBERDROLA", "IMPORTE 44,90 EUR", "REF. 000123456789"].join("\n"),
  },
  {
    id: "basura-ocr",
    nota: "Salida de OCR ilegible (ruído puro) → MANUAL sin campos, misma salida en los dos motores",
    ocr: ["aro i1t9 zz", "l8 0.31", "~ ~ ~"].join("\n"),
  },
];
