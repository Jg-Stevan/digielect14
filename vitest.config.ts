import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

/**
 * Overnight 2026-10-22 (Prioridad 2): suite unitaria para las partes PURAS
 * de lib/e14 (clasificador / completitud / divipol) — entorno node, sin DOM.
 * Las dependencias DOM de los módulos bajo test se mockean con vi.mock
 * (ver completitud.test.ts). NO cubre los QA de regresión (scripts/qa-*.ts),
 * que siguen corriendo con `bun scripts/qa-*.ts`.
 *
 * KIT ux-masiva-fixes-v1 (T4/§D.4 — M-ux-1): `resolve.alias "@" → ./src`
 * ADITIVO para poder importar la parte PURA `porcentajeProcesoActa`
 * exportada de MasivaView.tsx (el componente importa "@/lib/e14/store" y
 * vite no leía tsconfig paths). Los tests existentes usan imports
 * relativos/paquetes — el alias NO cambia su resolución.
 */
export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});

