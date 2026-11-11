/**
 * Guardarraíl anti-relleno (auditoría 2026-11-11, fase 5 / T5.1).
 *
 * El acta DEMO del motor (`ACTA_MOCK`) se colaba en pantalla y en el sobre
 * del hub: título «ROMA - CONSULADO», candidatos con votos, jurados con
 * nombre y un barcode inventado. Este test impide la regresión por las dos
 * vías que la auditoría marcó:
 *
 *  1. GUARDA DE FUENTE — `scanner-core-bridge.ts` no menciona `ACTA_MOCK`.
 *  2. COMPORTAMIENTO — `mapearActaAPuente` sin `codigoBarras` produce una
 *     `impresion` SIN la clave `barcode` (nunca un id de seguimiento falso).
 *  3. LISTA DE PERMITIDOS — `ACTA_MOCK` solo puede existir donde nace (seed
 *     del motor) o en el comentario del motor; un import nuevo en la app
 *     hace roja la puerta.
 */
import { describe, expect, test } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

import {
  mapearActaAPuente,
  type ActaMapeable,
} from "../puente/mapear";

const RAIZ = process.cwd();

function leer(rutaRelativa: string): string {
  return readFileSync(join(RAIZ, rutaRelativa), "utf-8");
}

/** Archivos .ts/.tsx bajo una raíz, excluyendo tests y node_modules. */
function archivosFuente(raizRelativa: string): string[] {
  const salida: string[] = [];
  const visitar = (dir: string): void => {
    for (const entrada of readdirSync(dir)) {
      if (entrada === "node_modules" || entrada === "__tests__") continue;
      const ruta = join(dir, entrada);
      const info = statSync(ruta);
      if (info.isDirectory()) {
        visitar(ruta);
      } else if (/\.(ts|tsx)$/.test(entrada) && !/\.test\.(ts|tsx)$/.test(entrada)) {
        salida.push(ruta);
      }
    }
  };
  visitar(join(RAIZ, raizRelativa));
  return salida;
}

/** Archivos que HOY pueden mencionar ACTA_MOCK y por qué. */
const MENCIONES_PERMITIDAS = new Map<string, string>([
  [
    "packages/scanner-core/src/dominio/seed.ts",
    "definición del acta de demostración del motor (consumida solo por SIM)",
  ],
  [
    "packages/scanner-core/src/dominio/clasificador.ts",
    "comentario del motor vendorizado que cita la convención de ubicación",
  ],
]);

/** Acta mínima mapeable: join DIVIPOL completo + foto procesada. */
function actaMapeable(extra: Partial<ActaMapeable> = {}): ActaMapeable {
  return {
    id: "test-1",
    titulo: "ACTA SIN IDENTIFICAR",
    ubicacion: {
      departamento: "—",
      municipio: "—",
      zona: "—",
      puesto: "—",
      mesa: "001",
    },
    tipo: "SIN CLASIFICAR",
    pagina: { index: 1, total: 1 },
    candidatos: [],
    firmas: [],
    score: 7.5,
    status: "ADVERTENCIA",
    rechazo: null,
    intento: 1,
    maxIntentos: 4,
    fotoProcesada: "data:image/png;base64,AAAA",
    clasificacion: {
      departamento: { codigo: "88", nombre: "ARCHIPIELAGO DE SAN ANDRES" },
      municipio: { codigo: "495", nombre: "ITALIA" },
      zona: { codigo: "10" },
      puesto: { codigo: "02", nombre: "Roma - Consulado" },
      mesa: 1,
      tipo: "TRANSMISION",
      pagina: { index: 1, total: 1 },
      kit: null,
      nivel: "AUTO",
      confianzas: { departamento: 1, municipio: 1, puesto: 1, tipo: 1 },
    },
    ...extra,
  };
}

describe("T5.1 — sin relleno en producción (digielect14)", () => {
  test("scanner-core-bridge.ts ya NO menciona el acta de demostración", () => {
    expect(leer("src/lib/e14/scanner-core-bridge.ts")).not.toContain("ACTA_MOCK");
  });

  test("mapearActaAPuente sin codigoBarras → impresion SIN la clave barcode", async () => {
    const entrada = await mapearActaAPuente(actaMapeable());
    expect(entrada).not.toBeNull();
    expect(entrada).not.toHaveProperty("impresion.barcode");
    expect(Object.keys(entrada!.impresion)).not.toContain("barcode");
  });

  test("mapearActaAPuente con codigoBarras REAL lo conserva (control)", async () => {
    const entrada = await mapearActaAPuente(
      actaMapeable({ codigoBarras: "8801-495-10-02-001-3" }),
    );
    expect(entrada?.impresion.barcode).toBe("8801-495-10-02-001-3");
  });

  test("ACTA_MOCK solo se menciona en los sitios permitidos", () => {
    const infractores: string[] = [];
    for (const raiz of ["src", "packages/scanner-core/src"]) {
      for (const archivo of archivosFuente(raiz)) {
        if (!readFileSync(archivo, "utf-8").includes("ACTA_MOCK")) continue;
        const relativa = relative(RAIZ, archivo).replace(/\\/g, "/");
        if (!MENCIONES_PERMITIDAS.has(relativa)) infractores.push(relativa);
      }
    }
    expect(infractores).toEqual([]);
  });
});
