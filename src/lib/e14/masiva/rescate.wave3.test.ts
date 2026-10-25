/**
 * Tests — WAVE3 §B (ORDEN-WAVE3-remoto-rescate-obs-v1, feat/rescate-
 * rechazo-v1): rescate anti-FALSO-RECHAZO transitorio.
 *  · Predicado PURO (kit §B.1 literal): SOLO RECHAZADA-BAJO, SOLO intento 1,
 *    SOLO con cupo de corrida, NUNCA con forzarDedupOff (RL-e65b-6);
 *    ADVERTENCIA / otros tipos de rechazo / OPTIMA → false; jamás calidad.
 *  · Source-inspection: el rescate vive DENTRO del bucle de intentos y
 *    ANTES del write del desenlace (patrón qa-dedup-enviadas); relectura.ts,
 *    tope.ts y cola.ts INTOCABLES (red line del kit).
 *  · Informe: línea `Rescates rechazo: N usados / M salvaron` presente,
 *    aditiva AL FINAL de TOTALES; filaLiviana pasa la traza del registro
 *    (null si no la trae — jamás inventar).
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  MAX_RESCATES_CORRIDA,
  procedeRescateRechazo,
} from "./rescate";
import { filaLiviana, renderTxt, type FilaInforme } from "../informe";
import type { RegistroMasiva } from "./tipos";
import type { Acta } from "../types";

/** Desenlace RECHAZADA-BAJO (el del lote 7 real — score 4.9). */
function rechazadaBajo(): Pick<Acta, "status" | "rechazo"> {
  return { status: "RECHAZADA", rechazo: { tipo: "BAJO", detalle: "NO SE RECONOCE INFORMACIÓN" } };
}
const rechazadaCalidad: Pick<Acta, "status" | "rechazo"> = {
  status: "RECHAZADA",
  rechazo: { tipo: "INCOMPLETA", detalle: "gate incompleta" },
};
const optima: Pick<Acta, "status" | "rechazo"> = { status: "OPTIMA", rechazo: null };

describe("WAVE3 §B.1 — predicado PURO procedeRescateRechazo", () => {
  it("BAJO + intento 1 + cupos → true (el caso del lote 7)", () => {
    expect(
      procedeRescateRechazo(rechazadaBajo(), { intento: 1, rescatesCorrida: 0 }),
    ).toBe(true);
    expect(
      procedeRescateRechazo(rechazadaBajo(), { intento: 1, rescatesCorrida: MAX_RESCATES_CORRIDA - 1 }),
    ).toBe(true);
  });
  it("intento 2 → false (máx 1 rescate por fila — el predicado exige intento 1)", () => {
    expect(
      procedeRescateRechazo(rechazadaBajo(), { intento: 2, rescatesCorrida: 0 }),
    ).toBe(false);
  });
  it("cupos agotados (rescatesCorrida ≥ MAX_RESCATES_CORRIDA=3) → false (techo del costo)", () => {
    expect(MAX_RESCATES_CORRIDA).toBe(3);
    expect(
      procedeRescateRechazo(rechazadaBajo(), { intento: 1, rescatesCorrida: MAX_RESCATES_CORRIDA }),
    ).toBe(false);
  });
  it("ADVERTENCIA / otros rechazos / OPTIMA / calidad → false (jamás se rescata otra cosa)", () => {
    expect(
      procedeRescateRechazo({ status: "ADVERTENCIA", rechazo: null }, { intento: 1, rescatesCorrida: 0 }),
    ).toBe(false);
    expect(
      procedeRescateRechazo(rechazadaCalidad, { intento: 1, rescatesCorrida: 0 }),
    ).toBe(false); // rechazo de calidad — ahí re-tomar la foto SÍ ayuda
    expect(
      procedeRescateRechazo(optima, { intento: 1, rescatesCorrida: 0 }),
    ).toBe(false);
  });
  it("forzarDedupOff → false (RL-e65b-6 — el escape del dueño manda SIEMPRE)", () => {
    expect(
      procedeRescateRechazo(rechazadaBajo(), { intento: 1, rescatesCorrida: 0, forzarDedupOff: true }),
    ).toBe(false);
  });
});

describe("WAVE3 §B.2 — guard de contrato (source-inspection del bucle)", () => {
  it("el rescate vive DENTRO del bucle de intentos y ANTES del write del desenlace; techo por corrida; módulos sagrados intactos", () => {
    const src = readFileSync(new URL("./runner.ts", import.meta.url), "utf8");
    const iBucle = src.indexOf("for (let intento = 1; intento <= WATCHDOG_INTENTOS; intento += 1) {");
    const iRescate = src.indexOf("procedeRescateRechazo(resultado.acta, {");
    // el write del desenlace DEL PIPELINE (el 1.º es el clon de
    // reutilizarResultado — el que manda para el orden es el posterior):
    const iWriteDesenlace = src.indexOf("const registroListo: RegistroMasiva = {", iRescate);
    expect(iBucle).toBeGreaterThan(-1);
    expect(iRescate).toBeGreaterThan(iBucle); // DENTRO del bucle de intentos
    expect(iWriteDesenlace).toBeGreaterThan(iRescate); // ANTES del write del desenlace
    // la 2ª pasada reutiliza la maquinaria EXISTENTE (workers frescos + continue):
    expect(src).toContain("[e14] rescate-rechazo fila=");
    expect(src).toContain("[e14] rescate-rechazo OK fila=");
    expect(src).toContain("await matarYRecrearWorkers(); // workers frescos (misma infra T1.2)");
    expect(src).toContain("continue; // 2ª pasada del MISMO paso desenlace — el bucle re-ejecuta");
    // techo por CORRIDA (contador del runner, reiniciado en iniciarRunner):
    expect(src).toContain("let rescatesCorrida = 0;");
    expect(src).toContain("rescatesCorrida = 0; // WAVE3 §B — techo del rescate por CORRIDA");
    // traza persistente (D57 AL FINAL — ausente = sin rescate):
    expect(src).toContain('...(rescateLanzado\n        ? {\n            rescateRechazo:');
    // módulos sagrados INTOCABLES (red line del kit §B/F):
    const relectura = readFileSync(new URL("./relectura.ts", import.meta.url), "utf8");
    expect(relectura).not.toContain("rescate");
    const tope = readFileSync(new URL("./tope.ts", import.meta.url), "utf8");
    expect(tope).not.toContain("rescate");
    const cola = readFileSync(new URL("./cola.ts", import.meta.url), "utf8");
    expect(cola).not.toContain("rescate");
  });
});

describe("WAVE3 §B — informe: línea `Rescates rechazo: N usados / M salvaron`", () => {
  const ENTORNO = {
    userAgent: "vitest-wave3-b",
    idioma: "es-CO",
    nucleos: 4,
    memoriaGB: 8,
    crossOriginIsolated: false,
    url: "https://vitest.local/",
  };
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
  function render(filas: FilaInforme[]): string {
    return renderTxt(
      "2026-10-24T13:00:00.000Z",
      ENTORNO,
      filas,
      { LISTA: filas.length },
      { OPTIMA: filas.length },
      { procesoMs: null, calidadMs: null, ocrMs: null, totalMs: null, esperaMs: null, decodeMs: null, detectMs: null, persistMs: null, envioMs: null },
      false,
      [],
    );
  }

  it("usados = lanzados; salvaron = desenlace final ≠ RECHAZADA tras rescate (formato exacto del kit)", () => {
    const txt = render([
      fila({ id: "a", rescateRechazo: "salvado" }),
      fila({ id: "b", rescateRechazo: "lanzado" }),
      fila({ id: "c", rescateRechazo: null }),
    ]);
    expect(txt).toContain("Rescates rechazo: 2 usados / 1 salvaron");
  });
  it("sin rescates → 0 usados / 0 salvaron (honesto — el instrumento silencioso es un dato)", () => {
    expect(render([fila({})])).toContain("Rescates rechazo: 0 usados / 0 salvaron");
  });
  it("filaLiviana pasa la traza del REGISTRO tal cual (null si no la trae — jamás inventar)", () => {
    const conTraza = filaLiviana({ id: "r1", nombre: "r1.jpg", agregadaEn: 1, estado: "LISTA", rescateRechazo: "salvado" } as RegistroMasiva);
    expect(conTraza.rescateRechazo).toBe("salvado");
    const sinTraza = filaLiviana({ id: "r2", nombre: "r2.jpg", agregadaEn: 1, estado: "LISTA" } as RegistroMasiva);
    expect(sinTraza.rescateRechazo).toBeNull(); // pre-wave3 — la AUSENCIA es honesta
  });
});
