import { defineConfig } from "vitest/config";

/**
 * Overnight 2026-10-22 (Prioridad 2): suite unitaria para las partes PURAS
 * de lib/e14 (clasificador / completitud / divipol) — entorno node, sin DOM.
 * Las dependencias DOM de los módulos bajo test se mockean con vi.mock
 * (ver completitud.test.ts). NO cubre los QA de regresión (scripts/qa-*.ts),
 * que siguen corriendo con `bun scripts/qa-*.ts`.
 */
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
