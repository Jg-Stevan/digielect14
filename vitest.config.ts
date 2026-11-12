import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

/**
 * Overnight 2026-10-22 (Prioridad 2): suite unitaria para las partes PURAS
 * de lib/e14 (clasificador / completitud / divipol) — entorno node, sin DOM.
 * Las dependencias DOM de los módulos bajo test se mockean con vi.mock
 * (ver completitud.test.ts). NO cubre los QA de regresión (scripts/qa-*.ts),
 * que siguen corriendo con `bun scripts/qa-*.ts`.
 */
export default defineConfig({
  // Q-52 (plan 2026-11-12) — alias `@` → src/: tsconfig lo define y el test
  // de componente de ReviewView lo necesita (importa "@/lib/e14/store").
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    // Ola 2 §2.3 — cobertura INFORMATIVA (baseline medida por la fase 2:
    // 33,28 % sentencias · 29,46 % ramas). El informe solo se emite con
    // `vitest run --coverage`; el umbral sube con cada ola del plan (nunca
    // baja). La suite del paquete (bun test packages/scanner-core) corre
    // aparte (`bun run test:paquete`) y queda fuera de este include.
    coverage: {
      reporter: ["text", "json-summary", "html"],
      include: ["src/**/*.ts", "src/**/*.tsx"],
      thresholds: {
        // 2.3 (F4) — umbral INFORMATIVO: no rompe el gate mientras sube.
        // NOTA honesta: el 33,28 % citado por la auditoría (fase 2, 5-nov,
        // vitest de entonces) NO es reproducible con vitest@5 + coverage-v8@5
        // (los contadores del proveedor cambiaron). El baseline REAL medido
        // con ESTA toolchain durante la remediación es 17,08 % statements —
        // de ahí parte el piso; la regla de la casa aplica desde aquí: cada
        // ola que toque código sube el umbral o al menos no lo baja.
        statements: 17,
      },
    },
  },
});
