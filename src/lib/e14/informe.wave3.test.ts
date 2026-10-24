/**
 * Tests — WAVE3 (obs-informe-wave3-v1) · Observabilidad del informe (§C):
 *  · C.1 — Outliers procesoMs >6s EXCLUYE el reuso (dupOf — tiemposHeredados
 *    e72): el lote 9 real pasaba de 19 → 11. Etiqueta SIN CAMBIOS (D51).
 *  · C.3 — Toda fila ERROR es visible al final de su línea ACTAS: con motivo
 *    → `error "<motivo>"`; sin motivo (registro pre-wave3) → la AUSENCIA es
 *    visible, jamás inventada. El chunk histórico `error X` queda intacto.
 *  · C.4 — qrCortoInforme 24 chars: los 4 payloads del gap real (informe
 *    104609) producen 4 prefijos DISTINTOS (el corte 8 COLISIONABA — par
 *    LcyzMYaR diverge en el char 22; 16 chars aún colisionaban).
 *  · C.2 — DEDUP-CAPAS: conteos de las puertas nuevas AL FINAL de la línea
 *    (postocr/copia — siempre impresos, formato estable) y `matches` con
 *    semántica e66 ESTABLE (las puertas nuevas NO cuentan como matches).
 *  · Guard de contrato (source-inspection): TODO escritor de YA-ENVIADA
 *    estampa un dedup que empieza con "ya-enviada" — el gap del lote 10
 *    (YA-ENVIADA ∧ dedup:"sin-match") ya no puede nacer.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { renderTxt, resumenDedup, type FilaInforme } from "./informe";

/** Fixture mínimo de FilaInforme (mismo patrón de informe.percentiles.test.ts). */
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

const ENTORNO = {
  userAgent: "vitest-wave3",
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

describe("WAVE3 C.1 — Outliers procesoMs >6s excluye el reuso (heredados e72)", () => {
  it("fila heredada (dupOf) con procesoMs 50s NO cuenta; la real 7s SÍ", () => {
    const txt = render([
      fila({
        id: "heredada",
        dupOf: "original",
        tiempos: { procesoMs: 50_000, calidadMs: 1, ocrMs: 1, totalMs: 50_000, esperaMs: 0 },
      }),
      fila({
        id: "real",
        tiempos: { procesoMs: 7_000, calidadMs: 1, ocrMs: 1, totalMs: 7_000, esperaMs: 0 },
      }),
    ]);
    // La etiqueta queda SIN CAMBIOS (D51 — parsers por prefijo intactos) y
    // el conteo EXCLUYE el mismo conjunto de «Reuso excluido de percentiles».
    expect(txt).toContain("Outliers procesoMs >6s: 1");
    expect(txt).toContain("Reuso excluido de percentiles");
  });
  it("sin reuso: el conteo es el de siempre (comportamiento intacto)", () => {
    const txt = render([
      fila({ id: "a", tiempos: { procesoMs: 7_000, calidadMs: 1, ocrMs: 1, totalMs: 7_000, esperaMs: 0 } }),
      fila({ id: "b", tiempos: { procesoMs: 6_500, calidadMs: 1, ocrMs: 1, totalMs: 6_500, esperaMs: 0 } }),
      fila({ id: "c", tiempos: { procesoMs: 1_000, calidadMs: 1, ocrMs: 1, totalMs: 1_000, esperaMs: 0 } }),
    ]);
    expect(txt).toContain("Outliers procesoMs >6s: 2");
  });
});

describe("WAVE3 C.3 — fila ERROR siempre visible al final de su línea ACTAS", () => {
  it("con motivo → chunk final entre comillas (aditivo — el chunk histórico de la mitad queda intacto)", () => {
    const txt = render([
      fila({ id: "e1", estado: "ERROR", error: "decode falló", nombre: "20261021_160922.jpg" }),
    ]);
    const lineaActa = txt.split("\n").find((l) => l.includes("20261021_160922.jpg"));
    expect(lineaActa).toBeDefined();
    expect(lineaActa).toContain('error "decode falló"');
    // AL FINAL de la línea (después del chunk error histórico):
    expect(lineaActa?.trim().endsWith('error "decode falló"')).toBe(true);
    expect(lineaActa).toContain("error decode falló"); // chunk histórico intacto
  });
  it("sin motivo (registro pre-wave3) → la AUSENCIA es visible, jamás inventada", () => {
    const txt = render([
      fila({ id: "e2", estado: "ERROR", error: null, nombre: "sin-motivo.jpg" }),
    ]);
    const lineaActa = txt.split("\n").find((l) => l.includes("sin-motivo.jpg"));
    expect(lineaActa).toContain("error (sin motivo — registro pre-wave3)");
  });
  it("fila LISTA sin error → NINGÚN chunk nuevo (solo ERROR trae el guard)", () => {
    const txt = render([fila({ id: "l1", estado: "LISTA", error: null, nombre: "lista.jpg" })]);
    const lineaActa = txt.split("\n").find((l) => l.includes("lista.jpg"));
    expect(lineaActa).toBeDefined();
    expect(lineaActa).not.toContain("error");
  });
});

describe("WAVE3 C.4 — qrCortoInforme 24 chars (evidencia real informe 104609)", () => {
  // Payloads REALES del par LcyzMYaR (informe 104609 — dos actas DISTINTAS
  // que el corte 8 presentaba con el MISMO prefijo; divergen en el char 22):
  const PAR1_A = "LcyzMYaRFQAksxU26WzUEejExnmqsUdSw28kMibV+Bk=";
  const PAR1_B = "LcyzMYaRFQAksxU26WzUETABJVEby2H4qP3QHKmjxwo=";
  // Par PdZiNVrw (mismo informe — divergen ~char 18; fragmentos reales del
  // kit + relleno opaco a 44 chars, igual que la forma base64 32 bytes):
  const PAR2_A = "PdZiNVrwAAAsqEjhTXVrf+8d5AAAAAAAAAAAAAAAAAAA";
  const PAR2_B = "PdZiNVrwAAAsqEjhTXsTYy2zgYAAAAAAAAAAAAAAAAAA";

  it("los 4 payloads → 4 prefijos DISTINTOS con 24 (el corte 8 colisionaba)", () => {
    expect(PAR1_A.slice(0, 8)).toBe(PAR1_B.slice(0, 8)); // evidencia del gap
    const txt = render([
      fila({ id: "1", qrPayload: PAR1_A }),
      fila({ id: "2", qrPayload: PAR1_B }),
      fila({ id: "3", qrPayload: PAR2_A }),
      fila({ id: "4", qrPayload: PAR2_B }),
    ]);
    const prefijos = [
      PAR1_A.slice(0, 24) + "…",
      PAR1_B.slice(0, 24) + "…",
      PAR2_A.slice(0, 24) + "…",
      PAR2_B.slice(0, 24) + "…",
    ];
    expect(new Set(prefijos).size).toBe(4);
    for (const p of prefijos) expect(txt).toContain(`dedupQr ${p}`);
  });
  it("la decisión sigue en la igualdad EXACTA (el prefijo es SOLO cosmético)", () => {
    // Par1: 16 chars AÚN colisionaban (gap del corte antiguo); 24 distingue.
    expect(PAR1_A.slice(0, 16)).toBe(PAR1_B.slice(0, 16));
    expect(PAR1_A.slice(0, 24)).not.toBe(PAR1_B.slice(0, 24));
    expect(PAR2_A.slice(0, 24)).not.toBe(PAR2_B.slice(0, 24));
  });
});

describe("WAVE3 C.2 — DEDUP-CAPAS con las puertas nuevas + matches estable", () => {
  it("conteos postocr/copia AL FINAL de la línea; capa3-ya-enviada intacto", () => {
    const txt = render([
      fila({ id: "a", dedup: "ya-enviada" }),
      fila({ id: "b", dedup: "ya-enviada-postocr" }),
      fila({ id: "c", dedup: "ya-enviada-postocr" }),
      fila({ id: "d", dedup: "ya-enviada-copia" }),
    ]);
    expect(txt).toContain(
      "DEDUP-CAPAS: capa0-qr 0 - capa1-dhash-marcada 0 - capa2-identidad 0 - capa3-ya-enviada 1 - capa3-ya-enviada-postocr 2 - capa3-ya-enviada-copia 1",
    );
  });
  it("matches con semántica e66 ESTABLE: las puertas nuevas NO cuentan", () => {
    const r = resumenDedup([
      fila({ dedup: "ya-enviada" }),
      fila({ dedup: "ya-enviada-postocr" }),
      fila({ dedup: "ya-enviada-copia" }),
      fila({ dedup: "v2", dedupDistancia: 2 }),
    ]);
    expect(r.matches).toBe(2); // ya-enviada + v2 (las puertas nuevas NO suman)
    expect(r.yaEnviada).toBe(1);
    expect(r.yaEnviadaPostocr).toBe(1);
    expect(r.yaEnviadaCopia).toBe(1);
  });
});

describe("WAVE3 C.2 — guard de contrato (source-inspection): TODO escritor de YA-ENVIADA estampa ya-enviada*", () => {
  it("marcarYaEnviada conserva el literal por defecto + la puerta sobreescribe; cadenaDedup jamás estampa la traza sobre el veto", () => {
    const store = readFileSync(new URL("./masiva/store.ts", import.meta.url), "utf8");
    // El write del veto conserva su literal (ancla QA qa-historico byte a byte):
    expect(store).toContain(
      'estado: "YA-ENVIADA",\n      hashBytes: hashBytes ?? registro.hashBytes,\n      enviadaDe: enviadaDeId,\n      dedup: "ya-enviada",',
    );
    // La puerta nueva viaja como spread condicional DESPUÉS del literal:
    expect(store).toContain('...(dedupValor && dedupValor !== "ya-enviada" ? { dedup: dedupValor } : {}),');
    // La traza visual de cadenaDedup JAMÁS destruye el veto (gap lote 10):
    expect(store).toContain(
      'registro.estado === "YA-ENVIADA"\n          ? { ...writeHashYTraza, dedup: "ya-enviada-copia" as const }\n          : writeHashYTraza,',
    );
    // El write anclado de qa-dedup-enviadas sigue PRESENTE byte a byte:
    expect(store).toContain(
      "{ ...registro, hashDedup: hash, hashBytes: bytes ?? registro.hashBytes, ...trazaDedup }",
    );
    const runner = readFileSync(new URL("./masiva/runner.ts", import.meta.url), "utf8");
    // H1 declara su puerta (post-OCR — D57 AL FINAL):
    expect(runner).toContain('"ya-enviada-postocr",');
    // …y el runner JAMÁS escribe el literal YA-ENVIADA (ancla qa-dedup-enviadas):
    expect(runner).not.toContain('"YA-ENVIADA"');
  });
});
