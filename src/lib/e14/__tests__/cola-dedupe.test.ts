/**
 * C-09 — huella de dedup del outbox del puente (cola.ts): la identidad del
 * sobre es el SHA-256 del contenido COMPLETO (identidad + dataURL entero).
 * Casos:
 *  · dos dataURLs distintos → dos filas (cada sobre viaja).
 *  · el mismo dataURL dos veces → UNA fila + `duplicadaExacta: true` y CERO
 *    sobrescrituras (ts/entrada de la fila original intactos).
 *  · sobre re-mapeado (tsEscaneo nuevo, contenido igual) → idempotente igual
 *    (el campo volátil no vive en la huella).
 *  · score fuera de escala [0,10] (C-20) → NO se encola, rechazo con motivo.
 *
 * Requiere `fake-indexeddb` + jsdom (mismo patrón de puente/envio.test.ts).
 *
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it } from "vitest";
import "fake-indexeddb/auto";

import {
  crearEntradadePrueba,
  resetearPuenteParaTests,
} from "../puente/puente.test-utils";
import { contarPendientes, encolarActa, leerPendientes } from "../puente/cola";

afterEach(async () => {
  await resetearPuenteParaTests();
});

describe("C-09 — huella de dedup del outbox (cola.ts)", () => {
  it("dos dataURLs distintos → dos filas (los dos sobres viajan)", async () => {
    const r1 = await encolarActa(crearEntradadePrueba("88_335_005_02", "001", 1));
    const r2 = await encolarActa(crearEntradadePrueba("88_335_005_02", "001", 2));
    expect(r1.ok).toBe(true);
    expect(r2.ok).toBe(true);
    expect(r1.duplicadaExacta).toBe(false);
    expect(r2.duplicadaExacta).toBe(false);
    expect(r1.hash).not.toBe(r2.hash); // huellas distintas
    expect(await contarPendientes()).toBe(2);
  });

  it("el mismo dataURL dos veces → UNA fila + duplicadaExacta (cero sobrescrituras)", async () => {
    const r1 = await encolarActa(crearEntradadePrueba());
    expect(r1.ok).toBe(true);
    expect(r1.duplicadaExacta).toBe(false);
    const filaAntes = (await leerPendientes())[0];
    const r2 = await encolarActa(crearEntradadePrueba());
    expect(r2.ok).toBe(true);
    expect(r2.duplicadaExacta).toBe(true); // idempotente — fila original manda
    expect(r2.hash).toBe(r1.hash);
    expect(await contarPendientes()).toBe(1);
    const filaDespues = (await leerPendientes())[0];
    expect(filaDespues.ts).toBe(filaAntes.ts); // NO sobrescribe el ts
    expect(filaDespues.entrada).toEqual(filaAntes.entrada); // ni el sobre
  });

  it("sobre re-mapeado (tsEscaneo nuevo, contenido igual) → idempotente igual", async () => {
    await encolarActa(crearEntradadePrueba());
    const remapeado = crearEntradadePrueba();
    remapeado.tsEscaneo = Date.now() + 5; // el móvil re-armó el sobre (C-07)
    const r = await encolarActa(remapeado);
    expect(r.ok).toBe(true);
    expect(r.duplicadaExacta).toBe(true);
    expect(await contarPendientes()).toBe(1);
  });

  it("score fuera de escala → NO se encola (rechazo visible, C-20)", async () => {
    const mala = crearEntradadePrueba();
    mala.score = 91.4; // el dato corregido ya no existe en seeds; el gate lo rechaza igual
    const r = await encolarActa(mala);
    expect(r.ok).toBe(false);
    expect(r.motivo).toBe("SCORE_FUERA_DE_ESCALA");
    expect(await contarPendientes()).toBe(0);
  });
});
