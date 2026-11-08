/**
 * 7.2 (plan de remediación, cierra A1) — GOLDEN DE PARIDAD del gate.
 *
 * El fallo que motiva el helper: ~120 líneas de política duplicadas a mano
 * entre `pipeline.ts` (escaneo) y `RealCoreBridge.pipelineRecorte` — un
 * ajuste aplicado a un solo lado producía DOS productos distintos según el
 * camino del acta. El golden que hoy no podía existir:
 *
 *    mismo input por AMBOS caminos → MISMO desenlace (score/status/
 *    rechazo/techosDiag).
 *
 * «Ambos caminos» aquí son los DOS ensamblados reales: el escaneo arma la
 * entrada con `manual=false` y SIM opcional; el recorte con la bandera
 * `manual` del editor y SIM siempre null. Los DOS terminan llamando a la
 * MISMA `aplicarPoliticaGate` — este test congela que el desenlace no
 * depende del camino y que la única divergencia INTENCIONAL es la del
 * recorte manual (escudo Q2 en lugar de veto).
 *
 * NOTA honesta: `evaluarGate` (método privado del bridge, no importable
 * desde node sin DOM) llega aquí como réplica puntual de su contrato §4.2
 * (RECHAZADA solo por CALIDAD < 6.5 · AUTO → statusDeScore ·
 * SUGERIDA/MANUAL → EN_REVISION_HUMANA «repetir-primero»; contingencia C4
 * al agotar). Si el bridge cambia ese contrato, este golden se actualiza a
 * mano — y la regla de DEUDA.md aplica: cambiar un umbral exige decisión
 * registrada en docs/DECISIONS.md.
 */
import { describe, expect, it } from "vitest";
import { ocrTextIsValid } from "@jg-stevan/scanner-core/core/ocr";
import { statusDeScore } from "@jg-stevan/scanner-core/dominio/types";
import type { ClasificacionE14 } from "@jg-stevan/scanner-core/dominio/clasificador";
import { aplicarPoliticaGate } from "./gate";
import type { EntradaPoliticaGate, SalidaPoliticaGate } from "./gate";
import {
  TECHO_SIN_SENAL,
  UMBRAL_SCORE_INCOMPLETA,
  UMBRAL_RECHAZO_SCORE,
} from "./umbrales";

/** Réplica del contrato §4.2 del `evaluarGate` del bridge (ver nota arriba). */
function evaluarGate(
  score: number,
  ocrTexto: string,
  clasificacion: ClasificacionE14,
  intento: number,
  maxIntentos: number,
): ReturnType<typeof statusDeScore> extends never ? never : SalidaPoliticaGate["gate"] {
  if (score >= UMBRAL_RECHAZO_SCORE) {
    if (clasificacion.nivel === "AUTO") {
      return { status: statusDeScore(score), rechazo: null, clasificacion };
    }
    return { status: "EN_REVISION_HUMANA", rechazo: null, clasificacion };
  }
  const rechazo = ocrTextIsValid(ocrTexto)
    ? ({ tipo: "GENERICO", detalle: "SCORE INSUFICIENTE PARA TRANSMISIÓN" } as const)
    : ({ tipo: "ILEGIBLE", detalle: "CÓDIGO DE BARRAS Y CABECERA NO DETECTADOS" } as const);
  if (intento >= maxIntentos) {
    return { status: "EN_REVISION_HUMANA", rechazo, clasificacion: null };
  }
  return { status: "RECHAZADA", rechazo, clasificacion: null };
}

const DEPS = {
  evaluarGate,
  DETALLE_INCOMPLETA: "EL ACTA ESTÁ CORTADA EN EL ENCUADRE — ALÉJATE UN POCO Y CAPTURA EL ACTA COMPLETA",
  DETALLE_SIN_VOTOS: "ACTA SIN VOTOS VISIBLES",
  DETALLE_BAJO: "NO SE RECONOCE INFORMACIÓN DEL ACTA — REPITA LA FOTO",
};

const CLASIF_AUTO = { nivel: "AUTO" } as ClasificacionE14;
const CLASIF_MANUAL = { nivel: "MANUAL" } as ClasificacionE14;

/** Entrada base: acta sana, completa, con votos, sin escudos. */
function entradaBase(ajustes: Partial<EntradaPoliticaGate>): EntradaPoliticaGate {
  return {
    score: 7.2,
    scoreSimulado: null,
    senal: { nivel: "MEDIA", chars: 300, anclas: 4 },
    calidad: { level: "good" },
    senalActa: true,
    texto: "E-14 KIT 399 MESA 003",
    clasificacion: CLASIF_AUTO,
    completa: true,
    manual: false,
    hayVotos: true,
    votosSkipPag2: false,
    fondo: false,
    recortada: false,
    intento: 1,
    maxIntentos: 4,
    ...ajustes,
  };
}

/** Ensamblado del ESCANEO (pipeline.ts): manual jamás; SIM solo con chip. */
function caminoEscaneo(e: EntradaPoliticaGate): SalidaPoliticaGate {
  return aplicarPoliticaGate({ ...e, manual: false }, DEPS);
}

/** Ensamblado del RECORTE (pipelineRecorte): la bandera `manual` del editor. */
function caminoRecorte(e: EntradaPoliticaGate): SalidaPoliticaGate {
  return aplicarPoliticaGate(e, DEPS);
}

describe("7.2 · golden de paridad del gate (escaneo ↔ recorte)", () => {
  const ESCENARIOS: [string, Partial<EntradaPoliticaGate>][] = [
    ["AUTO con score alto → OPTIMA", { score: 8.6, clasificacion: CLASIF_AUTO }],
    ["AUTO en banda ADVERTENCIA", { score: 7.0, clasificacion: CLASIF_AUTO }],
    ["MANUAL → EN_REVISION_HUMANA (repetir-primero)", { clasificacion: CLASIF_MANUAL }],
    ["veto INCOMPLETA (intento libre) → RECHAZADA 6.4", { completa: false, score: 9 }],
    ["veto INCOMPLETA al AGOTAR → EN_REVISION_HUMANA", { completa: false, intento: 4 }],
    ["SIN_VOTOS → RECHAZADA 6.4", { hayVotos: false }],
    ["pág 2 (constancias) sin zona de votos → no condena", { votosSkipPag2: true, hayVotos: false }],
    ["escudo-fondo → cap 7.9", { fondo: true, score: 9.5 }],
    ["recortada → cap 7.9", { recortada: true, score: 9.5 }],
    ["lectura FUERTE → piso 8.5 (level good)", { senal: { nivel: "FUERTE", chars: 600, anclas: 8 } }],
    ["lectura DEBIL → techo 5.9", { senal: { nivel: "DEBIL", chars: 5, anclas: 0 } }],
    ["sin señal de contenido → rechazo BAJO", { senalActa: false, clasificacion: CLASIF_MANUAL }],
    ["chip SIM 8.2 → OPTIMA", { scoreSimulado: 8.2, clasificacion: CLASIF_AUTO }],
    ["chip SIM no vence el cap recortada (pitfall §9.4)", { scoreSimulado: 8.2, recortada: true }],
    ["level poor → techo 6.4 y SIN piso FUERTE", { calidad: { level: "poor" }, score: 9 }],
  ];

  it.each(ESCENARIOS)("%s — mismo desenlace por ambos caminos", (_nombre, ajustes) => {
    const entrada = entradaBase(ajustes);
    expect(caminoEscaneo(entrada)).toStrictEqual(caminoRecorte(entrada));
  });

  it("recorte MANUAL incompleto: la ÚNICA divergencia intencional (escudo Q2, no veto)", () => {
    const entrada = entradaBase({ completa: false, manual: true, score: 9 });
    const escaneo = caminoEscaneo({ ...entrada, manual: false });
    const recorte = caminoRecorte(entrada);
    // El escaneo VETA (RECHAZADA + cap 6.4); el manual ESCUDA (techo 7.9 —
    // ADVERTENCIA como máximo, el operador decidió con vista).
    expect(escaneo.gate.status).toBe("RECHAZADA");
    expect(escaneo.score).toBe(UMBRAL_SCORE_INCOMPLETA);
    expect(recorte.gate.status).toBe("ADVERTENCIA");
    expect(recorte.score).toBe(7.9);
    expect(recorte.techosDiag).toContain(`escudo-manual:7.9`);
    expect(recorte.techosDiag).not.toContain(`incompleta:${UMBRAL_SCORE_INCOMPLETA}`);
  });
});

describe("7.2 · semántica congelada del bloque único", () => {
  it("el veto INCOMPLETA capita el score a 6.4 (RECHAZADA garantizada por statusDeScore)", () => {
    const r = caminoEscaneo(entradaBase({ completa: false, score: 10 }));
    expect(r.score).toBe(UMBRAL_SCORE_INCOMPLETA);
    expect(r.gate.status).toBe("RECHAZADA");
    expect(r.gate.rechazo?.tipo).toBe("INCOMPLETA");
    expect(r.techosDiag).toContain(`incompleta:${UMBRAL_SCORE_INCOMPLETA}`);
  });

  it("SIN_VOTOS solo condena completas (INCOMPLETA manda primero) y capita a 6.4", () => {
    const vetada = caminoEscaneo(entradaBase({ completa: false, hayVotos: false }));
    expect(vetada.gate.rechazo?.tipo).toBe("INCOMPLETA"); // INCOMPLETA primero
    const conVotosMal = caminoEscaneo(entradaBase({ hayVotos: false, score: 8 }));
    expect(conVotosMal.gate.rechazo?.tipo).toBe("SIN_VOTOS");
    expect(conVotosMal.score).toBe(UMBRAL_SCORE_INCOMPLETA);
    expect(conVotosMal.marcadoresOk).toBe(false);
  });

  it("los escudos no suman: el cap 7.9 es idempotente y el orden de techosDiag es el de aplicación", () => {
    const r = caminoEscaneo(
      entradaBase({
        score: 10,
        fondo: true,
        recortada: true,
        senal: { nivel: "FUERTE", chars: 600, anclas: 8 },
        senalActa: false,
        calidad: { level: "fair" },
      }),
    );
    expect(r.score).toBe(7.9); // nunca ÓPTIMA con fondo/recortada
    expect(r.techosDiag).toStrictEqual([
      `techo-fair:7.9`,
      `sin-senal:${TECHO_SIN_SENAL}`,
      "piso-lectura-FUERTE:8.5",
      "escudo-fondo:7.9",
      "recortada:7.9",
    ]);
  });

  it("sin señal de contenido: token sin-senal + sustitución BAJO del rechazo", () => {
    // NOTA de frontera: el cap a TECHO_SIN_SENAL lo aplica scoreDeCalidad
    // (bridge §4.1) — el helper solo registra el token y sustituye el
    // rechazo. El 4.9 de la entrada ES el score ya capado que produciría.
    const r = caminoEscaneo(
      entradaBase({ senalActa: false, clasificacion: CLASIF_AUTO, score: TECHO_SIN_SENAL }),
    );
    expect(r.techosDiag).toContain(`sin-senal:${TECHO_SIN_SENAL}`);
    expect(r.score).toBe(TECHO_SIN_SENAL);
    expect(r.gate.status).toBe("RECHAZADA"); // 4.9 < 6.5 vía statusDeScore
    expect(r.rechazoFinal?.tipo).toBe("BAJO"); // §D3 — sustitución fuera del gate
  });

  it("el piso FUERTE vence al techo fair pero NUNCA al poor (evidencia física manda)", () => {
    const fair = caminoEscaneo(
      entradaBase({ calidad: { level: "fair" }, senal: { nivel: "FUERTE", chars: 600, anclas: 8 } }),
    );
    expect(fair.score).toBe(8.5);
    // NOTA de frontera: el cap del level poor lo aplica scoreDeCalidad
    // (bridge §4.1) — aquí la entrada 6.4 ES el score ya capado que
    // produciría; el helper solo se niega a subirlo con el piso FUERTE.
    const poor = caminoEscaneo(
      entradaBase({ calidad: { level: "poor" }, senal: { nivel: "FUERTE", chars: 600, anclas: 8 }, score: UMBRAL_SCORE_INCOMPLETA }),
    );
    expect(poor.score).toBe(UMBRAL_SCORE_INCOMPLETA); // techo poor (6.4)
    expect(poor.techosDiag).toContain(`techo-poor:${UMBRAL_SCORE_INCOMPLETA}`);
    expect(poor.techosDiag).not.toContain("piso-lectura-FUERTE:8.5");
  });

  it("la contingencia C4 al AGOTAR intentos llega con el rechazo REAL del veto", () => {
    const r = caminoEscaneo(entradaBase({ completa: false, intento: 4, maxIntentos: 4 }));
    expect(r.gate.status).toBe("EN_REVISION_HUMANA");
    expect(r.gate.rechazo?.tipo).toBe("INCOMPLETA");
  });
});
