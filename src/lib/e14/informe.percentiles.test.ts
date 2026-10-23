/**
 * Tests — ANEXO/Kit C (REPARTE-3-AGENTES-v1, Agente C): helpers PUROS del
 * informe — percentil (interpolación lineal), percentilesTiempos,
 * throughputEnviadas y ahorrosDedup. Sin DOM ni IDB: fixtures mínimos de
 * FilaInforme (mismo espíritu del humo de resumenDedup/resumenColgadas).
 */
import { describe, expect, it } from "vitest";

import {
  ahorrosDedup,
  percentil,
  percentilesTiempos,
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
