# ENDPOINT-REPORTES — Guía del receptor de reportes (`e14-observabilidad-v1`)

> Kit AGENTE 3 (A3-C6) · Cómo enchufar TU endpoint al transporte de observabilidad
> **sin leer código**. El transporte es el ÚNICO canal por red de la app y está
> **APAGADO por defecto** (D1: nada sale del dispositivo sin acción explícita).

---

## 1 · Qué es `endpointReportes`

`endpointReportes` es una `FlagsApp` del contrato (README-KITS §4.2): una URL `string | null`.

- `null` (default) → el transporte está en **no-op TOTAL**: cero timers, cero listeners, cero requests, `estadoTransporte().activo === false`.
- `"https://tu-servidor/reportes"` → al iniciar la app, el transporte batchea eventos del buffer y los POSTea a esa URL.

## 2 · Cómo configurarlo (dos vías)

**Vía A — `public/flags.json`** (default persistente, se sirve con la app):

```json
{
  "poolWorkers": 2,
  "thumbsOn": true,
  "ocrThreadsTope": 4,
  "telemetriaSalud": true,
  "endpointReportes": "https://tu-servidor/reportes"
}
```

⚠️ JSON **válido, SIN comentarios** (`public/flags-ejemplo.json` es la versión documentada con `//` — quítalos si lo usas de base). Cadena de resolución de `leerFlags()`: defaults ← `public/flags.json` (si existe) ← overrides de localStorage.

**Vía B — override manual en caliente** (kill switch del panel dev, o consola):

```js
// helpers del contrato (obs/politica.ts)
guardarOverridesFlags({ endpointReportes: "http://192.168.1.50:8787/reportes" });
// toma efecto al llamar iniciarTransporte() (arranque de la app o reinicio)
```

Se limpia con `guardarOverridesFlags({})` o borrando la clave `e14-flags-overrides`.

## 3 · El contrato del receptor (lo que TU servidor recibe)

`POST {endpointReportes}` · `Content-Type: application/json` · cuerpo:

```json
{
  "loteId": "uuid-v4-del-lote",
  "deviceId": "uuid-anónimo-persistente (e14-obs-device-id)",
  "appVersion": "0.1.0 (de package.json)",
  "eventos": [ /* 1..50 EventoObs del contrato §4.2 */ ]
}
```

Cada `EventoObs`:

| Campo | Tipo | Nota |
|---|---|---|
| `id` | uuid | del evento (crypto.randomUUID) |
| `ts` | epoch ms | momento de emisión |
| `tipo` | `"error" \| "warn" \| "perf" \| "salud" \| "uso"` | |
| `sesion` | uuid | por sesión de app |
| `dispositivo` | uuid | igual a `deviceId` |
| `appVersion` | string | |
| `datos` | unión | según `tipo` (abajo) |

Según `tipo`, `datos` es:

- **`error`/`warn`** → `ErrorEvento`: `mensaje` (≤500), `stack` (≤2000), `tipo` (constructor), `archivo` (primer frame en `src/`), `digest` (FNV-1a 8 hex — agrupación), `breadcrumbs[]` (≤30: `{t, tipo: click|vista|cola|store|red, detalle}` — SIN contenido de actas).
- **`perf`** → `PerfActa`: `actaIdHash` (FNV-1a 8 hex — **jamás el id plano**), `status`, `intento`, `tiempos{}`, `scoreVisual`, `scoreFinal`, `gate`, `ocrValido`.
- **`salud`** → `SaludSnapshot`: `memoriaMB`, `nucleos`, `memoriaGB`, `bateria{nivel,cargando}`, `red{tipo,downlinkMbps,saveData}`, `storageLibreMB`, `tier (ALTO|MEDIO|BAJO)`, `tierInferido`.
- **`uso`** → `UsoContador`: `{dia, vista, accion, n}` (agregado por día local).

**Respuesta esperada:** cualquier `2xx` = lote entregado (se BORRA del outbox local). `4xx/5xx`, timeout o red caída = fallo (reintento).

## 4 · Política de envío, reintentos y kill local (valores congelados)

| Aspecto | Valor | Constante en `obs/transporte.ts` |
|---|---|---|
| Batcher | cada **10 min** toma hasta **50** eventos (`error`/`warn`/`perf`/`salud`/`uso`) del buffer | `BATCHER_MS = 10 * 60 * 1000`, `LOTE_TOPE = 50` |
| Outbox | DB IndexedDB **propio** `e14-obs-outbox` v1, store `lotes` (keyPath `id`) — jamás abre el DB `e14-obs` del núcleo | §4.1 |
| Éxito | lote con respuesta 2xx → **se borra del outbox** | |
| Reintentos | exponenciales **1 min → 5 min → 30 min** (tope 3) por lote | `BACKOFF_MS = [60_000, 300_000, 1_800_000]` |
| **Kill local** | tras **3 fallos SEGUIDOS** del mismo endpoint el transporte se **auto-detiene** (`activo:false`), deja el outbox **INTACTO** y lo registra con `logger.warn`. Reactivación: `iniciarTransporte()` manual o reinicio de la app | `FALLOS_KILL_LOCAL = 3` |
| Estado consultable | `estadoTransporte() → {activo, lotesPendientes, fallosSeguidos}` | §4.3 |

## 5 · Scrub previo por política (lo que TU receptor NUNCA recibirá)

Antes de cada envío el transporte consulta `leerPolitica()` (`e14-obs-politica`):

- `textoOcr: false` (default) → **ningún** texto OCR viaja.
- `miniaturas: false` (default) → **ninguna** ruta de miniatura viaja.
- El transporte **jamás** serializa `Blob`/`File`/dataURL: solo JSON del contrato.
- **Jamás** viaja `actaId` plano (solo `actaIdHash` FNV-1a 8 hex), ni contenido de actas (imágenes), ni identificadores personales. Cero PII (regla de oro 5).
- El rastreo no puede desactivarse desde el servidor: solo el dueño configura flags/overrides (D6).

## 6 · Prueba rápida (receptor mínimo)

```bash
# Receptor mínimo en la LAN (Bun) — responde 200 a todo:
cat > receptor-reportes.ts <<'EOF'
Bun.serve({
  port: 8787,
  async fetch(req) {
    if (req.method === "POST") {
      const lote = await req.json();
      console.log(`lote ${lote.loteId} · device ${lote.deviceId} · ${lote.eventos.length} eventos`);
      for (const e of lote.eventos) console.log(`  [${e.tipo}] ${JSON.stringify(e.datos).slice(0, 120)}`);
    }
    return new Response("ok");
  },
});
EOF
bun receptor-reportes.ts   # escucha en :8787
```

Luego `endpointReportes: "http://<TU-IP>:8787/reportes"` (Vía A o B) y reiniciar la app.
El lote debe aparecer en consola y el outbox vaciarse (DevTools → Application → IndexedDB → `e14-obs-outbox`).

Para probar el **kill local**: apaga el receptor y espera 3 ciclos de reintento (1m/5m/30m acelerables temporalmente con `BATCHER_MS` en tu copia local — NO commitear) o fuerza 3 fallos; `estadoTransporte()` debe dar `{activo:false, fallosSeguidos:3}` y el outbox conserva el lote.

## 7 · Verificación en campo

- DevTools → **Network** (filtro por el host del endpoint): un POST cada 10 min como máximo, payload ≤ 50 eventos.
- DevTools → **Application → IndexedDB → `e14-obs-outbox`**: `intentos` por lote; tras éxito, lote borrado.
- Checklist completa en `docs/CHECKLIST-CAMPO-observabilidad.md` (ítem 8: modo avión).
