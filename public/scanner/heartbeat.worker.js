/* GENERADO por scripts/build-heartbeat-worker.mjs — NO EDITAR A MANO.
 * Fuente única: src/lib/e14/obs/heartbeat.worker.ts
 * Regenerar: bun scripts/build-heartbeat-worker.mjs
 * Verificado por scripts/smoke-heartbeat-worker.mjs (gate).
 * KIT e14-obs-hang-atribucion-v1 (§C.1 — patrón FIX DICTAMEN-e73 §3.1). */
(() => {

  // src/lib/e14/obs/heartbeat-wal.ts
  var HANG_EN_CURSO_UMBRAL_MS = 3000;
  var DB_NOMBRE = "e14-hang-wal";
  var DB_VERSION = 1;
  var STORE_MARCAS = "marcas";
  var CLAVE_ACTIVO = "activo";
  var CLAVE_LIMPIO = "limpio";
  function debeMarcar(e) {
    return e.visible && e.msDesdeBeat >= e.umbralMs && !e.yaMarcada;
  }
  function debeDesmarcar(e) {
    return e.yaMarcada && e.msDesdeBeat < e.umbralMs;
  }
  var dbPromesa = null;
  function abrirWal() {
    if (dbPromesa)
      return dbPromesa;
    dbPromesa = new Promise((resolve, reject) => {
      try {
        if (typeof indexedDB === "undefined") {
          reject(new Error("sin-indexeddb"));
          return;
        }
        const req = indexedDB.open(DB_NOMBRE, DB_VERSION);
        req.onupgradeneeded = () => {
          try {
            const db = req.result;
            if (!db.objectStoreNames.contains(STORE_MARCAS)) {
              db.createObjectStore(STORE_MARCAS, { keyPath: "id" });
            }
          } catch {}
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error ?? new Error("wal-open"));
        req.onblocked = () => reject(new Error("wal-blocked"));
      } catch (e) {
        reject(e instanceof Error ? e : new Error("wal-open"));
      }
    });
    dbPromesa.catch(() => {
      dbPromesa = null;
    });
    return dbPromesa;
  }
  async function conStore(modo, usar) {
    try {
      const db = await abrirWal();
      return await new Promise((resolve, reject) => {
        try {
          const tx = db.transaction(STORE_MARCAS, modo);
          const req = usar(tx.objectStore(STORE_MARCAS));
          tx.oncomplete = () => resolve(req.result);
          tx.onerror = () => reject(tx.error ?? new Error("wal-tx"));
          tx.onabort = () => reject(tx.error ?? new Error("wal-tx"));
        } catch (e) {
          reject(e instanceof Error ? e : new Error("wal-tx"));
        }
      });
    } catch {
      return null;
    }
  }
  async function escribirMarca(m) {
    const r = await conStore("readwrite", (s) => s.put(m));
    return r !== null;
  }
  async function escribirLapida() {
    const r = await conStore("readwrite", (s) => s.put({ id: CLAVE_LIMPIO, en: Date.now() }));
    return r !== null;
  }
  async function borrarMarcaActiva() {
    const r = await conStore("readwrite", (s) => s.delete(CLAVE_ACTIVO));
    return r !== null;
  }

  // src/lib/e14/obs/heartbeat.worker.ts
  var TICK_MS = 500;
  var umbralMs = HANG_EN_CURSO_UMBRAL_MS;
  var sesion = "";
  var appVersion = "";
  var ultimoBeatTs = 0;
  var visible = true;
  var yaMarcada = false;
  var timer = null;
  function detenerInterval() {
    if (timer !== null) {
      clearInterval(timer);
      timer = null;
    }
  }
  function tick() {
    try {
      if (ultimoBeatTs <= 0)
        return;
      const ahora = Date.now();
      const msDesdeBeat = ahora - ultimoBeatTs;
      if (debeDesmarcar({ msDesdeBeat, umbralMs, yaMarcada })) {
        yaMarcada = false;
        borrarMarcaActiva();
        return;
      }
      if (debeMarcar({ msDesdeBeat, visible, yaMarcada, umbralMs })) {
        yaMarcada = true;
        escribirMarca({
          id: "activo",
          inicio: ultimoBeatTs,
          detectadoEn: ahora,
          umbralMs,
          visible,
          sesion,
          appVersion
        });
      }
    } catch {}
  }
  function apagar() {
    escribirLapida().catch(() => false).then(() => {
      detenerInterval();
      try {
        self.close();
      } catch {}
    });
  }
  if (typeof window === "undefined" && typeof self !== "undefined") {
    self.onmessage = (ev) => {
      try {
        const m = ev.data;
        if (!m || typeof m !== "object")
          return;
        if (m.tipo === "config") {
          umbralMs = typeof m.umbralMs === "number" && m.umbralMs > 0 ? m.umbralMs : HANG_EN_CURSO_UMBRAL_MS;
          sesion = typeof m.sesion === "string" ? m.sesion : "";
          appVersion = typeof m.appVersion === "string" ? m.appVersion : "";
          if (ultimoBeatTs <= 0)
            ultimoBeatTs = Date.now();
          if (timer === null)
            timer = setInterval(tick, TICK_MS);
          return;
        }
        if (m.tipo === "beat") {
          if (typeof m.ts === "number" && m.ts > 0)
            ultimoBeatTs = m.ts;
          return;
        }
        if (m.tipo === "visibilidad") {
          visible = m.visible === true;
          return;
        }
        if (m.tipo === "apagado") {
          apagar();
        }
      } catch {}
    };
  }
})();
