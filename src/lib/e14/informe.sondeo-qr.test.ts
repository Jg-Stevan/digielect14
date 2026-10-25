/**
 * Tests — KIT e73-sondeo-qr-precoz-v1 (§E, T5 ≥ 2): la línea ADITIVA del
 * informe «Sondeo QR: N leídos · M con payload · p50/p95 · tiers:».
 *  · Presente con datos reales (N/M/p50/p95/desglose por tier).
 *  · Honestidad SIN datos (0/0 · "-/-" · tiers "-" — jamás inventar).
 *  · Posición ADITIVA al final de TOTALES (después de «Rescates rechazo:» —
 *    D51: los parsers del dueño van por prefijo, jamás reordenar).
 *  · totalesDedup.qrSondeo cuenta las gemelas del sondeo (dedup "qr-sondeo").
 * Fixture: MISMO patrón de informe.wave3.test.ts (FilaInforme mínimo).
 */
import { describe, expect, it } from "vitest";

import { renderTxt, resumenDedup, type FilaInforme } from "./informe";

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
    rescateRechazo: null,
    sondeoQrMs: null, // KIT e73 (§E) — telemetría del sondeo (null en fixtures)
    sondeoQrTier: null,
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

const ENTORNO = {
  userAgent: "vitest-e73",
  idioma: "es-CO",
  nucleos: 4,
  memoriaGB: 8,
  crossOriginIsolated: false,
  url: "https://vitest.local/",
};

function render(filas: FilaInforme[]): string {
  return renderTxt(
    "2026-10-24T12:00:00.000Z",
    ENTORNO,
    filas,
    { LISTA: filas.length },
    { OPTIMA: filas.length },
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

describe("e73 §E — línea aditiva «Sondeo QR» del informe", () => {
  it("1 · presente con datos: N leídos · M con payload · p50/p95 · desglose por tier", () => {
    const txt = render([
      fila({ id: "a", sondeoQrMs: 42, sondeoQrTier: "full" }),
      fila({ id: "b", sondeoQrMs: 84, sondeoQrTier: "recorte" }),
      fila({ id: "c", sondeoQrMs: 30, sondeoQrTier: null }), // corrió sin lectura
    ]);
    expect(txt).toContain("Sondeo QR: 3 leídos · 2 con payload");
    expect(txt).toMatch(
      /Sondeo QR: 3 leídos · 2 con payload · p50\/p95 \d+(?:\.\d+)?\/\d+(?:\.\d+)? ms · tiers: full 1 \/ recorte 1/,
    );
  });

  it("2 · sin datos → 0/0 · '-/-' · tiers '-' (honesto — jamás inventar)", () => {
    const txt = render([fila({ id: "a" })]);
    expect(txt).toContain("Sondeo QR: 0 leídos · 0 con payload · p50/p95 -/- ms · tiers: -");
  });

  it("3 · posición ADITIVA: la línea va DESPUÉS de «Rescates rechazo:» (D51)", () => {
    const txt = render([
      fila({ id: "a", sondeoQrMs: 42, sondeoQrTier: "full" }),
    ]);
    const iRescates = txt.indexOf("Rescates rechazo: 0 usados / 0 salvaron");
    const iSondeo = txt.indexOf("Sondeo QR: 1 leídos · 1 con payload");
    expect(iRescates).toBeGreaterThan(-1);
    expect(iSondeo).toBeGreaterThan(iRescates); // AL FINAL de TOTALES
  });

  it("4 · totalesDedup.qrSondeo cuenta las gemelas del sondeo (dedup 'qr-sondeo')", () => {
    const r = resumenDedup([
      fila({ id: "a", dedup: "qr-sondeo" }),
      fila({ id: "b", dedup: "qr-sondeo" }),
      fila({ id: "c", dedup: "qr" }),
    ]);
    expect(r.qrSondeo).toBe(2); // e73 — pre-pool (jamás slot/probe/OCR)
    expect(r.qr).toBe(1); // e63m — capa 0 in-pool (INTACTA)
    expect(r.matches).toBe(1); // semántica e66 ESTABLE — qr-sondeo NO entra al set e66 (como las puertas wave3)
  });
});

// ─── KIT e14-obs-hang-atribucion-v1 (§E, T5 ≥ 3) — D57 por fila + sello reuso ──
import { actaLivianaJson, filaLiviana } from "./informe";
import type { RegistroMasiva } from "./masiva/tipos";

describe("§E.1 — telemetría del sondeo POR FILA en actaLivianaJson", () => {
  it("registro con sondeoQr → sondeoQrMs/sondeoQrTier presentes en el JSON del export", () => {
    const json = actaLivianaJson(
      fila({ sondeoQrMs: 1840, sondeoQrTier: "recorte" }),
    );
    expect(json.sondeoQrMs).toBe(1840);
    expect(json.sondeoQrTier).toBe("recorte");
  });
  it("registro SIN sondeo (pre-e73/flag OFF/hard-kill) → campos AUSENTES (jamás inventar)", () => {
    const json = actaLivianaJson(fila({}));
    expect("sondeoQrMs" in json).toBe(false);
    expect("sondeoQrTier" in json).toBe(false);
  });
});

describe("§E.2 — sello EXPORT-ONLY 'reuso' (dupOf sin capa — jamás sobre un sello real)", () => {
  const reg = (over: Partial<RegistroMasiva>): RegistroMasiva =>
    ({
      id: "r1",
      nombre: "a.jpg",
      agregadaEn: 1,
      estado: "LISTA",
      ...over,
    }) as RegistroMasiva;

  it("dupOf SIN dedup → dedup 'reuso' (desenlace heredado e72 — legible en el export)", () => {
    const f = filaLiviana(reg({ dupOf: "original-1" }));
    expect(f.dedup).toBe("reuso");
    // y viaja al JSON del acta:
    expect(actaLivianaJson(f).dedup).toBe("reuso");
  });
  it("sello REAL + dupOf → el sello queda INTACTO (jamás sobre-escribir)", () => {
    expect(filaLiviana(reg({ dupOf: "original-2", dedup: "qr-sondeo" })).dedup).toBe("qr-sondeo");
    expect(filaLiviana(reg({ dupOf: "original-3", dedup: "ya-enviada-copia" })).dedup).toBe("ya-enviada-copia");
  });
  it("sin dupOf y sin dedup → null honesto (originales/legacy intactos)", () => {
    expect(filaLiviana(reg({})).dedup).toBeNull();
  });
});
