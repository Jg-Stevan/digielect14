/**
 * KIT e14-informe-analisis-v1 (T1): INFORME de análisis de la cola MASIVA —
 * ZIP construido TODO en el navegador (sin red, §0.7) con las actas
 * problema: original.jpg + procesada.jpg byte-idénticas (sin re-encode) +
 * ficha.json completa (diagnóstico incluido, SIN fotos) + informe.json
 * global (SIN dataURLs — prohibido §6) + informe.txt legible.
 *
 * REINTRODUCCIÓN POR PEDIDO EXPLÍCITO del dueño (19/10: «informe
 * automáticamente… en un archivo comprimido para analizar las imágenes sin
 * modificar y modificadas»). §0.2: NADA se descarga solo — este módulo solo
 * CONSTRUYE el blob; la descarga vive detrás del botón «INFORME ↓» de
 * RESUMEN (T2). El retiro e14-fuera-informes-v1 sigue vigente para todo lo
 * demás (acumulador localStorage, auto-descarga al rechazar, COMPORTAMIENTO).
 *
 * Receta rescatada de d57e538 (diagnostico.ts, hoy borrado): fflate STORE
 * { level: 0 } (JPEG ya comprimido — NO re-comprimir) + dataUrlABytes (atob
 * → Uint8Array, byte-idéntico) + Blob + createObjectURL (hoy downloadBlob
 * del core 0.1.0 lo resuelve — ReviewView.tsx:31 ya lo usa).
 *
 * Fuente de datos: SOLO la cola masiva (IndexedDB e14-masiva-v1 vía
 * listarRegistros/leerRegistro — consumo tal cual, cola.ts INTOCABLE). El
 * flujo INDIVIDUAL no persiste actas (limitación documentada en el REPORTE).
 * Lectura SECUENCIAL: el mapa liviano sale de listarMapeados() (mapper en el
 * cursor — RAM acotada) y el contenido de carpetas se materializa con
 * leerRegistro() UNO A LA VEZ (nunca Promise.all — RAM acotada, T1.1).
 */
import { listarMapeados, leerRegistro } from "./masiva/cola";
import type { EstadoEntrada, RegistroMasiva } from "./masiva/tipos";

// ---------- Tope de tamaño (T1.6) ----------
/** Tope de imágenes: si el estimado supera esto, solo las 50 actas-problema
 *  más recientes llevan imágenes (el informe.json SIEMPRE lista todo). */
const TOPE_IMAGENES_BYTES = 250 * 1024 * 1024;
const TOPE_ACTAS_CON_IMAGEN = 50;
/** Filas LISTA que SÍ llevan carpeta con imágenes (T1.3). Las ÓPTIMA/
 *  ENVIADA solo van en informe.json; ERROR con Blob lleva la suya. */
const ESTADOS_CARPETA: readonly string[] = [
  "RECHAZADA",
  "ADVERTENCIA",
  "EN_REVISION_HUMANA",
];

// ---------- Tipos públicos ----------

/** Entorno donde nació el informe (T1.2) — datos reales para calibrar. */
export interface EntornoInforme {
  userAgent: string;
  idioma: string;
  nucleos: number | null;
  memoriaGB: number | null;
  crossOriginIsolated: boolean;
  url: string;
}

/** Fila liviana de la cola — base del informe.json (T1.2) y del filtro de
 *  carpetas (T1.3). CERO dataURLs: los fotos viven SOLO en las carpetas. */
export interface FilaInforme {
  id: string;
  nombre: string;
  agregadaEn: number;
  estado: EstadoEntrada;
  /** Motivo corto de las filas ERROR (null en las demás). */
  error: string | null;
  statusActa: string | null;
  score: number | null;
  rechazo: { tipo: string; detalle: string } | null;
  paginaIndex: number | null;
  clasificacionNivel: string | null;
  lecturaNivel: string | null;
  gateCompleta: boolean | null;
  quadOrigen: string | null;
  tiempos: {
    procesoMs: number;
    calidadMs: number;
    ocrMs: number;
    totalMs: number;
    /** D57 — KIT e14-instrumentos-espera-v1: espera en cola MASIVA (solo
     *  filas procesadas con el kit activo — ausente jamás se inventa). */
    esperaMs?: number;
  } | null;
  /** D57 — KIT e14-instrumentos-espera-v1 (T2): ms del probe de orientación
   *  del diagnóstico (null cuando no corrió — SIM/registros previos). */
  orientacionProbeMs: number | null;
  /** ¿El acta trae diagnóstico completo? (base de detección/tiempos). */
  tieneDiagnostico: boolean;
  /** ¿Esta fila lleva carpeta en actas/ (T1.3)? */
  conCarpeta: boolean;
  /** Peso estimado de imágenes de su carpeta (dataURL×3/4 o Blob.size). */
  pesoImagenes: number;
  /** Extensión real para original.<ext> de filas ERROR con Blob (T1.3). */
  extArchivo: string;
}

/** Resumen para la UI (T2) — espejo de lo importante del informe.json. */
export interface ResumenInforme {
  generado: string;
  totalActas: number;
  carpetas: number;
  porEstadoFila: Record<string, number>;
  porStatusActa: Record<string, number>;
  tiemposMediosMs: {
    procesoMs: number | null;
    calidadMs: number | null;
    ocrMs: number | null;
    totalMs: number | null;
    /** D57 — media de esperaMs SOLO sobre actas con el dato (null si
     *  ninguna lo trae — jamás inventar, kit §2). */
    esperaMs: number | null;
  };
  /** Tope T1.6 aplicado: imágenes recortadas a las N más recientes. */
  imagenesRecortadasA: number | null;
  actasSinImagen: string[];
  /** Peso REAL del zip terminado. */
  pesoZipBytes: number;
}

/** Progreso opcional (T1.5: el código puede reportar; la UI hoy no lo pinta). */
export interface ProgresoInforme {
  fase: "LEYENDO" | "EMPAQUETANDO";
  actual: number;
  total: number;
}

export interface InformeZip {
  blob: Blob;
  nombre: string;
  resumen: ResumenInforme;
}

// ---------- Helpers puros ----------

/** dataURL → bytes EXACTOS (atob, sin re-encode — receta d57e538 §9.3). */
function dataUrlABytes(dataUrl: string): Uint8Array {
  const coma = dataUrl.indexOf(",");
  const base64 = coma === -1 ? dataUrl : dataUrl.slice(coma + 1);
  const binaria = atob(base64);
  const bytes = new Uint8Array(binaria.length);
  for (let i = 0; i < binaria.length; i += 1) bytes[i] = binaria.charCodeAt(i);
  return bytes;
}

/** Extensión REAL para el original.<ext> de una fila ERROR con Blob: la del
 *  nombre manda (el guard dejó pasar por extensión); si no hay, el MIME. */
function extensionDe(reg: RegistroMasiva): string {
  const porNombre = /\.([a-z0-9]{2,5})$/i.exec(reg.nombre)?.[1]?.toLowerCase();
  if (porNombre) return porNombre;
  const porMime: Record<string, string> = {
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
    "image/heic": "heic",
    "image/heif": "heif",
  };
  return porMime[reg.archivo?.type ?? ""] ?? "bin";
}

/** Mapa liviano de un registro (lectura del listado — CERO dataURLs aquí). */
function filaLiviana(reg: RegistroMasiva): FilaInforme {
  const acta = reg.acta;
  const diag = acta?.diagnostico;
  const conCarpeta =
    reg.estado === "ERROR"
      ? !!reg.archivo // ERROR de pipeline: conserva el Blob (T1.3)
      : reg.estado === "LISTA"
        ? !!acta && ESTADOS_CARPETA.includes(acta.status)
        : false;
  const pesoImagenes =
    reg.estado === "ERROR"
      ? (reg.archivo?.size ?? 0)
      : Math.floor(
          (((acta?.fotoOriginal?.length ?? 0) +
            (acta?.fotoProcesada?.length ?? 0)) *
            3) /
            4,
        );
  return {
    id: reg.id,
    nombre: reg.nombre,
    agregadaEn: reg.agregadaEn,
    estado: reg.estado,
    error: reg.error ?? null,
    statusActa: acta?.status ?? null,
    score: acta?.score ?? null,
    rechazo: acta?.rechazo
      ? { tipo: acta.rechazo.tipo, detalle: acta.rechazo.detalle }
      : null,
    paginaIndex: acta?.pagina?.index ?? null,
    clasificacionNivel: acta?.clasificacion?.nivel ?? null,
    lecturaNivel: diag ? diag.lectura.nivel : null,
    gateCompleta: diag ? diag.gate.completa : null,
    quadOrigen: diag ? diag.captura.quadOrigen : null,
    tiempos: diag?.tiempos ?? null,
    // D57 — instrumentos aditivos: orientacionProbeMs cuando el diagnóstico
    // lo trae (null si no — la forma del mapa NO cambia para los parsers).
    orientacionProbeMs: diag?.orientacionProbeMs ?? null,
    tieneDiagnostico: !!diag,
    conCarpeta,
    pesoImagenes,
    extArchivo: extensionDe(reg),
  };
}

/** Conteo por valor — claves fijas a 0 cuando se pasan (JSON estable). */
function conteo(
  valores: Array<string | null | undefined>,
  claves?: readonly string[],
): Record<string, number> {
  const mapa: Record<string, number> = {};
  if (claves) for (const clave of claves) mapa[clave] = 0;
  for (const valor of valores) {
    if (valor == null) continue;
    mapa[valor] = (mapa[valor] ?? 0) + 1;
  }
  return mapa;
}

/** Medias SOLO sobre actas con el dato (sin inventar — T1.2). */
function mediosTiempos(filas: FilaInforme[]): ResumenInforme["tiemposMediosMs"] {
  // D57 — "esperaMs" AÑADIDO (aditivo — los campos viejos no cambian de
  // forma; compatibilidad con informes previos, kit §4-T3).
  const campos = ["procesoMs", "calidadMs", "ocrMs", "totalMs", "esperaMs"] as const;
  const medias: Record<string, number | null> = {};
  for (const campo of campos) {
    const valores = filas
      .map((f) => f.tiempos?.[campo])
      .filter((v): v is number => typeof v === "number");
    medias[campo] = valores.length
      ? Math.round(valores.reduce((a, b) => a + b, 0) / valores.length)
      : null;
  }
  return medias as ResumenInforme["tiemposMediosMs"];
}

/** Entorno real del navegador (T1.2) — datos para calibrar, sin inventar. */
function entornoInforme(): EntornoInforme {
  if (typeof navigator === "undefined") {
    return {
      userAgent: "",
      idioma: "",
      nucleos: null,
      memoriaGB: null,
      crossOriginIsolated: false,
      url: "",
    };
  }
  const nav = navigator as Navigator & { deviceMemory?: number };
  return {
    userAgent: nav.userAgent,
    idioma: nav.language,
    nucleos: nav.hardwareConcurrency ?? null,
    memoriaGB: nav.deviceMemory ?? null,
    crossOriginIsolated:
      typeof crossOriginIsolated === "boolean" ? crossOriginIsolated : false,
    url: typeof location !== "undefined" ? location.href : "",
  };
}

/** Nombre de archivo/carpeta seguro (T1.8): minúsculas, sin espacios ni
 *  caracteres raros, máx 40. Vacío → «acta» (nunca un tramo vacío). */
function sanitizarNombre(nombre: string): string {
  const limpio = nombre
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^[.\-]+/, "")
    .slice(0, 40)
    .replace(/[.\-]+$/, "");
  return limpio || "acta";
}

/** Carpeta única por fila (T1.8): id + nombre sanitizado + estado — el id
 *  ya hace única la carpeta; el sufijo -2 es el cinturón del kit. */
function nombreCarpeta(fila: FilaInforme, usados: Set<string>): string {
  const estado =
    fila.estado === "LISTA" ? (fila.statusActa ?? "LISTA") : fila.estado;
  const base = `${fila.id}-${sanitizarNombre(fila.nombre)}-${estado}`;
  let nombre = base;
  let n = 2;
  while (usados.has(nombre)) {
    nombre = `${base}-${n}`;
    n += 1;
  }
  usados.add(nombre);
  return nombre;
}

/** Entrada liviana del array actas[] del informe.json (T1.2 — campos exactos
 *  del kit; PROHIBIDO fotoOriginal/fotoProcesada/ocrTexto aquí). */
function actaLivianaJson(fila: FilaInforme) {
  return {
    id: fila.id,
    nombre: fila.nombre,
    agregadaEn: fila.agregadaEn,
    estado: fila.estado,
    error: fila.error,
    statusActa: fila.statusActa,
    score: fila.score,
    rechazo: fila.rechazo,
    paginaIndex: fila.paginaIndex,
    clasificacionNivel: fila.clasificacionNivel,
    lecturaNivel: fila.lecturaNivel,
    gateCompleta: fila.gateCompleta,
    quadOrigen: fila.quadOrigen,
    tiempos: fila.tiempos,
    // D57 — por-acta, SOLO cuando exista (kit §4-T3: "cuando existan" —
    // JSON.stringify omite undefined → informes previos no cambian de forma).
    ...(fila.orientacionProbeMs != null
      ? { orientacionProbeMs: fila.orientacionProbeMs }
      : {}),
  };
}

/** informe.txt — render legible del MISMO contenido del informe.json (T1). */
function renderTxt(
  generado: string,
  entorno: EntornoInforme,
  filas: FilaInforme[],
  porEstadoFila: Record<string, number>,
  porStatusActa: Record<string, number>,
  tiemposMedios: ResumenInforme["tiemposMediosMs"],
  recortado: boolean,
  sinImagen: string[],
): string {
  const L: string[] = [];
  const linea = (s = "") => L.push(s);
  linea("E14 - INFORME DE ANALISIS DE LA COLA MASIVA");
  linea("=".repeat(46));
  linea(`Generado: ${generado}`);
  linea(`Fuente: cola-masiva (IndexedDB e14-masiva-v1)`);
  linea();
  linea("ENTORNO");
  linea(`- Navegador: ${entorno.userAgent}`);
  linea(`- Idioma: ${entorno.idioma} - Nucleos: ${entorno.nucleos ?? "?"} - Memoria(GB): ${entorno.memoriaGB ?? "?"}`);
  linea(`- crossOriginIsolated: ${entorno.crossOriginIsolated}`);
  linea(`- URL: ${entorno.url}`);
  linea();
  linea("TOTALES");
  linea(`- Actas en la cola: ${filas.length}`);
  linea(
    `- Por estado de fila: ${Object.entries(porEstadoFila)
      .map(([k, v]) => `${k} ${v}`)
      .join(" - ")}`,
  );
  linea(
    `- Por estado del acta: ${Object.entries(porStatusActa)
      .map(([k, v]) => `${k} ${v}`)
      .join(" - ")}`,
  );
  linea(
    `- Tiempos medios (solo actas con diagnostico): total ${tiemposMedios.totalMs ?? "-"}ms - proceso ${tiemposMedios.procesoMs ?? "-"}ms - calidad ${tiemposMedios.calidadMs ?? "-"}ms - OCR ${tiemposMedios.ocrMs ?? "-"}ms`,
  );
  // D57 — KIT e14-instrumentos-espera-v1 (T3): línea NUEVA tras los tiempos
  // medios (append-only — los parsers del dueño van por prefijo). p50 SOLO
  // sobre actas con esperaMs; sin datos → "-" (jamás inventar).
  const esperas = filas
    .map((f) => f.tiempos?.esperaMs)
    .filter((v): v is number => typeof v === "number")
    .sort((a, b) => a - b);
  const p50 = esperas.length
    ? Math.round(
        esperas.length % 2 === 1
          ? esperas[(esperas.length - 1) / 2]
          : (esperas[esperas.length / 2 - 1] + esperas[esperas.length / 2]) / 2,
      )
    : null;
  linea(
    `- Espera media en cola: ${tiemposMedios.esperaMs ?? "-"}ms (p50 ${p50 ?? "-"}ms) — pipeline-real ≈ total − espera`,
  );
  linea();
  const rechazoFilas = filas.filter((f) => f.rechazo);
  linea(`RECHAZOS (${rechazoFilas.length})`);
  if (!rechazoFilas.length) linea("- Ninguno");
  for (const f of rechazoFilas) {
    linea(`- [${f.estado}/${f.statusActa}] ${f.nombre}: ${f.rechazo?.tipo} - ${f.rechazo?.detalle}`);
  }
  linea();
  const deteccion = conteo(
    filas.filter((f) => f.tieneDiagnostico).map((f) => f.quadOrigen ?? "null"),
    ["worker", "sobel", "null"],
  );
  linea(
    `DETECCION (quadOrigen): ${Object.entries(deteccion)
      .map(([k, v]) => `${k} ${v}`)
      .join(" - ")}`,
  );
  linea();
  linea(`ACTAS (${filas.length})`);
  filas.forEach((f, i) => {
    const trozos = [
      `[${f.estado}${f.statusActa ? `/${f.statusActa}` : ""}]`,
      f.nombre,
      f.score != null ? `score ${f.score}` : null,
      f.rechazo ? `${f.rechazo.tipo}: ${f.rechazo.detalle}` : null,
      f.paginaIndex != null ? `P${f.paginaIndex}` : null,
      f.clasificacionNivel ? `nivel ${f.clasificacionNivel}` : null,
      f.lecturaNivel ? `lectura ${f.lecturaNivel}` : null,
      f.gateCompleta != null ? `gate ${f.gateCompleta ? "completa" : "incompleta"}` : null,
      f.quadOrigen ? `quad ${f.quadOrigen}` : null,
      f.tiempos ? `${f.tiempos.totalMs}ms` : null,
      f.error ? `error ${f.error}` : null,
    ].filter((t): t is string => t != null);
    linea(`${i + 1}. ${trozos.join(" - ")}`);
  });
  if (recortado) {
    linea();
    linea(
      `IMAGENES RECORTADAS A LAS ${TOPE_ACTAS_CON_IMAGEN} ACTAS-PROBLEMA MAS RECIENTES (${sinImagen.length} sin imagenes):`,
    );
    for (const id of sinImagen) linea(`- ${id}`);
  }
  linea();
  linea("Limitacion: la fuente es la cola MASIVA - las actas del flujo");
  linea("individual no persisten y no aparecen aqui.");
  return `${L.join("\n")}\n`;
}

// ---------- Punto de entrada ----------

/**
 * Construir el ZIP del informe (T1). La descarga la hace la UI con
 * downloadBlob (core) — aquí SOLO se construye. Lanza COLA_VACIA si la cola
 * no tiene registros (la UI la trata con el botón deshabilitado).
 */
export async function generarInformeZip(
  onProgreso?: (p: ProgresoInforme) => void,
): Promise<InformeZip> {
  // T1.1 — fuente de datos: la cola masiva. FIX C6 (auditoría 2-c): el mapa
  // liviano sale del MAPPER DENTRO del cursor — los registros completos
  // (acta con dataURLs de ~7-14 MB c/u) JAMÁS se materializan todos a la
  // vez (el listado anterior hacía pico de >1 GB en jornadas reales).
  // Después leerRegistro(id) UNO A LA VEZ (nunca Promise.all).
  const filas = await listarMapeados(filaLiviana);
  if (!filas.length) throw new Error("COLA_VACIA");

  // T1.6 — tope: estimar imágenes de carpetas ANTES de compilar. Si pasa
  // 250 MB → solo las 50 actas-problema más recientes llevan imágenes.
  const candidatas = filas.filter((f) => f.conCarpeta);
  const pesoTotal = candidatas.reduce((n, f) => n + f.pesoImagenes, 0);
  const recortado = pesoTotal > TOPE_IMAGENES_BYTES;
  const conImagen = new Set<string>(candidatas.map((f) => f.id));
  let sinImagen: string[] = [];
  if (recortado) {
    const ordenadas = [...candidatas].sort((a, b) => b.agregadaEn - a.agregadaEn);
    conImagen.clear();
    for (const f of ordenadas.slice(0, TOPE_ACTAS_CON_IMAGEN)) conImagen.add(f.id);
    sinImagen = ordenadas.slice(TOPE_ACTAS_CON_IMAGEN).map((f) => f.id);
  }

  // T1.2 — informe.json (global, SIN imágenes — prohibido §6).
  const generado = new Date().toISOString();
  const entorno = entornoInforme();
  const porEstadoFila = conteo(
    filas.map((f) => f.estado),
    ["PENDIENTE", "PROCESANDO", "LISTA", "ERROR"],
  );
  const porStatusActa = conteo(
    filas.map((f) => f.statusActa),
    ["ENVIADA", "OPTIMA", "ADVERTENCIA", "RECHAZADA", "EN_REVISION_HUMANA"],
  );
  const tiemposMedios = mediosTiempos(filas);
  const informe = {
    generado,
    fuente: "cola-masiva" as const,
    entorno,
    totales: {
      actas: filas.length,
      porEstadoFila,
      porStatusActa,
      tiemposMediosMs: tiemposMedios,
    },
    rechazos: {
      porTipo: conteo(
        filas.flatMap((f) => (f.rechazo ? [f.rechazo.tipo] : [])),
      ),
      porDetalle: conteo(
        filas.flatMap((f) => (f.rechazo ? [f.rechazo.detalle] : [])),
      ),
    },
    deteccion: conteo(
      filas.filter((f) => f.tieneDiagnostico).map((f) => f.quadOrigen ?? "null"),
      ["worker", "sobel", "null"],
    ),
    actas: filas.map(actaLivianaJson),
    ...(recortado
      ? { imagenesRecortadasA: TOPE_ACTAS_CON_IMAGEN, actasSinImagen: sinImagen }
      : {}),
  };
  const codificador = new TextEncoder();
  const contenidos: Record<string, Uint8Array> = {
    "informe.json": codificador.encode(JSON.stringify(informe, null, 2)),
    "informe.txt": codificador.encode(
      renderTxt(
        generado,
        entorno,
        filas,
        porEstadoFila,
        porStatusActa,
        tiemposMedios,
        recortado,
        sinImagen,
      ),
    ),
  };

  // T1.3/T1.4 — carpetas: leerRegistro UNO A LA VEZ; la referencia del
  // registro muere con cada iteración (RAM acotada). Las ÓPTIMA/ENVIADA y
  // las recortadas por el tope NO materializan carpeta.
  // FIX M11 (auditoría 2-c): leerRegistro SOLO para filas con carpeta —
  // antes deserializaba el registro completo (acta enorme incluida) de
  // TODAS las filas, incluidas las que no aportan nada al ZIP.
  const usados = new Set<string>();
  let carpetas = 0;
  let actual = 0;
  for (const fila of filas) {
    if (fila.conCarpeta && conImagen.has(fila.id)) {
      const reg = await leerRegistro(fila.id);
      const ruta = `actas/${nombreCarpeta(fila, usados)}`;
      if (fila.estado === "ERROR") {
        // ERROR de pipeline: el Blob original + ficha mínima (sin acta).
        if (reg.archivo) {
          contenidos[`${ruta}/original.${fila.extArchivo}`] = new Uint8Array(
            await reg.archivo.arrayBuffer(),
          );
        }
        contenidos[`${ruta}/ficha.json`] = codificador.encode(
          JSON.stringify(
            {
              id: reg.id,
              nombre: reg.nombre,
              estado: reg.estado,
              error: reg.error ?? null,
            },
            null,
            2,
          ),
        );
      } else if (reg.acta) {
        // LISTA problema: original/procesada byte-idénticos + ficha COMPLETA
        // menos fotos (diagnóstico incluido — el corazón del análisis).
        const acta = reg.acta;
        if (acta.fotoOriginal) {
          contenidos[`${ruta}/original.jpg`] = dataUrlABytes(acta.fotoOriginal);
        }
        if (acta.fotoProcesada) {
          contenidos[`${ruta}/procesada.jpg`] = dataUrlABytes(
            acta.fotoProcesada,
          );
        }
        const ficha: Record<string, unknown> = {
          ...acta,
          nombreFila: reg.nombre,
          agregadaEn: reg.agregadaEn,
        };
        delete ficha.fotoOriginal;
        delete ficha.fotoProcesada;
        contenidos[`${ruta}/ficha.json`] = codificador.encode(
          JSON.stringify(ficha, null, 2),
        );
      }
      carpetas += 1;
    }
    actual += 1;
    onProgreso?.({ fase: "LEYENDO", actual, total: filas.length });
  }

  // T1.5 — zip() ASYNC con STORE { level: 0 }: no bloquea el hilo de la UI
  // y NO re-comprime JPEGs ya comprimidos (receta d57e538).
  onProgreso?.({ fase: "EMPAQUETANDO", actual: 0, total: 1 });
  const { zip } = await import("fflate");
  const empaquetado = await new Promise<Uint8Array>((resolve, reject) => {
    zip(contenidos, { level: 0 }, (err, datos) =>
      err ? reject(err) : resolve(datos),
    );
  });

  const ahora = new Date();
  const p2 = (n: number) => String(n).padStart(2, "0");
  const sello = `${ahora.getFullYear()}${p2(ahora.getMonth() + 1)}${p2(
    ahora.getDate(),
  )}-${p2(ahora.getHours())}${p2(ahora.getMinutes())}${p2(ahora.getSeconds())}`;
  // TS 5.7 estricto (mismo pitfall resuelto en archivos.ts): fflate aloca su
  // propio ArrayBuffer (byteOffset 0) — el cast declara lo que ya es cierto.
  const blob = new Blob([empaquetado as Uint8Array<ArrayBuffer>], {
    type: "application/zip",
  });
  return {
    blob,
    nombre: `e14-informe-${sello}.zip`,
    resumen: {
      generado,
      totalActas: filas.length,
      carpetas,
      porEstadoFila,
      porStatusActa,
      tiemposMediosMs: tiemposMedios,
      imagenesRecortadasA: recortado ? TOPE_ACTAS_CON_IMAGEN : null,
      actasSinImagen: sinImagen,
      pesoZipBytes: empaquetado.length,
    },
  };
}
