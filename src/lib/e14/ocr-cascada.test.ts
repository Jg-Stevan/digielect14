/**
 * Tests unitarios — KIT e14-ocr-cascada-v1 (K3 fase 2 — plan flujo-dueño
 * paso 6). Patrón: runner-watchdog.test.ts (entorno node + mocks) + el
 * patrón PURO de ocr-escalonado (la cascada recibe TODAS sus dependencias
 * inyectadas — la producción (bridge) solo las arma).
 *
 * Cubre el contrato del brief K3 fase 2:
 *  · cascada con mocks — AUTO directo (ahorra el re-OCR), core como hoy
 *    (1280→1920), rescate ROI (gana y pierde).
 *  · guard — cascadaActiva: flag OFF / SIM ⇒ false (byte-idéntico).
 *  · elegirMejor JAMÁS recibe pasadas de motores distintos: el intento 1
 *    de OTRO motor (futuro Tesseract) solo vale por el GATE.
 *  · presupuesto vencido ⇒ no se abre ninguna etapa nueva.
 *  · gate/ROI a prueba de fallos (jamás tumba — conservador).
 *  · source-scan del bridge/flags (readFileSync — patrón
 *    runner-rechequeo.test.ts): call-site condicional + doble whitelist.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  cascadaActiva,
  correrCascadaOcr,
  pasadaRoiCompuesta,
  ROI_FRACCIONES,
  type DepsOcrCascada,
  type PasadaCascada,
} from "./ocr-cascada";

const raiz = new URL("../../..", import.meta.url).pathname;
const lee = (ruta: string): string => readFileSync(`${raiz}${ruta}`, "utf8");

/** Pasada de prueba — conf/comparables SOLO entre pasadas del mismo motor. */
function pasada(texto: string, conf = 0.9, cap: number | "roi" = 1280): PasadaCascada {
  return { texto, conf, cap, msDet: 10, msRec: 20 };
}

/** Texto con las anclas del brief (cabecera-céntrica + pie). */
const TEXTO_AUTO = [
  "TARJETA ELECTORAL E-14",
  "REGISTRADURIA NACIONAL",
  "PAÍS: 88 CONSULADO: 1",
  "ZONA: 01 PUESTO: 0002",
  "MESA: 001",
  "Ver.: 1 Pag.: 1 de 2",
  "KIT: 399",
  "202610271234567",
].join("\n");
const TEXTO_DEBIL = "MANCHA ILEGIBLE"; // sin anclas, sin mesa, <150 chars → necesitaSegunda true
const TEXTO_ROI_BUENO = "MESA: 001 KIT: 399 SUMA TOTAL"; // rescate que recompone

/** Deps por defecto: intento1 = 1280 débil; core igual; ROI rescata bien. */
function depsBase(
  overrides: Partial<DepsOcrCascada> = {},
): DepsOcrCascada & {
  llamadas: { intento1: number; ocr1280: number; ocr1920: number; ocrRoi: number; recortar: number };
} {
  const llamadas = { intento1: 0, ocr1280: 0, ocr1920: 0, ocrRoi: 0, recortar: 0 };
  return {
    llamadas,
    intento1: async (foto) => {
      llamadas.intento1 += 1;
      return pasada(`${TEXTO_DEBIL}${foto ? "" : ""}`, 0.5, 1280);
    },
    mismoMotorIntento1: true,
    ocr1280: async () => {
      llamadas.ocr1280 += 1;
      return pasada(TEXTO_DEBIL, 0.5, 1280);
    },
    ocr1920: async () => {
      llamadas.ocr1920 += 1;
      return pasada(TEXTO_DEBIL, 0.6, 1920);
    },
    ocrRoi: async () => {
      llamadas.ocrRoi += 1;
      return pasada(TEXTO_ROI_BUENO, 0.8, "roi");
    },
    recortarRoi: async () => {
      llamadas.recortar += 1;
      return "data:image/jpeg;base64,roi";
    },
    clasificarNivel: (texto) => (texto.includes("E-14") && texto.includes("MESA") ? "AUTO" : "MANUAL"),
    presupuestoVencido: () => false,
    ...overrides,
  };
}

describe("ocr-cascada · cascadaActiva (guard del call-site)", () => {
  it("flag OFF ⇒ false (el bridge corre el escalonado de siempre byte a byte)", () => {
    expect(cascadaActiva(false, false)).toBe(false);
    expect(cascadaActiva(false, undefined)).toBe(false);
  });
  it("flag ON + no-SIM ⇒ true; SIM NUNCA (chips 8.2/7.0/4.3 intactos)", () => {
    expect(cascadaActiva(true, false)).toBe(true);
    expect(cascadaActiva(true, undefined)).toBe(true);
    expect(cascadaActiva(true, true)).toBe(false);
  });
});

describe("ocr-cascada · ROI_FRACCIONES (contrato del brief K3)", () => {
  it("top 0-25% y bottom 75-100% del warp", () => {
    expect(ROI_FRACCIONES.top).toEqual([0, 0.25]);
    expect(ROI_FRACCIONES.bottom).toEqual([0.75, 1]);
  });
});

describe("ocr-cascada · pasadaRoiCompuesta (solo pasadas útiles)", () => {
  it("sin ROIs útiles → null (no hay rescate)", () => {
    expect(pasadaRoiCompuesta(null, null)).toBe(null);
    expect(pasadaRoiCompuesta(pasada("   ", 0.5, "roi"), pasada("", 0.5, "roi"))).toBe(null);
  });
  it("un solo ROI útil → su texto y su conf, cap roi", () => {
    const c = pasadaRoiCompuesta(pasada("KIT: 399", 0.7, "roi"), null);
    expect(c).not.toBe(null);
    expect(c?.texto).toBe("KIT: 399");
    expect(c?.conf).toBe(0.7);
    expect(c?.cap).toBe("roi");
  });
  it("dos ROIs útiles → textos unidos con \\n y conf = media", () => {
    const c = pasadaRoiCompuesta(pasada("E-14 MESA: 001", 0.6, "roi"), pasada("SUMA TOTAL", 0.8, "roi"));
    expect(c?.texto).toBe("E-14 MESA: 001\nSUMA TOTAL");
    expect(c?.conf).toBeCloseTo(0.7, 10);
  });
  it("un ROI vacío no aporta NI texto NI conf (media solo entre útiles)", () => {
    const c = pasadaRoiCompuesta(pasada("E-14", 0.4, "roi"), pasada("  \n  ", 0.99, "roi"));
    expect(c?.texto).toBe("E-14");
    expect(c?.conf).toBe(0.4);
  });
});

describe("ocr-cascada · correrCascadaOcr (cascada con mocks)", () => {
  it("AUTO directo en el intento 1 ⇒ UNA sola pasada, sin 1920 ni ROI (ahorro del re-OCR)", async () => {
    const d = depsBase();
    d.intento1 = async () => {
      d.llamadas.intento1 += 1; // el override reemplaza el stub contado — se re-cuenta aquí
      return pasada(TEXTO_AUTO, 0.9, 1280);
    };
    const s = await correrCascadaOcr("data:x", d);
    expect(s.paso).toBe("intento1");
    expect(s.elegidoCap).toBe(1280);
    expect(s.rescate).toBe(false);
    expect(s.texto).toContain("MESA: 001");
    expect(d.llamadas.intento1).toBe(1);
    expect(d.llamadas.ocr1280).toBe(0);
    expect(d.llamadas.ocr1920).toBe(0);
    expect(d.llamadas.ocrRoi).toBe(0);
    expect(d.llamadas.recortar).toBe(0);
  });

  it("sin AUTO y lectura débil ⇒ core como hoy (1920) + rescate ROI que GANA (más anclas)", async () => {
    const d = depsBase();
    const s = await correrCascadaOcr("data:x", d);
    expect(d.llamadas.intento1).toBe(1);
    expect(d.llamadas.ocr1280).toBe(0); // mismo motor ⇒ la 1.ª pasada se REUSA
    expect(d.llamadas.ocr1920).toBe(1);
    expect(d.llamadas.recortar).toBe(2); // top + bottom
    expect(d.llamadas.ocrRoi).toBe(2);
    expect(s.rescate).toBe(true);
    expect(s.paso).toBe("roi");
    expect(s.elegidoCap).toBe("roi");
    expect(s.texto).toBe(`${TEXTO_ROI_BUENO}\n${TEXTO_ROI_BUENO}`); // top + bottom unidos
    expect(s.ms1280).toBe(null);
  });

  it("rescate ROI que PIERDE ⇒ el core queda (elegirMejor mismo motor manda)", async () => {
    const d = depsBase({ ocrRoi: async () => pasada("basura", 0.1, "roi") });
    const s = await correrCascadaOcr("data:x", d);
    expect(s.rescate).toBe(true); // el rescate CORRIÓ (intento)
    expect(s.paso).toBe("roi"); // la compuesta entró a elegirMejor
    expect(s.texto).toBe(TEXTO_DEBIL); // pero el core de 1920 ganó (conf 0.6 > 0.1)
  });

  it("ROI fallidos (recorte null + ocrRoi lanza) ⇒ sin rescate, core intacto, JAMÁS tumba", async () => {
    const d = depsBase({
      recortarRoi: async () => null,
      ocrRoi: async () => {
        throw new Error("roi roto");
      },
    });
    const s = await correrCascadaOcr("data:x", d);
    expect(s.rescate).toBe(false);
    expect(s.paso).toBe("1920"); // escalonado completo de siempre
    expect(s.elegidoCap).toBe(1920);
    expect(s.texto).toBe(TEXTO_DEBIL);
  });

  it("futuro GO-B (intento 1 de OTRO motor): su texto JAMÁS entra a elegirMejor", async () => {
    // Tesseract simulado: cap -1 (no-RapidOCR). El gate NO le da AUTO → el
    // core abre su PROPIA 1.ª pasada y TODO lo que entra a elegirMejor es
    // RapidOCR (1280/1920/roi) — jamás el cap -1.
    let vioCapMenos1 = false;
    const elegirEspia = async (deps: DepsOcrCascada, foto: string) => {
      const s = await correrCascadaOcr(foto, deps);
      if (s.elegidoCap === -1) vioCapMenos1 = true;
      return s;
    };
    const d = depsBase({
      intento1: async () => pasada("TESSERACT DEBIL", 0.95, -1),
      mismoMotorIntento1: false,
    });
    const s = await elegirEspia(d, "data:x");
    expect(vioCapMenos1).toBe(false);
    expect(d.llamadas.ocr1280).toBe(1); // core abre su 1.ª pasada propia
    expect(s.elegidoCap).not.toBe(-1);
    expect(s.ms1280).not.toBe(null);
  });

  it("futuro GO-B: Tesseract con gate AUTO ⇒ listo SIN core (el gate decide entre motores)", async () => {
    const d = depsBase({
      intento1: async () => pasada(`${TEXTO_AUTO} (tess)`, 0.7, -1),
      mismoMotorIntento1: false,
    });
    const s = await correrCascadaOcr("data:x", d);
    expect(s.paso).toBe("intento1");
    expect(s.elegidoCap).toBe(-1); // el texto del intento 1 viaja POR EL GATE
    expect(d.llamadas.ocr1280).toBe(0);
    expect(d.llamadas.ocr1920).toBe(0);
    expect(d.llamadas.ocrRoi).toBe(0);
  });

  it("presupuesto vencido ⇒ ni 1920 ni ROI (el timeout EXISTENTE manda — §3)", async () => {
    const d = depsBase({ presupuestoVencido: () => true });
    const s = await correrCascadaOcr("data:x", d);
    expect(d.llamadas.ocr1920).toBe(0);
    expect(d.llamadas.recortar).toBe(0);
    expect(s.paso).toBe("1280"); // la 1.ª pasada (reusada) es lo que hay
    expect(s.rescate).toBe(false);
  });

  it("gate que LANZA ⇒ tratado MANUAL (conservador — sigue como hoy)", async () => {
    const d = depsBase({
      clasificarNivel: () => {
        throw new Error("divipol caída");
      },
    });
    const s = await correrCascadaOcr("data:x", d);
    expect(s.paso).toBe("roi"); // la cascada siguió completa sin morir
    expect(s.texto).toBe(`${TEXTO_ROI_BUENO}\n${TEXTO_ROI_BUENO}`);
  });

  it("lectura FUERTE pero sin AUTO ⇒ SIN rescate (el ROI no arregla clasificación)", async () => {
    // TEXTO_AUTO-like pero el gate lo niega: necesitaSegunda=false (FUERTE)
    // ⇒ el rescate no corre (falla la ruta, no la lectura).
    const d = depsBase({
      clasificarNivel: () => "MANUAL",
      intento1: async () => pasada(TEXTO_AUTO, 0.9, 1280),
    });
    const s = await correrCascadaOcr("data:x", d);
    expect(d.llamadas.ocr1920).toBe(0); // necesitaSegunda false (FUERTE)
    expect(d.llamadas.recortar).toBe(0); // sin rescate
    expect(s.rescate).toBe(false);
    expect(s.paso).toBe("1280");
  });
});

describe("ocr-cascada · source-scan (contrato del kit en src/)", () => {
  it("bridge: call-site condicional con cascadaActiva + escalonado intacto", () => {
    const bridge = lee("src/lib/e14/scanner-core-bridge.ts");
    expect(bridge).toContain("cascadaActiva(leerFlags().masivaOcrTesseract");
    expect(bridge).toContain("reconocerRapidOcrCascada(fotoOcr, onProgresoOcr, cfgOcr)");
    expect(bridge).toContain("reconocerRapidOcrEscalonado(fotoOcr, onProgresoOcr, cfgOcr)");
    expect(bridge).toContain("OCR_CASCADA_TESSERACT_GO = false");
    expect(bridge).toContain("recortarRoiDataUrl");
  });
  it("flags: default OFF + DOBLE whitelist (sanearFlags + leerOverridesFlags)", () => {
    const flags = lee("src/lib/e14/flags.ts");
    expect(flags).toContain("masivaOcrTesseract: false,");
    expect(flags).toContain('limpio.masivaOcrTesseract = p.masivaOcrTesseract;');
    const politica = lee("src/lib/e14/obs/politica.ts");
    expect(politica).toContain('limpio.masivaOcrTesseract = o.masivaOcrTesseract;');
  });
  it("obs/tipos.ts: FlagsApp + masivaOcrTesseract (D57 — al final, tras dhashResize)", () => {
    const tipos = lee("src/lib/e14/obs/tipos.ts");
    const dhash = tipos.indexOf("dhashResize: boolean;");
    const cascada = tipos.indexOf("masivaOcrTesseract: boolean;");
    expect(dhash).toBeGreaterThan(-1);
    expect(cascada).toBeGreaterThan(dhash); // ADITIVO AL FINAL (contrato D57)
    expect(tipos.slice(cascada)).toContain("}"); // es el último campo de FlagsApp
  });
});
