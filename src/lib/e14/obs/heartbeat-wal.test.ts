/**
 * Tests — KIT e14-obs-hang-atribucion-v1 (§C, T3 ≥ 6): WAL del hang-en-curso.
 *  · debeMarcar: visible + umbral cruzado + no-doble (y NO marca oculta).
 *  · debeDesmarcar: el beat vuelve → borrar; sin marca → nada.
 *  · decidirDrenaje: la LÁPIDA gana sobre la marca · marca sin lápida se
 *    emite · WAL vacío → null.
 *  · eventoDeMarca: duracionMs = umbralMs (MÍNIMO demostrable — la duración
 *    real murió con la página) + gapHastaReinicioMs + identidad de origen.
 *  · leerYLimpiar limpia TODO (IDB real con fake mínimo — el drenaje consume).
 * Decisiones y evento son PUROS (testeables sin IDB); el fake-IDB solo
 * cubre el cableado del drenaje.
 */
import { describe, expect, it } from "vitest";

import {
  borrarMarcaActiva,
  debeDesmarcar,
  debeMarcar,
  decidirDrenaje,
  eventoDeMarca,
  escribirLapida,
  escribirMarca,
  HANG_EN_CURSO_UMBRAL_MS,
  leerYLimpiar,
  type LapidaWal,
  type MarcaHangEnCurso,
} from "./heartbeat-wal";

const marca = (over: Partial<MarcaHangEnCurso> = {}): MarcaHangEnCurso => ({
  id: "activo",
  inicio: 10_000,
  detectadoEn: 13_000,
  umbralMs: HANG_EN_CURSO_UMBRAL_MS,
  visible: true,
  sesion: "sesion-origen",
  appVersion: "test-1",
  ...over,
});

describe("debeMarcar / debeDesmarcar — decisiones PURAS (§C.2)", () => {
  it("debeMarcar: visible + umbral cruzado → sí · oculto → NO · ya marcada → NO (no-doble)", () => {
    expect(
      debeMarcar({ msDesdeBeat: HANG_EN_CURSO_UMBRAL_MS, visible: true, yaMarcada: false, umbralMs: 3000 }),
    ).toBe(true);
    expect(
      debeMarcar({ msDesdeBeat: HANG_EN_CURSO_UMBRAL_MS + 9_999, visible: false, yaMarcada: false, umbralMs: 3000 }),
    ).toBe(false); // oculto — timers congelados por el SO NO son congelón
    expect(
      debeMarcar({ msDesdeBeat: HANG_EN_CURSO_UMBRAL_MS - 1, visible: true, yaMarcada: false, umbralMs: 3000 }),
    ).toBe(false); // bajo el umbral
    expect(
      debeMarcar({ msDesdeBeat: HANG_EN_CURSO_UMBRAL_MS * 2, visible: true, yaMarcada: true, umbralMs: 3000 }),
    ).toBe(false); // ya marcada — jamás doble marca
  });
  it("debeDesmarcar: beat vuelve (silencio < umbral) con marca → sí · sin marca → NO", () => {
    expect(
      debeDesmarcar({ msDesdeBeat: 100, umbralMs: 3000, yaMarcada: true }),
    ).toBe(true);
    expect(
      debeDesmarcar({ msDesdeBeat: 100, umbralMs: 3000, yaMarcada: false }),
    ).toBe(false); // nada que borrar
    expect(
      debeDesmarcar({ msDesdeBeat: 3000, umbralMs: 3000, yaMarcada: true }),
    ).toBe(false); // sigue colgado — la marca SE QUEDA
  });
});

describe("decidirDrenaje — la LÁPIDA gana sobre la marca (§C.4)", () => {
  const lapida: LapidaWal = { id: "limpio", en: 50_000 };
  it("lápida presente → {limpio: true} (aun coexistiendo con marca)", () => {
    expect(decidirDrenaje([marca(), lapida])).toEqual({ limpio: true });
    expect(decidirDrenaje([lapida])).toEqual({ limpio: true });
  });
  it("marca sin lápida → {marca} · WAL vacío/ilegible → null (honesto)", () => {
    expect(decidirDrenaje([marca()])).toEqual({ marca: marca() });
    expect(decidirDrenaje([])).toBeNull();
  });
});

describe("eventoDeMarca — mínimo demostrable, jamás inventar (§1)", () => {
  it("duracionMs = umbralMs (la duración REAL murió con la página) + gap + origen", () => {
    const e = eventoDeMarca(marca(), 61_000);
    expect(e.fuente).toBe("hang-en-curso");
    expect(e.duracionMs).toBe(HANG_EN_CURSO_UMBRAL_MS); // mínimo DEMOSTRABLE
    expect(e.umbralMs).toBe(HANG_EN_CURSO_UMBRAL_MS);
    expect(e.inicio).toBe(10_000);
    expect(e.detectadoEn).toBe(13_000);
    expect(e.gapHastaReinicioMs).toBe(51_000); // 61_000 − 10_000
    expect(e.visible).toBe(true);
    expect(e.sesionOrigen).toBe("sesion-origen"); // el ORIGEN viaja en datos
    expect(e.appVersionOrigen).toBe("test-1");
    expect(e.breadcrumbs).toEqual([]); // murieron con la página — honesto
    expect("op" in e).toBe(false); // sin atribución de origen — jamás inventar
  });
  it("reloj retroactivo en el drenaje → gap 0 (jamás negativo)", () => {
    expect(eventoDeMarca(marca(), 9_000).gapHastaReinicioMs).toBe(0);
  });
});

describe("leerYLimpiar — cableado IDB con fake mínimo (drenaje consume TODO)", () => {
  /** Fake IDB mínimo (patrón del repo — sondeo-qr.test): un solo store con
   *  put/delete/getAll/clear; registra las operaciones para afirmar el
   *  vaciado. Nada de esto toca IndexedDB real. */
  function fakeIdb(): { registros: Map<string, unknown> } {
    const registros = new Map<string, unknown>();
    const store = {
      put: (v: { id: string }) => {
        registros.set(v.id, v);
        return {} as IDBRequest<IDBValidKey>;
      },
      delete: (k: string) => {
        registros.delete(k);
        return {} as IDBRequest<undefined>;
      },
      getAll: () =>
        ({ result: [...registros.values()] }) as unknown as IDBRequest<unknown[]>,
      clear: () => {
        registros.clear();
        return {} as IDBRequest<undefined>;
      },
    };
    const db = {
      transaction: () => {
        // El tx real dispara oncomplete asíncrono — el fake lo simula con
        // una microtarea (los handlers ya están asignados para entonces).
        const tx = {
          objectStore: () => store,
          oncomplete: null as unknown,
          onerror: null as unknown,
          onabort: null as unknown,
        };
        queueMicrotask(() => {
          (tx.oncomplete as ((e: Event) => void) | null)?.({} as Event);
        });
        return tx;
      },
    };
    (globalThis as { indexedDB?: unknown }).indexedDB = {
      open: () => {
        const req = {
          result: db,
          onupgradeneeded: null as ((e: Event) => void) | null,
          onsuccess: null as ((e: Event) => void) | null,
          onerror: null as ((e: Event) => void) | null,
          onblocked: null as ((e: Event) => void) | null,
        };
        // resuelve síncrono — el upgrade y el success, en orden
        queueMicrotask(() => {
          req.onupgradeneeded?.({} as Event);
          req.onsuccess?.({} as Event);
        });
        return req;
      },
    };
    return { registros };
  }

  it("marca sobreviviente → drenaje la emite y limpia TODO (jamás re-emisión)", async () => {
    const { registros } = fakeIdb();
    await escribirMarca(marca());
    expect(registros.has("activo")).toBe(true);
    const d = await leerYLimpiar();
    expect(d && "marca" in d).toBe(true);
    expect(registros.size).toBe(0); // drenaje limpia TODO
    expect(await leerYLimpiar()).toBeNull(); // segunda pasada: nada
  });

  it("lápida gana en IDB real del fake; borrarMarcaActiva deja el WAL sin marca", async () => {
    const { registros } = fakeIdb();
    await escribirMarca(marca());
    await escribirLapida();
    expect(await leerYLimpiar()).toEqual({ limpio: true });
    expect(registros.size).toBe(0);
    // borrarMarcaActiva: sin lápida, solo la marca desaparece
    await escribirMarca(marca());
    expect(await borrarMarcaActiva()).toBe(true);
    expect(registros.has("activo")).toBe(false);
    expect(await leerYLimpiar()).toBeNull();
  });
});
