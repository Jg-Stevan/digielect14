/*
 * Service Worker del Digitalizador E-14 (PWA — instalable y offline).
 *
 * Fuente: apps/scanner-lab/public/sw.js (escaner-v7) del repo web-scanner —
 * copia adaptada al layout de assets de e14 (regla de oro #0: el lab es la
 * fuente de verdad). ADAPTACIONES declaradas:
 *  · VERSION propia (e14-v1) — cachés independientes del lab si coexisten.
 *  · Precache: opencv-4.5.5-core.js vive en /vendor/ (en e14 el wasm va
 *    embebido en el core.js de 8.2 MB — no hay .wasm suelto como el lab).
 *  · Caché MOTOR (cache-on-first-use): los modelos RapidOCR (/models/
 *    rapidocr/ ≈16 MB) y el runtime ONNX (/vendor/onnxruntime/ ≈14 MB) se
 *    cachean en el PRIMER uso (mismo razonamiento del bloque OCR del lab:
 *    precachear ~30 MB en install retrasaría el arranque de TODA la app;
 *    con first-use, el primer escaneo online deja el motor offline para
 *    siempre — H6: operadores en zona de mala conexión).
 *  · divipol.json (620 KB) cae en el runtime SWR — siempre fresca online,
 *    disponible offline tras la primera carga.
 *
 * Estrategia anti-caché-vieja (la lección del producto — E-04):
 *  · Navegación (HTML): NETWORK-FIRST — si hay red SIEMPRE va al servidor;
 *    la caché solo responde si la red falla (offline).
 *  · Assets con hash de Next (_next/static, iconos): CACHE-FIRST, son
 *    inmutables por diseño (el nombre cambia con el contenido).
 *  · Resto (worker del escáner, manifest, OpenCV, divipol): STALE-WHILE-
 *    REVALIDATE.
 *
 * E-04 — actualización con consentimiento: una versión nueva QUEDA EN
 * waiting (nunca skipWaiting incondicional en install). La app detecta el
 * worker esperando y muestra el banner «Nueva versión lista» (update-banner
 * en src/lib); solo al pulsar Recargar se envía SKIP_WAITING y el SW nuevo
 * toma el control. Así la pestaña abierta sigue funcionando con SU versión
 * hasta que el usuario acepta — fin de los chunk-load-errors en cada deploy.
 *
 * Al activar una versión nueva (cuando el usuario la acepta), limpia TODAS
 * las cachés antiguas y llama a clients.claim().
 */
const VERSION = "e14-v1";
const CORE_CACHE = `${VERSION}-core`;
const STATIC_CACHE = `${VERSION}-static`;
const RUNTIME_CACHE = `${VERSION}-runtime`;
const MOTOR_CACHE = `${VERSION}-motor`;
// A6 (lab): tope de entradas del caché runtime — antes crecía sin límite.
const RUNTIME_CACHE_MAX = 80;

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      try {
        const cache = await caches.open(CORE_CACHE);
        await cache.addAll([
          "./",
          "./manifest.webmanifest",
          "./icon-192.png",
          "./icon-512.png",
          "./apple-touch-icon.png",
          // Motor de detección OpenCV offline (PERF-1b del lab — best-effort).
          "./vendor/opencv-4.5.5.js",
          "./vendor/opencv-4.5.5-core.js",
          "./scanner/detection-worker.js",
        ]);
      } catch {
        /* el precache es best-effort: la app funciona sin él */
      }
      // E-04 — sin skipWaiting incondicional: el SW nuevo queda waiting y la
      // pestaña vieja sigue sirviéndose con el SW actual hasta que el usuario
      // pulse Recargar en el banner (que envía SKIP_WAITING al listener de
      // abajo). Saltarse la espera rompía las pestañas abiertas en cada deploy
      // (HTML viejo + chunks nuevos = chunk-load-error).
    })()
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      // Borra cualquier caché de versiones anteriores.
      const names = await caches.keys();
      await Promise.all(
        names
          .filter((n) => !n.startsWith(VERSION))
          .map((n) => caches.delete(n))
      );
      await self.clients.claim();
    })()
  );
});

self.addEventListener("message", (event) => {
  // El cliente puede pedir saltar a la nueva versión explícitamente (botón
  // «Recargar» del banner de update-banner.ts). Se acepta el string plano y
  // el formato { type: "SKIP_WAITING" } — el banner usa el objeto.
  if (event.data === "SKIP_WAITING" || event.data?.type === "SKIP_WAITING") self.skipWaiting();
});

function isImmutableAsset(url) {
  return (
    url.pathname.includes("/_next/static/") ||
    url.pathname.endsWith("/icon-192.png") ||
    url.pathname.endsWith("/icon-512.png")
  );
}

/** Motores del pipeline (modelos OCR + runtime ONNX): includes() y NO
 *  startsWith — el deploy de Pages vive bajo basePath (/digielect14), el
 *  pathname real es /digielect14/models/** (lab L108-113). */
function isMotorAsset(url) {
  return (
    url.pathname.includes("/models/rapidocr/") ||
    url.pathname.includes("/vendor/onnxruntime/")
  );
}

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;

  const url = new URL(req.url);

  // MOTOR (F2-C del lab): cache-first en runtime — se cachea en el PRIMER
  // uso (el primer escaneo online deja el OCR offline para siempre). Tope
  // de entradas por higiene (el set es fijo: 3 onnx + keys + 2 ort).
  if (isMotorAsset(url)) {
    event.respondWith(
      (async () => {
        const cache = await caches.open(MOTOR_CACHE);
        const cached = await cache.match(req);
        if (cached) return cached;
        try {
          const fresh = await fetch(req);
          if (fresh && (fresh.ok || fresh.type === "opaque")) {
            cache.put(req, fresh.clone()).catch(() => undefined);
          }
          return fresh;
        } catch {
          return (
            cached ||
            new Response("Motor OCR offline no disponible", { status: 503 })
          );
        }
      })()
    );
    return;
  }

  if (url.origin !== self.location.origin) return; // CDN externo, etc.

  // 1) Navegación → NETWORK-FIRST (anti caché vieja).
  if (req.mode === "navigate") {
    event.respondWith(
      (async () => {
        try {
          const fresh = await fetch(req);
          // A7 (lab): solo cachear navegaciones VÁLIDAS (un 404 como fallback
          // offline dejaba la app rota sin conexión).
          if (fresh && fresh.ok) {
            const cache = await caches.open(CORE_CACHE);
            cache.put("./", fresh.clone()).catch(() => undefined);
          }
          return fresh;
        } catch {
          const cached =
            (await caches.match(req)) ||
            (await caches.match("./")) ||
            (await caches.match("./index.html"));
          return (
            cached ||
            new Response("Sin conexión", { status: 503, statusText: "Offline" })
          );
        }
      })()
    );
    return;
  }

  // 2) Assets inmutables → CACHE-FIRST.
  if (isImmutableAsset(url)) {
    event.respondWith(
      (async () => {
        const cached = await caches.match(req);
        if (cached) return cached;
        const fresh = await fetch(req);
        // E-04 (lab): solo cachear respuestas VÁLIDAS — cachear un 404 de un
        // asset inmutable lo serviría roto PARA SIEMPRE.
        if (fresh && fresh.ok) {
          const cache = await caches.open(STATIC_CACHE);
          cache.put(req, fresh.clone()).catch(() => undefined);
        }
        return fresh;
      })()
    );
    return;
  }

  // 3) Resto del mismo origen → STALE-WHILE-REVALIDATE.
  // A6 (lab): descargas grandes de artefactos NO se cachean.
  if (url.pathname.includes("/downloads/")) return;
  event.respondWith(
    (async () => {
      const cache = await caches.open(RUNTIME_CACHE);
      const cached = await cache.match(req);
      const network = fetch(req)
        .then((fresh) => {
          if (fresh && fresh.status === 200) {
            cache.put(req, fresh.clone()).catch(() => undefined);
            // A6: purga FIFO cuando el caché runtime supera el tope.
            cache.keys().then((keys) => {
              if (keys.length <= RUNTIME_CACHE_MAX) return;
              for (const k of keys.slice(0, keys.length - RUNTIME_CACHE_MAX)) {
                cache.delete(k).catch(() => undefined);
              }
            }).catch(() => undefined);
          }
          return fresh;
        })
        .catch(() => undefined);
      return cached || (await network) || new Response("Sin conexión", { status: 503 });
    })()
  );
});
