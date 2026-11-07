/**
 * 7.10 (plan de remediación, T2) — test de componente: el COPY de REVISIÓN
 * por estado (AUTO/ÓPTIMA · ADVERTENCIA · RECHAZADA).
 *
 * ESTADO: ARTEFACTO LISTO, INACTIVO por DOS bloqueos de configuración que
 * están FUERA de esta zona (documentados en docs/PENDIENTES-INTEGRACION.md):
 *  1. vitest.config.ts (zona de otro agente de la ola) no define el alias
 *     `@/*` de tsconfig — `ReviewView` importa "@/lib/e14/store" y sin el
 *     alias el módulo no resuelve (`Cannot find package '@/...'`).
 *  2. `@testing-library/react` + `jsdom` están declarados en devDependencies
 *     pero SIN instalar en node_modules del entorno actual.
 * Para activarlo: añade `alias: { "@": "/src" }` a vitest.config.ts,
 * `bun install`, cambia `describe.skip` por `describe` y (opcional) migra
 * renderToStaticMarkup → render de Testing Library para interacciones.
 *
 * Enfoque: `renderToStaticMarkup` (react-dom/server, YA en dependencies) —
 * el copy es render puro del estado; los efectos no corren en SSR y no
 * hacen falta. `ReviewView` NO recibe props — lee el acta del store — así
 * que se mockea el hook de selectores con tres actas fixture SINTÉTICAS.
 * QuadEditor/ZoomableVisor/PanelClasificacion/pdf-export se MOCKEAN:
 * arrastran DOM/jspdf/divipol y no aportan al copy bajo prueba.
 */
import { createElement } from "react";
import { describe, it, vi } from "vitest";
import type { Acta } from "@jg-stevan/scanner-core/dominio/types";
import type { Quad } from "@jg-stevan/scanner-core/core/types";

// ── Mocks de módulos pesados (han de declararse antes del import dinámico) ──

type EstadoStore = Record<string, unknown>;
let estadoStore: EstadoStore = {};
vi.mock("@/lib/e14/store", () => ({
  // El store es un hook de SELECTORES: `useE14Store((s) => s.campo)`.
  useE14Store: (selector: (s: EstadoStore) => unknown) => selector(estadoStore),
}));
vi.mock("@/lib/e14/core/pdf-export", () => ({ downloadBlob: vi.fn() }));
vi.mock("@/components/e14/QuadEditor", () => ({
  QuadEditor: () => createElement("div", { "data-testid": "quad-editor-stub" }),
}));
vi.mock("@/lib/e14/ui/ZoomableVisor", () => ({
  ZoomableVisor: () => createElement("div", { "data-testid": "visor-stub" }),
}));
vi.mock("@/components/e14/PanelClasificacion", () => ({
  PanelClasificacion: () => createElement("div", { "data-testid": "panel-stub" }),
}));

// ── Fixtures (actas SINTÉTICAS — nada de actas reales, RED LINE del repo) ──

const QUAD: Quad = [
  { x: 0, y: 0 },
  { x: 1, y: 0 },
  { x: 1, y: 1 },
  { x: 0, y: 1 },
];

/** Acta base válida: completa, con foto y votos leídos. Cada caso ajusta
 *  solo lo que define el estado bajo prueba. */
function actaBase(ajustes: Partial<Acta>): Acta {
  return {
    id: "acta-test",
    fuente: "CAMARA",
    intento: 1,
    maxIntentos: 4,
    status: "RECHAZADA",
    score: 6.4,
    rechazo: { tipo: "INCOMPLETA", detalle: "EL ACTA ESTÁ CORTADA EN EL ENCUADRE" },
    clasificacion: null,
    fotoOriginal: "data:image/jpeg;base64,AAAA",
    fotoProcesada: "data:image/jpeg;base64,BBBB",
    procesadaVacia: false,
    ocrTexto: "E-14 KIT 399 MESA 003",
    metricas: { sharpness: 80, brightness: 95, contrast: 22 },
    quadDetectado: QUAD,
    filtro: "bw",
    rotation: 0,
    ts: Date.parse("2026-11-07T12:00:00Z"),
    ...ajustes,
  } as Acta;
}

describe.skip("7.10 · ReviewView — copy visible por estado (bloqueado: alias @ y deps)", () => {
  it("RECHAZADA por INCOMPLETA: píldora del motivo REAL + banner de rechazo", async () => {
    const { renderToStaticMarkup } = await import("react-dom/server");
    const { ReviewView } = await import("@/components/e14/screens/ReviewView");
    estadoStore = {
      actaActual: actaBase({
        status: "RECHAZADA",
        rechazo: { tipo: "INCOMPLETA", detalle: "EL ACTA ESTÁ CORTADA EN EL ENCUADRE" },
      }),
      recortando: false,
      revelando: false,
      errorRecorte: null,
      aplicarRecorte: vi.fn(),
      rotarFoto: vi.fn(),
      cambiarFiltro: vi.fn(),
      reconocerTextoActa: vi.fn(),
    };
    const html = renderToStaticMarkup(createElement(ReviewView));
    // píldora del motivo real + testid de la barra de rechazo + banner de
    // fallback (nunca una ruta inventada sin clasificación).
    if (!html.includes("ACTA INCOMPLETA")) throw new Error("falta píldora ACTA INCOMPLETA");
    if (!html.includes("EL ACTA ESTÁ CORTADA EN EL ENCUADRE")) throw new Error("falta detalle");
    if (!html.includes('data-testid="barra-rechazo"')) throw new Error("falta barra-rechazo");
    if (!html.includes("NO IDENTIFICADO")) throw new Error("falta banner NO IDENTIFICADO");
  });

  it("RECHAZADA por SIN_VOTOS: copy CORTO del marcador obligatorio (G2)", async () => {
    const { renderToStaticMarkup } = await import("react-dom/server");
    const { ReviewView } = await import("@/components/e14/screens/ReviewView");
    estadoStore = {
      actaActual: actaBase({
        status: "RECHAZADA",
        rechazo: { tipo: "SIN_VOTOS", detalle: "ACTA SIN VOTOS VISIBLES" },
      }),
      recortando: false,
      revelando: false,
      errorRecorte: null,
      aplicarRecorte: vi.fn(),
      rotarFoto: vi.fn(),
      cambiarFiltro: vi.fn(),
      reconocerTextoActa: vi.fn(),
    };
    const html = renderToStaticMarkup(createElement(ReviewView));
    if (!html.includes("ACTA SIN VOTOS")) throw new Error("falta píldora ACTA SIN VOTOS");
    if (!html.includes("barra-rechazo")) throw new Error("falta barra-rechazo");
  });

  it("ADVERTENCIA con lectura parcial de mesa: píldora LECTURA PARCIAL", async () => {
    const { renderToStaticMarkup } = await import("react-dom/server");
    const { ReviewView } = await import("@/components/e14/screens/ReviewView");
    estadoStore = {
      actaActual: actaBase({
        status: "ADVERTENCIA",
        score: 7,
        clasificacion: { nivel: "SUGERIDA", parciales: { mesa: 3 } },
      } as Partial<Acta>),
      recortando: false,
      revelando: false,
      errorRecorte: null,
      aplicarRecorte: vi.fn(),
      rotarFoto: vi.fn(),
      cambiarFiltro: vi.fn(),
      reconocerTextoActa: vi.fn(),
    };
    const html = renderToStaticMarkup(createElement(ReviewView));
    if (!html.includes("LECTURA PARCIAL")) throw new Error("falta LECTURA PARCIAL");
    if (!html.includes("CLASIFICACIÓN PENDIENTE")) throw new Error("falta banner pendiente");
  });

  it("ADVERTENCIA recortada: el defecto físico manda sobre la métrica (con LADO)", async () => {
    const { renderToStaticMarkup } = await import("react-dom/server");
    const { ReviewView } = await import("@/components/e14/screens/ReviewView");
    estadoStore = {
      actaActual: actaBase({ status: "ADVERTENCIA", score: 7.9, recortada: true, recorteLado: "bl" }),
      recortando: false,
      revelando: false,
      errorRecorte: null,
      aplicarRecorte: vi.fn(),
      rotarFoto: vi.fn(),
      cambiarFiltro: vi.fn(),
      reconocerTextoActa: vi.fn(),
    };
    const html = renderToStaticMarkup(createElement(ReviewView));
    if (!html.includes("ACTA RECORTADA · BL")) throw new Error("falta ACTA RECORTADA · BL");
  });

  it("ÓPTIMA: píldora con score y bruto + bloque de auto-envío", async () => {
    const { renderToStaticMarkup } = await import("react-dom/server");
    const { ReviewView } = await import("@/components/e14/screens/ReviewView");
    estadoStore = {
      actaActual: actaBase({
        status: "OPTIMA",
        score: 8.5,
        scoreVisual: 8.2,
        enviadoAutomaticamente: "12:00:03",
      } as Partial<Acta>),
      recortando: false,
      revelando: false,
      errorRecorte: null,
      aplicarRecorte: vi.fn(),
      rotarFoto: vi.fn(),
      cambiarFiltro: vi.fn(),
      reconocerTextoActa: vi.fn(),
    };
    const html = renderToStaticMarkup(createElement(ReviewView));
    if (!html.includes("ÓPTIMA")) throw new Error("falta ÓPTIMA");
    if (!html.includes("8.5/10")) throw new Error("falta score en la píldora");
    if (!html.includes("bruto 8.2/10")) throw new Error("falta bruto en la píldora");
    if (!html.includes("ENVIADO AUTOMÁTICAMENTE")) throw new Error("falta auto-envío");
  });

  it("sin acta en vuelo → no renderiza nada (guard honesto)", async () => {
    const { renderToStaticMarkup } = await import("react-dom/server");
    const { ReviewView } = await import("@/components/e14/screens/ReviewView");
    estadoStore = { actaActual: null };
    const html = renderToStaticMarkup(createElement(ReviewView));
    if (html !== "") throw new Error("el guard de acta nula no renderiza vacío");
  });
});
