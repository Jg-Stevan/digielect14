/**
 * Tests — ANEXO/Kit C (REPARTE-3-AGENTES-v1, Agente C): helpers PUROS del
 * informe — percentil (interpolación lineal), percentilesTiempos,
 * throughputEnviadas y ahorrosDedup. Sin DOM ni IDB: fixtures mínimos de
 * FilaInforme (mismo espíritu del humo de resumenDedup/resumenColgadas).
 *
 * WAVE2 (REPARTE-WAVE2-tiempos-v1, Agente C): C1 — el reuso (dupOf) deja de
 * mostrar consumo HEREDADO como propio (valorEtapa/percentiles/TXT/JSON);
 * C2 — diagnóstico del probe (A1) exportado tal cual; C3 — Tier estampado
 * en ENTORNO (ANEXO2, SOLO lectura de obs/dispositivo — D6).
 */
import { describe, expect, it } from "vitest";

import {
  actaLivianaJson,
  ahorrosDedup,
  percentil,
  percentilesTiempos,
  renderTxt,
  throughputEnviadas,
  valorEtapa,
  type FilaInforme,
} from "./informe";

/** Fixture mínimo de FilaInforme (campos requeridos a neutro — jamás
 *  inventar: lo que el test no sobreescribe queda null/0 honesto). */
function fila(over: Partial<FilaInforme>): FilaInforme {
  return {
    id: "",
    nombre: "",
    agregadaEn: 0,
    estado: "LISTA",
    error: null,
    statusActa: null,
    score: null,
    rechazo: null,
    paginaIndex: null,
    clasificacionNivel: null,
    lecturaNivel: null,
    gateCompleta: null,
    quadOrigen: null,
    tiempos: null,
    orientacionProbeMs: null,
    origen: null,
    origenSenales: null,
    skewGrados: null,
    deskewMs: null,
    gateMarco: null,
    watchdog: null,
    etapaAlMorir: null,
    elapsedMs: null,
    dedup: null,
    dedupDistancia: null,
    decodeMs: null,
    origenDecode: null,
    precalentada: false,
    precalorMs: null,
    tieneDiagnostico: false,
    conCarpeta: false,
    pesoImagenes: 0,
    extArchivo: "jpg",
    clasifDebil: null,
    serie: null,
    qrPayload: null,
    dedupHash: null,
    dupOf: null,
    ahorroMs: null,
    ...over,
  };
}

describe("percentil (interpolación lineal estándar)", () => {
  it("lista vacía → null sin reventar; 1 elemento → ese elemento", () => {
    expect(percentil([], 50)).toBeNull();
    expect(percentil([], 95)).toBeNull();
    expect(percentil([7], 50)).toBe(7);
    expect(percentil([7], 95)).toBe(7);
  });
  it("impar: p50 = el central; par: p50 = promedio de los dos centrales", () => {
    expect(percentil([1, 2, 3], 50)).toBe(2);
    expect(percentil([1, 2, 3, 4], 50)).toBe(2.5);
  });
  it("p95 con interpolación (1..100 → 95.05) y bordes p0/p100", () => {
    const mil = Array.from({ length: 100 }, (_, i) => i + 1);
    expect(percentil(mil, 95)).toBeCloseTo(95.05, 10);
    expect(percentil(mil, 0)).toBe(1);
    expect(percentil(mil, 100)).toBe(100);
  });
  it("entrada DESORDENADA: ordena antes de interpolar (pura — no muta)", () => {
    const entrada = [5, 1, 3];
    expect(percentil(entrada, 50)).toBe(3);
    expect(entrada).toEqual([5, 1, 3]); // sin mutación del argumento
  });
});

describe("valorEtapa / percentilesTiempos (decode REAL con precalor)", () => {
  it("decode: precalorMs cuando precalentada; decodeMs si no; null si nada", () => {
    expect(valorEtapa(fila({ precalentada: true, precalorMs: 640, decodeMs: 0 }), "decode")).toBe(640);
    expect(valorEtapa(fila({ precalentada: false, decodeMs: 1230 }), "decode")).toBe(1230);
    expect(valorEtapa(fila({ precalentada: false, decodeMs: 0 }), "decode")).toBe(0);
    expect(valorEtapa(fila({}), "decode")).toBeNull();
  });
  it("espera/probe/OCR/total leen SU campo real; sin dato → null", () => {
    const f = fila({ orientacionProbeMs: 10600, tiempos: { procesoMs: 1, calidadMs: 2, ocrMs: 16700, totalMs: 35000, esperaMs: 234000 } });
    expect(valorEtapa(f, "espera")).toBe(234000);
    expect(valorEtapa(f, "probe")).toBe(10600);
    expect(valorEtapa(f, "ocr")).toBe(16700);
    expect(valorEtapa(f, "total")).toBe(35000);
    expect(valorEtapa(fila({}), "probe")).toBeNull();
  });
  it("percentilesTiempos: p50/p95 por etapa con datos mezclados; cola vacía → todo null", () => {
    const filas = [
      fila({ orientacionProbeMs: 10000, tiempos: { procesoMs: 1, calidadMs: 1, ocrMs: 16000, totalMs: 34000, esperaMs: 60000 } }),
      fila({ orientacionProbeMs: 11000, tiempos: { procesoMs: 1, calidadMs: 1, ocrMs: 17000, totalMs: 36000, esperaMs: 240000 } }),
      fila({ orientacionProbeMs: 12000, tiempos: { procesoMs: 1, calidadMs: 1, ocrMs: 18000, totalMs: 38000, esperaMs: 120000 } }),
    ];
    const p = percentilesTiempos(filas);
    expect(p.probe).toEqual({ p50: 11000, p95: 11900 }); // p95 interpolado: 11000 + 0.9·1000
    expect(p.ocr).toEqual({ p50: 17000, p95: 17900 });
    expect(p.total).toEqual({ p50: 36000, p95: 37800 }); // 36000 + 0.9·2000
    expect(p.decode).toEqual({ p50: null, p95: null }); // nadie trae decode → jamás inventar
    const vacio = percentilesTiempos([]);
    expect(vacio.total).toEqual({ p50: null, p95: null });
  });
});

describe("throughputEnviadas (ENVIADAS por minuto de reloj)", () => {
  it("2 ENVIADAS con ventana de 1.5 min → 1.33 actas/min", () => {
    const filas = [
      fila({ statusActa: "ENVIADA", agregadaEn: 0, tiempos: { procesoMs: 1, calidadMs: 1, ocrMs: 1, totalMs: 30000, esperaMs: 60000 } }),
      fila({ statusActa: "ENVIADA", agregadaEn: 0, tiempos: { procesoMs: 1, calidadMs: 1, ocrMs: 1, totalMs: 30000, esperaMs: 120000 } }),
      fila({ statusActa: "DUPLICADA", tiempos: { procesoMs: 1, calidadMs: 1, ocrMs: 0, totalMs: 400 } }), // NO cuenta
    ];
    const tp = throughputEnviadas(filas);
    expect(tp.n).toBe(2);
    expect(tp.minutos).toBe(1.5); // inicio min 60 000 (0+60k) → fin máx 150 000 (0+120k+30k) = 90 000 ms
    expect(tp.porMinuto).toBe(1.33);
  });
  it("sin ENVIADAS con dato → nulls (jamás inventar)", () => {
    expect(throughputEnviadas([])).toEqual({ n: 0, minutos: null, porMinuto: null });
    expect(throughputEnviadas([fila({ statusActa: "DUPLICADA", tiempos: { procesoMs: 1, calidadMs: 1, ocrMs: 0, totalMs: 300 } })])).toEqual({
      n: 0,
      minutos: null,
      porMinuto: null,
    });
  });
});

describe("ahorrosDedup (ANEXO Tarea 2)", () => {
  it("original EN el lote: ahorro = totalMs original − totalMs copia", () => {
    const original = fila({ id: "orig-1", statusActa: "ENVIADA", tiempos: { procesoMs: 1, calidadMs: 1, ocrMs: 16700, totalMs: 35000, esperaMs: 60000 } });
    const copia = fila({ id: "copia-1", statusActa: "DUPLICADA", dupOf: "orig-1", dedup: "qr", tiempos: { procesoMs: 1, calidadMs: 1, ocrMs: 0, totalMs: 500 } });
    const r = ahorrosDedup([original, copia]);
    expect(r.porActa["copia-1"]).toBe(34500);
    expect(r.ahorroTotalMs).toBe(34500);
    // equivalente a 1 decimal (round((34500/35000)·10)/10 = 1)
    expect(r.ahorroEquivalenteActas).toBe(1);
  });
  it("sin original en el lote: cae a la media de ENVIADAS (fallback del anexo)", () => {
    const enviada = fila({ id: "e1", statusActa: "ENVIADA", tiempos: { procesoMs: 1, calidadMs: 1, ocrMs: 1, totalMs: 30000 } });
    const copia = fila({ id: "c1", statusActa: "DUPLICADA", dedup: "v2", tiempos: { procesoMs: 1, calidadMs: 1, ocrMs: 0, totalMs: 1000 } });
    const r = ahorrosDedup([enviada, copia]);
    expect(r.porActa["c1"]).toBe(29000);
  });
  it("copia sin totalMs o sin referencia → fuera (null, jamás inventar); totales null si nada", () => {
    const copiaSinDato = fila({ id: "c2", statusActa: "DUPLICADA", dupOf: "fantasma", tiempos: null });
    const r = ahorrosDedup([copiaSinDato]);
    expect(r.porActa).toEqual({});
    expect(r.ahorroTotalMs).toBeNull();
    expect(r.ahorroEquivalenteActas).toBeNull();
  });
  it("ahorro negativo (copia más lenta que la referencia) → clamp a 0, cuenta igual", () => {
    const enviada = fila({ id: "e1", statusActa: "ENVIADA", tiempos: { procesoMs: 1, calidadMs: 1, ocrMs: 1, totalMs: 30000 } });
    const copia = fila({ id: "c1", statusActa: "DUPLICADA", tiempos: { procesoMs: 1, calidadMs: 1, ocrMs: 0, totalMs: 31000 } });
    const r = ahorrosDedup([enviada, copia]);
    expect(r.porActa["c1"]).toBe(0);
    expect(r.ahorroTotalMs).toBe(0);
  });
});

// ---------- WAVE2 (REPARTE-WAVE2-tiempos-v1, Agente C) ----------

/** Entorno mínimo del txt (los campos nuevos tier/tierInferido son
 *  OPCIONALES — su ausencia ES el caso honesto sin datos). */
const ENTORNO = {
  userAgent: "vitest-w2",
  idioma: "es",
  nucleos: 8,
  memoriaGB: 8,
  crossOriginIsolated: false,
  url: "qa://wave2",
};

/** renderTxt con el resto de argumentos neutros (pura — sin DOM/IDB). */
function txtDe(
  entorno: Parameters<typeof renderTxt>[1],
  filas: FilaInforme[],
): string {
  return renderTxt(
    "2026-10-24T00:00:00.000Z",
    entorno,
    filas,
    { LISTA: filas.length },
    { ENVIADA: 1, DUPLICADA: Math.max(filas.length - 1, 0) },
    {
      procesoMs: null,
      calidadMs: null,
      ocrMs: null,
      totalMs: null,
      esperaMs: null,
      decodeMs: null,
      detectMs: null,
      persistMs: null,
      envioMs: null,
    },
    false,
    [],
  );
}

describe("WAVE2 C1 — el reuso (dupOf) deja de mostrar consumo heredado como propio", () => {
  /** Lote con UNA dup: probe/OCR/decode HEREDADOS del original (spread de
   *  reutilizarResultadoCritica, e72), total real ≈0 y espera propia. */
  function loteConDup() {
    const original = fila({
      id: "orig-0001",
      statusActa: "ENVIADA",
      orientacionProbeMs: 10052,
      decodeMs: 1100,
      tiempos: { procesoMs: 1, calidadMs: 1, ocrMs: 16700, totalMs: 36000, esperaMs: 60000 },
    });
    const copia = fila({
      id: "dup-0001",
      statusActa: "DUPLICADA",
      dupOf: "orig-0001",
      orientacionProbeMs: 10052, // heredado del original (e72)
      decodeMs: 1100, // heredado
      tiempos: { procesoMs: 1, calidadMs: 1, ocrMs: 16700, totalMs: 7, esperaMs: 120000 }, // OCR heredado; total/espera PROPIOS
    });
    return [original, copia];
  }

  it("valorEtapa: dup → decode/probe/OCR null; espera y total PROPIOS intactos", () => {
    const [, copia] = loteConDup();
    expect(valorEtapa(copia, "decode")).toBeNull();
    expect(valorEtapa(copia, "probe")).toBeNull();
    expect(valorEtapa(copia, "ocr")).toBeNull();
    expect(valorEtapa(copia, "espera")).toBe(120000);
    expect(valorEtapa(copia, "total")).toBe(7);
    // la original (sin dupOf) NO cambia — sus valores cuentan en TODO
    const [original] = loteConDup();
    expect(valorEtapa(original, "probe")).toBe(10052);
    expect(valorEtapa(original, "decode")).toBe(1100);
    expect(valorEtapa(original, "total")).toBe(36000);
  });

  it("percentiles: dup excluida de decode/probe/OCR/total; espera SÍ la incluye (su espera es real)", () => {
    const p = percentilesTiempos(loteConDup());
    expect(p.probe).toEqual({ p50: 10052, p95: 10052 }); // la copia NO contamina con el probe heredado
    expect(p.decode).toEqual({ p50: 1100, p95: 1100 });
    expect(p.ocr).toEqual({ p50: 16700, p95: 16700 });
    expect(p.total).toEqual({ p50: 36000, p95: 36000 }); // el total ≈0 real de la copia NO describe pipeline
    expect(p.espera).toEqual({ p50: 90000, p95: 117000 }); // AMBAS esperas reales (60000 + 0.95·60000)
  });

  it("TXT: la dup muestra '-' en decode/probe/OCR y SU total real; línea 'Reuso excluido' con n", () => {
    const txt = txtDe(ENTORNO, loteConDup());
    const lineaDup = txt.split("\n").find((l) => l.startsWith("dup-0001 "));
    expect(lineaDup).toBeDefined();
    expect(lineaDup).toContain("decode -");
    expect(lineaDup).toContain("probe -");
    expect(lineaDup).toContain("OCR -");
    expect(lineaDup).toContain("total 7");
    expect(lineaDup).toContain("espera 120000");
    expect(txt).toContain(
      "- Reuso excluido de percentiles decode/probe/OCR/total: 1 reuso (sus medias/p50 propios son ≈0 por diseño e72 — el p50 total describe solo actas que procesaron)",
    );
    // la línea de MEDIAS queda INTACTA (append-only — su contenido no cambia)
    expect(txt).toContain("- Tiempos medios (solo actas con diagnostico):");
  });

  it("JSON por acta: tiemposHeredados:true SOLO en la dup (D57 — la original no cambia de forma)", () => {
    const [original, copia] = loteConDup();
    expect(actaLivianaJson(copia)).toHaveProperty("tiemposHeredados", true);
    expect("tiemposHeredados" in actaLivianaJson(original)).toBe(false);
  });

  it("lote SIN reuso: línea con n=0 y percentiles intactos (0 cambios en lotes limpios)", () => {
    const original = fila({
      id: "orig-0002",
      statusActa: "ENVIADA",
      orientacionProbeMs: 9000,
      tiempos: { procesoMs: 1, calidadMs: 1, ocrMs: 15000, totalMs: 30000, esperaMs: 60000 },
    });
    const p = percentilesTiempos([original]);
    expect(p.total).toEqual({ p50: 30000, p95: 30000 });
    expect(p.probe).toEqual({ p50: 9000, p95: 9000 });
    const txt = txtDe(ENTORNO, [original]);
    expect(txt).toContain("- Reuso excluido de percentiles decode/probe/OCR/total: 0 reuso");
  });
});

describe("WAVE2 C2 — diagnóstico del probe (A1) exportado tal cual", () => {
  it("con diagnóstico de la mini: orientacionProbeMini + escala viajan al JSON por acta", () => {
    const f = fila({
      orientacionProbeMini: { rot: 90, aplicado: false, corte: "presupuesto", conf: 0.42, anclas: 1 },
      orientacionProbeEscala: 800,
    });
    const j = actaLivianaJson(f);
    expect(j.orientacionProbeMini).toEqual({
      rot: 90,
      aplicado: false,
      corte: "presupuesto",
      conf: 0.42,
      anclas: 1,
    });
    expect(j.orientacionProbeEscala).toBe(800);
  });

  it("sin diagnóstico de la mini: campos AUSENTES (jamás inventar — informes previos intactos)", () => {
    const j = actaLivianaJson(fila({}));
    expect("orientacionProbeMini" in j).toBe(false);
    expect("orientacionProbeEscala" in j).toBe(false);
  });
});

describe("WAVE2 C3 — Tier estampado en ENTORNO (ANEXO2 — SOLO lectura, D6)", () => {
  it("ALTO/MEDIO/BAJO: línea '- Tier: X' justo tras Núcleos/Memoria; '(inferido)' solo cuando aplica", () => {
    for (const tier of ["ALTO", "MEDIO", "BAJO"] as const) {
      const lineas = txtDe({ ...ENTORNO, tier, tierInferido: false }, []).split("\n");
      const iIdioma = lineas.findIndex((l) => l.startsWith("- Idioma:"));
      expect(lineas[iIdioma + 1]).toBe(`- Tier: ${tier}`);
    }
    const inferido = txtDe({ ...ENTORNO, tier: "MEDIO", tierInferido: true }, []).split("\n");
    const iIdioma = inferido.findIndex((l) => l.startsWith("- Idioma:"));
    expect(inferido[iIdioma + 1]).toBe("- Tier: MEDIO (inferido)");
  });

  it("caso honesto sin datos: sin tier el txt NO inventa la línea (byte-idéntico al pre-C3)", () => {
    expect(txtDe(ENTORNO, []).includes("- Tier:")).toBe(false);
  });
});
