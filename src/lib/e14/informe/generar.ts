/**
 * generar.ts — INFORME-TELEMETRÍA v1 (SPEC-informe-telemetria-ocr-v1 §4.7 + §5)
 *
 * explicarScore: RE-DERIVA la cadena completa del score con las fórmulas del
 * puente (fuente de verdad: scoreDeCalidad/contrasteEfectivoDe + techos) y la
 * valida contra el score final real.
 * generarJson/generarTxt: el informe completo (JSON con fidelidad total,
 * TXT legible en 10 secciones). Descarga: Blob + a.download (hora Bogotá).
 * El informe NUNCA contiene data URLs de imágenes (AC-7).
 */
import type { Acta } from "../types";
import { statusDeScore } from "../types";
import type { MatrizResultado, CeldaMatriz } from "./matriz";
import { laboratorio } from "./referencia-lab";
import { evento, infoDispositivo, horaBogota, tomarEventos, tomarUltimoPipeline, descargarBlob, guardarBlobsInforme, type PipelineInfo } from "./telemetria";

// ─── explicarScore (§4.7) ───────────────────────────────────────────────────

export interface PasoScore {
  aplicado: boolean;
  texto: string;
  valor: number | null;
}

export interface ScoreExplicacion {
  pasos: PasoScore[];
  formula: string;
}

const FORMULA =
  "bruto = (sharpness·0.4 + brightness·0.3 + contEf·0.3)/10 → round 1 decimal · " +
  "contEf = ocrLegible ? max(contrast, 80) : contrast · " +
  "techos: level fair → 7.9 · poor → 6.4 · sin señal → 4.9 · " +
  "caps gate: fondo → 7.9 · recortada → 7.9 · " +
  "caps post-gate: INCOMPLETA → 6.4 · SIN_VOTOS → 6.4 · " +
  "override chip SIM: score = scoreSimulado";

export function explicarScore(p: PipelineInfo): ScoreExplicacion {
  const pasos: PasoScore[] = [];
  const q = p.calidad;
  const S = q?.sharpness ?? 0;
  const B = q?.brightness ?? 0;
  const C = q?.contrast ?? 0;
  let level = q?.level ?? "poor";
  let score = 0;

  // 1) métricas del recorte
  pasos.push({
    aplicado: true,
    texto: `métricas del recorte: sharpness=${S} brightness=${B} contrast=${C} level=${level}`,
    valor: null,
  });

  // 2) contraste efectivo (piso §X = 80 si el OCR leyó)
  const contEf = p.ocrValido ? Math.max(C, 80) : C;
  pasos.push({
    aplicado: p.ocrValido && contEf !== C,
    texto: `contraste efectivo = ocrLegible(${p.ocrValido}) ? max(${C}, 80) : ${C} = ${contEf}`,
    valor: contEf,
  });

  // 3) bruto (round 1 decimal)
  const bruto = (S * 0.4 + B * 0.3 + contEf * 0.3) / 10;
  score = Math.round(bruto * 10) / 10;
  pasos.push({
    aplicado: true,
    texto: `bruto = (${S}·0.4 + ${B}·0.3 + ${contEf}·0.3)/10 = ${bruto.toFixed(3)} → ${score}`,
    valor: score,
  });

  // level recalculado con el contraste efectivo (copia del puente)
  if (contEf !== C) {
    const scoreCore = S * 0.45 + B * 0.25 + contEf * 0.3;
    level = scoreCore >= 80 ? "excellent" : scoreCore >= 62 ? "good" : scoreCore >= 45 ? "fair" : "poor";
    pasos.push({
      aplicado: true,
      texto: `level recalculado con contEf: core ${scoreCore.toFixed(1)} → ${level}`,
      valor: null,
    });
  }

  // 4) techos por level
  if (level === "fair") {
    const prev = score;
    score = Math.min(score, 7.9);
    pasos.push({ aplicado: true, texto: `techo fair → 7.9 (${prev} → ${score})`, valor: score });
  }
  if (level === "poor") {
    const prev = score;
    score = Math.min(score, 6.4);
    pasos.push({ aplicado: true, texto: `techo poor → 6.4 (${prev} → ${score})`, valor: score });
  }
  if (!p.senalActa) {
    const prev = score;
    score = Math.min(score, 4.9);
    pasos.push({ aplicado: true, texto: `techo sin señal de contenido → 4.9 (${prev} → ${score})`, valor: score });
  }

  // 5) caps del gate (después de la inyección SIM — mismo orden del puente)
  const simActiva = p.simular && p.scoreSimulado !== null;
  if (simActiva) {
    score = p.scoreSimulado!;
    pasos.push({
      aplicado: true,
      texto: `override chip SIM: score = scoreSimulado = ${p.scoreSimulado}`,
      valor: score,
    });
  }
  if (p.completa && p.fondo) {
    const prev = score;
    score = Math.min(score, 7.9);
    pasos.push({ aplicado: true, texto: `cap escudo fondo → 7.9 (${prev} → ${score})`, valor: score });
  }
  if (p.recortada) {
    const prev = score;
    score = Math.min(score, 7.9);
    pasos.push({ aplicado: true, texto: `cap acta recortada → 7.9 (${prev} → ${score})`, valor: score });
  }

  // 6) caps post-gate
  if (p.completa === false) {
    const prev = score;
    score = Math.min(score, 6.4);
    pasos.push({ aplicado: true, texto: `cap INCOMPLETA → 6.4 (${prev} → ${score})`, valor: score });
  }
  if (p.completa && !p.votosOk) {
    const prev = score;
    score = Math.min(score, 6.4);
    pasos.push({ aplicado: true, texto: `cap SIN_VOTOS → 6.4 (${prev} → ${score})`, valor: score });
  }

  // 7/8) validación contra el score final REAL
  const derivado = Math.round(score * 10) / 10;
  if (Math.abs(derivado - p.scoreFinal) > 0.05) {
    pasos.push({
      aplicado: true,
      texto: `(inyectado por chip SIM: ${p.scoreFinal}) — derivado ${derivado} ≠ final ${p.scoreFinal}`,
      valor: p.scoreFinal,
    });
  } else {
    pasos.push({
      aplicado: true,
      texto: `score final = ${p.scoreFinal} (deriva OK · status ${statusDeScore(p.scoreFinal)})`,
      valor: p.scoreFinal,
    });
  }

  return { pasos, formula: FORMULA };
}

// ─── Conclusiones (§5 — reglas deterministas) ───────────────────────────────

export function generarConclusiones(
  p: PipelineInfo | null,
  matriz: MatrizResultado,
): string[] {
  const out: string[] = [];
  // KIT e14-motor-rapidocr-v1 (PROD-2 §4.4-C5): línea fija de veracidad —
  // desde PROD-2 el motor de producción es RapidOCR; la celda «actual» del
  // instrumento sigue midiendo Tesseract 1600 (motor anterior, matriz
  // congelada para comparar antes/después).
  out.push(
    "MOTOR DE PRODUCCIÓN: RapidOCR PP-OCRv4 (leyendo el recorte sin filtro, regla PROD-1) — las celdas «actual» de esta matriz miden Tesseract 1600, el motor anterior (instrumento congelado para comparar).",
  );
  const celdas = matriz.celdas.filter((c) => !c.error);
  const de = (motor: string, variante: string): CeldaMatriz | undefined =>
    celdas.find((c) => c.motor === motor && c.variante === variante);

  // 1) ¿original o filtros? (por motor, con NÚMEROS de esta captura)
  for (const motor of ["actual", "tesseract-fullres", "rapidocr-v4"]) {
    const sinFiltro = celdas
      .filter((c) => c.motor === motor && (c.variante === "recorte-raw" || c.variante === "foto-completa"))
      .sort(
        (a, b) =>
          b.anclas.hits - a.anclas.hits ||
          b.campos.ok - a.campos.ok ||
          b.chars - a.chars ||
          a.totalMs - b.totalMs,
      )[0];
    const conFiltro = de(motor, "recorte-bw");
    if (!sinFiltro || !conFiltro) continue;
    const ganaSin =
      sinFiltro.anclas.hits > conFiltro.anclas.hits ||
      (sinFiltro.anclas.hits === conFiltro.anclas.hits &&
        (sinFiltro.campos.ok > conFiltro.campos.ok ||
          (sinFiltro.campos.ok === conFiltro.campos.ok && sinFiltro.chars > conFiltro.chars)));
    const ganador = ganaSin ? sinFiltro : conFiltro;
    out.push(
      `¿ORIGINAL O FILTROS? Con el motor ${motor === "actual" ? "Tesseract 1600 (motor anterior)" : motor}, el recorte SIN filtro (${sinFiltro.variante}) recuperó ${sinFiltro.anclas.hits}/${sinFiltro.anclas.total} anclas y ${sinFiltro.chars} chars en ${sinFiltro.totalMs} ms; con filtro ${conFiltro.variante === "recorte-bw" ? "bw (imagen mostrada)" : conFiltro.variante}: ${conFiltro.anclas.hits}/${conFiltro.anclas.total} anclas y ${conFiltro.chars} chars en ${conFiltro.totalMs} ms → mejor captura: ${ganador.variante} (${ganaSin ? "sin filtro" : "con filtro"}).`,
    );
  }

  // 2) downscale 1600 (tesseract-fullres/raw vs actual/bw)
  const full = de("tesseract-fullres", "recorte-raw");
  const hoy = de("actual", "recorte-bw");
  if (full && hoy) {
    const dAnclas = full.anclas.hits - hoy.anclas.hits;
    const dChars = full.chars - hoy.chars;
    const dCer = full.cer !== null && hoy.cer !== null ? full.cer - hoy.cer : null;
    out.push(
      `DOWNSCALE 1600: Tesseract a resolución completa (${full.anclas.hits} anclas, ${full.chars} chars${full.cer !== null ? `, CER ${(full.cer * 100).toFixed(1)}%` : ""}) vs el motor anterior bw+1600 (${hoy.anclas.hits} anclas, ${hoy.chars} chars${hoy.cer !== null ? `, CER ${(hoy.cer * 100).toFixed(1)}%` : ""}) → Δanclas=${dAnclas >= 0 ? "+" : ""}${dAnclas}, Δchars=${dChars >= 0 ? "+" : ""}${dChars}${dCer !== null ? `, ΔCER=${dCer <= 0 ? "" : "+"}${(dCer * 100).toFixed(1)}pp` : ""}. El downscale a 1600 px ${dAnclas > 0 ? `cuesta ${dAnclas} anclas` : dAnclas === 0 ? "no pierde anclas en esta captura" : "no es el limitante aquí"}.`,
    );
  }

  // 3) ranking de motores (mejor celda de cada motor por gtHits||anclas+campos)
  const motores = ["actual", "tesseract-fullres", "rapidocr-v4"];
  const ranking = motores
    .map((m) => {
      const mejores = celdas
        .filter((c) => c.motor === m)
        .sort(
          (a, b) =>
            (b.gt?.hits ?? 0) - (a.gt?.hits ?? 0) ||
            b.anclas.hits + b.campos.ok - (a.anclas.hits + a.campos.ok) ||
            (a.cer ?? 1) - (b.cer ?? 1) ||
            a.totalMs - b.totalMs,
        )[0];
      return { motor: m, celda: mejores };
    })
    .filter((r) => r.celda);
  if (ranking.length >= 2) {
    const ordenados = ranking.slice().sort((a, b) => {
      const ka = (a.celda!.gt?.hits ?? 0) * 100 + a.celda!.anclas.hits + a.celda!.campos.ok;
      const kb = (b.celda!.gt?.hits ?? 0) * 100 + b.celda!.anclas.hits + b.celda!.campos.ok;
      return kb - ka;
    });
    out.push(
      `RANKING EN EL DISPOSITIVO: ${ordenados
        .map(
          (r, i) =>
            `${i + 1}.º ${r.motor} (${r.celda!.gt ? `GT ${r.celda!.gt.hits}/${r.celda!.gt.total}` : `anclas ${r.celda!.anclas.hits}/${r.celda!.anclas.total}`}, ${r.celda!.totalMs} ms en ${r.celda!.variante})`,
        )
        .join(" · ")}. Referencia de laboratorio (ranking definitivo, fotos reales ×4): RapidOCR PP-OCRv4 49/56 vs Tesseract tuned 39/56 vs Tesseract (motor anterior) 27/56.`,
    );
  }

  // 4) tiempos del pipeline
  if (p) {
    const ms = p.ms;
    const etapas: [string, number][] = [
      ["decode", ms.decode],
      ["detect", ms.detect],
      ["proceso", ms.proceso],
      ["calidad", ms.calidad],
      ["ocr", ms.ocr],
    ];
    const dominante = etapas.sort((a, b) => b[1] - a[1])[0];
    const shareOcr = ms.total > 0 ? Math.round((ms.ocr / ms.total) * 100) : 0;
    out.push(
      `TIEMPOS DEL PIPELINE: total ${Math.round(ms.total)} ms · etapa dominante ${dominante[0]} ${Math.round(dominante[1])} ms (${ms.total > 0 ? Math.round((dominante[1] / ms.total) * 100) : 0}% del total) · OCR ${Math.round(ms.ocr)} ms (${shareOcr}%).`,
    );
  }

  // 5) recomendaciones condicionadas
  const rawActual = de("actual", "recorte-raw");
  const bwActual = de("actual", "recorte-bw");
  if (rawActual && bwActual && rawActual.anclas.hits >= bwActual.anclas.hits) {
    out.push(
      `RECOMENDACIÓN: cambiar el INPUT del OCR de bw→raw no añade costo (mismo downscale del worker) y recupera anclas (${rawActual.anclas.hits} vs ${bwActual.anclas.hits} en esta captura).`,
    );
  }
  const rapidRaw = celdas.find((c) => c.motor === "rapidocr-v4" && (c.variante === "recorte-raw" || c.variante === "foto-completa"));
  const tessMejor = celdas.filter((c) => c.motor !== "rapidocr-v4").sort((a, b) => b.anclas.hits - a.anclas.hits)[0];
  if (rapidRaw && tessMejor && rapidRaw.anclas.hits >= tessMejor.anclas.hits && rapidRaw.totalMs <= tessMejor.totalMs * 1.5) {
    out.push(
      `RECOMENDACIÓN: adoptar RapidOCR (entrada: foto cruda) como motor principal — ${rapidRaw.anclas.hits} anclas vs ${tessMejor.anclas.hits} del mejor Tesseract con tiempo comparable (${rapidRaw.totalMs} ms vs ${tessMejor.totalMs} ms); ~17 MB de modelos cacheables.`,
    );
  }
  if (p) {
    if (p.recortada) out.push("TECHO APLICADO: 7.9 por acta recortada (OCR de secciones) — el papel salió cortado en el encuadre.");
    if (p.completa && p.fondo) out.push("TECHO APLICADO: 7.9 por escudo anti-fondo — franja oscura ≥85% al filo (fondo/sombra del warp).");
    if (p.completa === false) out.push("CAP APLICADO: 6.4 por acta INCOMPLETA — el guard detectó tinta cortada (o sospecha con recorte inservible).");
    if (p.completa && !p.votosOk) out.push("CAP APLICADO: 6.4 por SIN_VOTOS — la zona de votos no tiene tinta (gate obligatorio).");
    if (p.sospecha) out.push(`NOTA DE DETECCIÓN: lados sospechosos «${p.sospecha}» (densidades ${(p.densidades ?? []).map((d) => `${d.toFixed(1)}%`).join(", ") || "—"}).`);
  }
  if (matriz.omitidaMotivo) {
    out.push(`MATRIZ OMITIDA: ${matriz.omitidaMotivo} — el comparativo en-dispositivo no aplica a esta captura.`);
  }
  return out;
}

// ─── Esquema del informe (JSON) ─────────────────────────────────────────────

export interface InformeJson {
  esquema: "informe-e14-telemetria-v1";
  generado: { iso: string; bogota: string };
  dispositivo: ReturnType<typeof infoDispositivo>;
  captura: {
    fuente: string;
    intento: number;
    maxIntentos: number;
    objetivo: { mesa: string; tipo: string; pagina: number } | null;
    archivo: { nombre: string; tipo: string; bytes: number } | null;
    foto: { w: number; h: number; dataUrlLen: number } | null;
  };
  pipeline: Record<string, unknown> | null;
  resultado: Record<string, unknown> | null;
  scoreExplicacion: ScoreExplicacion;
  matrizOCR: {
    omitidaMotivo: string | null;
    variantes: MatrizResultado["variantes"];
    celdas: CeldaMatriz[];
    referenciaUsada: boolean;
    presupuestoMs: number;
    duracionMs: number;
  };
  laboratorio: ReturnType<typeof laboratorio>;
  conclusiones: string[];
  eventos: ReturnType<typeof tomarEventos>;
}

export async function construirInforme(
  acta: Acta,
  ctx: { fuente: string; intento: number; maxIntentos: number; objetivo: { mesaId: string; tipo: string; pagina: number } | null; simular: boolean },
  matriz: MatrizResultado,
): Promise<InformeJson> {
  const pipeline = tomarUltimoPipeline();
  let fotoDims: { w: number; h: number } | null = null;
  const { loadImage } = await import("@jg-stevan/scanner-core/image-processor");
  if (acta.fotoOriginal) {
    try {
      const img = await loadImage(acta.fotoOriginal);
      fotoDims = { w: img.naturalWidth || img.width, h: img.naturalHeight || img.height };
    } catch {
      fotoDims = null;
    }
  }

  const clas = acta.clasificacion;
  return {
    esquema: "informe-e14-telemetria-v1",
    generado: { iso: new Date().toISOString(), bogota: horaBogota() },
    dispositivo: infoDispositivo(),
    captura: {
      fuente: ctx.fuente,
      intento: ctx.intento,
      maxIntentos: ctx.maxIntentos,
      objetivo: ctx.objetivo
        ? { mesa: ctx.objetivo.mesaId, tipo: ctx.objetivo.tipo, pagina: ctx.objetivo.pagina }
        : null,
      archivo: null, // el anclaje §6.2 no expone el File — campo reservado
      foto: acta.fotoOriginal
        ? {
            w: fotoDims?.w ?? 0,
            h: fotoDims?.h ?? 0,
            dataUrlLen: acta.fotoOriginal.length,
          }
        : null,
    },
    pipeline: pipeline
      ? {
          registrado: pipeline.registrado,
          fuente: pipeline.fuente,
          entradaArchivo: pipeline.entradaArchivo,
          ms: pipeline.ms,
          quad: pipeline.quad,
          sinRecorte: pipeline.sinRecorte,
          cropInfo: pipeline.cropInfo,
          filtro: pipeline.filtroActa,
          // PROD-1 (§4.4a): la entrada del OCR queda auto-descripta en el JSON.
          ocrInputFiltro: pipeline.ocrInputFiltro,
          // KIT e14-motor-rapidocr-v1 (PROD-2 §4.2): motor y conf del OCR de
          // producción, auto-descriptos en el JSON (§6.4 del kit).
          ocrMotor: pipeline.ocrMotor,
          ocrConf: pipeline.ocrConf,
          motor: pipeline.motor,
          ocrChars: pipeline.ocrChars,
          ocrValido: pipeline.ocrValido,
        }
      : null,
    resultado: pipeline
      ? {
          score: pipeline.scoreFinal,
          status: pipeline.status,
          rechazo: pipeline.rechazo,
          clasificacion: clas
            ? {
                departamento: clas.departamento,
                municipio: clas.municipio,
                zona: clas.zona,
                puesto: clas.puesto,
                mesa: clas.mesa,
                tipo: clas.tipo,
                pagina: clas.pagina,
                kit: clas.kit,
                nivel: clas.nivel,
                parciales: clas.parciales ?? null,
              }
            : null,
          pagina: acta.pagina,
          recortada: pipeline.recortada,
          completa: pipeline.completa,
          sospecha: pipeline.sospecha,
          tintaFilo: pipeline.tintaFilo,
          densidades: pipeline.densidades,
          fondo: pipeline.fondo,
          procesadaVacia: pipeline.procesadaVacia,
          votos: { densidadPct: pipeline.votosDensidadPct, skipPag2: pipeline.votosSkipPag2, ok: pipeline.votosOk },
          senal: pipeline.senalActa,
          ocrValido: pipeline.ocrValido,
          metricas: pipeline.calidad,
        }
      : null,
    scoreExplicacion: pipeline ? explicarScore(pipeline) : { pasos: [], formula: FORMULA },
    matrizOCR: {
      omitidaMotivo: matriz.omitidaMotivo,
      variantes: matriz.variantes,
      celdas: matriz.celdas,
      referenciaUsada: matriz.celdas.some((c) => c.simRef !== null),
      presupuestoMs: matriz.presupuestoMs,
      duracionMs: matriz.duracionMs,
    },
    laboratorio: laboratorio(),
    conclusiones: generarConclusiones(pipeline, matriz),
    eventos: tomarEventos(),
  };
}

// ─── TXT (10 secciones) ─────────────────────────────────────────────────────

const line = (c: string) => c;

function fmtCeldaTabla(c: CeldaMatriz): string {
  if (c.error) return `  ${c.motor} / ${c.variante}: ERROR — ${c.error}`;
  const gt = c.gt ? ` · GT ${c.gt.hits}/${c.gt.total}` : "";
  const cer = c.cer !== null ? ` · CER ${(c.cer * 100).toFixed(1)}%` : "";
  const sim = c.simRef !== null ? ` · simRef ${(c.simRef * 100).toFixed(1)}%` : "";
  const conf = c.conf !== null ? ` · conf ${(c.conf * 100).toFixed(1)}%` : "";
  return line(
    `  ${c.motor.padEnd(18)} ${c.variante.padEnd(14)} ${String(c.chars).padStart(5)} chars  ${String(c.palabras).padStart(4)} pal  anclas ${c.anclas.hits}/${c.anclas.total}  campos ${c.campos.ok}  ${String(c.totalMs).padStart(6)} ms  carga ${c.cargaMs ?? "—"}${conf}${gt}${cer}${sim}`,
  );
}

export async function generarTxt(informe: InformeJson, textosPorCelda: string[]): Promise<string> {
  const L: string[] = [];
  const separador = "═".repeat(78);
  L.push(separador);
  L.push("INFORME E-14 — TELEMETRÍA DE CAPTURA + COMPARATIVO OCR (informe-e14-telemetria-v1)");
  L.push(`Generado: ${informe.generado.bogota} (Bogotá) · ${informe.generado.iso}`);
  L.push(separador);

  // 1 FICHA
  L.push("");
  L.push("1 · FICHA DE LA CAPTURA");
  L.push(`  fuente: ${informe.captura.fuente} · intento ${informe.captura.intento}/${informe.captura.maxIntentos}`);
  L.push(`  objetivo: ${informe.captura.objetivo ? `${informe.captura.objetivo.mesa} ${informe.captura.objetivo.tipo} pág ${informe.captura.objetivo.pagina}` : "—"}`);
  L.push(`  foto original: ${informe.captura.foto ? `${informe.captura.foto.w}x${informe.captura.foto.h} · dataUrl ${informe.captura.foto.dataUrlLen} bytes` : "—"}`);
  L.push(`  acta: ${informe.captura.fuente} · intento ${informe.captura.intento}/${informe.captura.maxIntentos} (identidad completa en el JSON)`);

  // 2 PIPELINE
  L.push("");
  L.push("2 · PIPELINE (ms por etapa)");
  const p = informe.pipeline as { ms?: Record<string, number>; filtro?: string; ocrInputFiltro?: string; motor?: string; ocrChars?: number; registrado?: boolean } | null;
  if (p?.ms) {
    for (const [k, v] of Object.entries(p.ms)) L.push(`  ${k.padEnd(9)} ${String(Math.round(v)).padStart(7)} ms`);
    L.push(`  filtro=${p.filtro} · ocrInputFiltro=${p.ocrInputFiltro ?? ""} · motor=${p.motor} · ocrChars=${p.ocrChars} · registrado=${p.registrado}`);
  } else {
    L.push("  (pipeline no registrado — salida temprana del flujo, AC-3)");
  }

  // 3 RESULTADO DEL GATE
  L.push("");
  L.push("3 · RESULTADO DEL GATE");
  const r = informe.resultado as { score?: number; status?: string; rechazo?: { tipo: string; detalle: string } | null; recortada?: boolean; completa?: boolean | null; fondo?: boolean; votos?: { densidadPct: number; skipPag2: boolean; ok: boolean } } | null;
  if (r) {
    L.push(`  score: ${r.score} → status: ${r.status}`);
    L.push(`  rechazo: ${r.rechazo ? `${r.rechazo.tipo} — ${r.rechazo.detalle}` : "null"}`);
    L.push(`  completa=${r.completa} · recortada=${r.recortada} · fondo=${r.fondo} · votos=${JSON.stringify(r.votos)}`);
  } else {
    L.push("  (sin resultado — pipeline no registrado)");
  }

  // 4 ¿POR QUÉ ESE SCORE?
  L.push("");
  L.push("4 · ¿POR QUÉ ESE SCORE? (cadena completa)");
  L.push(`  fórmula: ${informe.scoreExplicacion.formula}`);
  for (const paso of informe.scoreExplicacion.pasos) {
    L.push(`  [${paso.aplicado ? "x" : " "}] ${paso.texto}`);
  }

  // 5 CLASIFICACIÓN (puesto)
  L.push("");
  L.push("5 · CLASIFICACIÓN (puesto)");
  const clas = (informe.resultado as { clasificacion?: Record<string, unknown> } | null)?.clasificacion;
  if (clas) {
    L.push(`  ${JSON.stringify(clas, null, 2).split("\n").join("\n  ")}`);
  } else {
    L.push("  (sin clasificación)");
  }

  // 6 MATRIZ OCR
  L.push("");
  L.push("6 · MATRIZ OCR EN EL DISPOSITIVO");
  if (informe.matrizOCR.omitidaMotivo) {
    L.push(`  MATRIZ OMITIDA: ${informe.matrizOCR.omitidaMotivo}`);
  } else {
    L.push("  motor              variante        chars   pal  anclas     campos      ms  carga");
    for (const c of informe.matrizOCR.celdas) L.push(fmtCeldaTabla(c));
    L.push(`  variantes: ${informe.matrizOCR.variantes.map((v) => `${v.nombre} ${v.w}x${v.h} (${v.buildMs}ms)`).join(" · ")}`);
    L.push(`  duración matriz: ${informe.matrizOCR.duracionMs} ms (presupuesto ${Math.round(informe.matrizOCR.presupuestoMs / 1000)} s)`);
    // textos por celda (1200 chars máx en TXT; completos en JSON)
    L.push("");
    for (let i = 0; i < informe.matrizOCR.celdas.length; i++) {
      const c = informe.matrizOCR.celdas[i];
      if (c.error) continue;
      const texto = textosPorCelda[i] ?? "";
      L.push(`  ── ${c.motor} / ${c.variante} ──`);
      L.push(
        texto
          .slice(0, 1200)
          .split("\n")
          .map((t) => `    | ${t}`)
          .join("\n"),
      );
      if (texto.length > 1200) L.push(`    … (+${texto.length - 1200} chars — completos en el JSON)`);
      L.push("");
    }
    // veredicto original vs filtros (los números están en conclusiones §8)
    const conclFiltros = informe.conclusiones.filter((s) => s.startsWith("¿ORIGINAL O FILTROS?"));
    for (const s of conclFiltros) L.push(`  ${s}`);
  }

  // 7 REFERENCIA DE LABORATORIO
  L.push("");
  L.push("7 · REFERENCIA DE LABORATORIO");
  L.push(`  nota: ${informe.laboratorio.nota}`);
  for (const v of informe.laboratorio.verdict2) {
    L.push(`  ${v.motor.padEnd(24)} ${v.foto.padEnd(30)} ${String(v.hits).padStart(2)}/${v.total} (${v.ms ?? "—"} ms) miss: ${v.miss}`);
  }
  for (const m of informe.laboratorio.measureVerdict) {
    L.push(`  ${m.motor.padEnd(24)} CER ${m.cer}% · líneas ${m.lineas} · anclas ${m.anclas} · conf ${m.conf} · ${m.tiempo}`);
  }

  // 8 CONCLUSIONES
  L.push("");
  L.push("8 · CONCLUSIONES / RECOMENDACIONES");
  for (const s of informe.conclusiones) L.push(`  • ${s}`);

  // 9 BITÁCORA
  L.push("");
  L.push("9 · BITÁCORA DE EVENTOS");
  for (const e of informe.eventos) {
    L.push(`  ${String(e.tMs).padStart(7)} ms  ${e.hora}  ${e.tipo.padEnd(22)} ${e.detalle}`);
  }

  // 10 ENTORNO
  L.push("");
  L.push("10 · ENTORNO");
  L.push(`  ${JSON.stringify(informe.dispositivo, null, 2).split("\n").join("\n  ")}`);
  L.push("");
  L.push(separador);
  return L.join("\n");
}

// ─── Descarga (§4.7) ────────────────────────────────────────────────────────

export async function emitirInforme(
  informe: InformeJson,
  textosPorCelda: string[],
  nombreBase: string,
): Promise<void> {
  evento("informe/serializacion", `JSON + TXT (textos de ${textosPorCelda.length} celdas)`);
  const json = JSON.stringify(informe, null, 2);
  const txt = await generarTxt(informe, textosPorCelda);
  const blobJson = new Blob([json], { type: "application/json" });
  const blobTxt = new Blob([txt], { type: "text/plain;charset=utf-8" });
  guardarBlobsInforme(
    { blob: blobTxt, nombre: `${nombreBase}.txt` },
    { blob: blobJson, nombre: `${nombreBase}.json` },
  );
  evento(
    "informe/blobs",
    `TXT ${(blobTxt.size / 1024).toFixed(1)} KB · JSON ${(blobJson.size / 1024).toFixed(1)} KB (sin imágenes, AC-7)`,
  );
  // auto-descarga de AMBOS (programática; si el navegador la bloquea queda la píldora)
  descargarBlob(blobTxt, `${nombreBase}.txt`);
  descargarBlob(blobJson, `${nombreBase}.json`);
}

