# DEPLOY CLOUDFLARE PAGES — Receta de despliegue estático en la raíz

**Qué es:** procedimiento para publicar la demo en **Cloudflare Pages** (`https://digielect14.pages.dev/`). Tercer espejo del proyecto: GH Pages (canónico, mono-hilo) · Vercel (subpath `/digielect14/`, multihilo) · Cloudflare Pages (raíz, multihilo). Referencias: `public/_headers`, `next.config.ts` (basePath «» explícito), `docs/DEPLOY-vercel.md` (receta hermana), `docs/DEPLOY-workers.md` (deploy Workers directo — NOTA: desde `chore/deploy-workers-directo-v1` este repo ya no lleva `wrangler.toml`; la config wrangler que vive en la raíz es la del **Worker**, no de Pages).

---

## §0 Qué cambia respecto a los otros dos espejos

| Dato | GH Pages | Vercel | **Cloudflare Pages** |
|---|---|---|---|
| URL | `jg-stevan.github.io/digielect14/` | `digielect14.vercel.app/digielect14/` | `digielect14.pages.dev` (raíz) |
| basePath | `/digielect14` | `/digielect14` | **ninguno** (variable vacía a propósito) |
| COOP/COEP | ✗ (imposible) → wasm mono-hilo | ✓ (vercel.json) | **✓ vía `public/_headers`** |
| Disparo | auto con push a `main` (deploy-pages.yml) | manual (deploy hooks apagados) | **manual o Git-integration** (§2/§3) |

- El build es el MISMO export estático (`BUILD_STATIC=1` → `out/`); solo cambia `NEXT_PUBLIC_BASE_PATH`: **fijada a string vacío** → `next.config.ts` desactiva el basePath y el código e14/core (`?? ""`) resuelve `/wasm/…`, `/models/…` en la raíz.
- `public/_headers` viaja dentro del export (`out/_headers`) y Cloudflare lo aplica con cada deploy — es lo que habilita `crossOriginIsolated=true` (SharedArrayBuffer → WASM multihilo, mismo contrato que Vercel).

## §1 Datos del proyecto

| Dato | Valor |
|---|---|
| Proyecto Pages | `digielect14` (sin config wrangler desde deploy-workers-directo-v1: el nombre del proyecto pasa por flag) |
| URL demo | https://digielect14.pages.dev/ |
| Build command | `BUILD_STATIC=1 NEXT_PUBLIC_BASE_PATH= bunx next build` |
| Output | `out` |

## §2 Receta CLI (recomendada)

Desde la **RAÍZ del repo** (el nombre del proyecto va por flag — ya no hay `wrangler.toml` de Pages; el `wrangler.jsonc` de la raíz es del Worker, no lo toca este flujo):

```bash
git switch main
git pull origin main
BUILD_STATIC=1 NEXT_PUBLIC_BASE_PATH= bunx next build   # → out/
bunx wrangler pages deploy out --project-name digielect14
```

> Si por error wrangler intenta leer `wrangler.jsonc` (config de Workers) y protesta por
> `main`/assets, es la señal de que faltó `--project-name`/`out`: `wrangler pages deploy`
> con flag explícito de proyecto y directorio no necesita config de Pages.

Primera vez en una máquina nueva (una sola vez, queda guardado):

```bash
bunx wrangler login        # abre el navegador — NO hace falta token en chat
```

Si el proyecto no existe aún, el primer deploy lo crea con la rama subida como producción; para fijarla explícita:

```bash
bunx wrangler pages project create digielect14 --production-branch main
```

## §3 Alternativa Dashboard (Git-integration, sin consola)

1. dash.cloudflare.com → **Workers & Pages → Create → Pages → Connect to Git** → repo `Jg-Stevan/digielect14`.
2. Build settings:
   - Framework preset: **None**
   - Build command: `npm i -g bun && bun install --frozen-lockfile && BUILD_STATIC=1 NEXT_PUBLIC_BASE_PATH= bunx next build`
   - Build output directory: `out`
   - Variables: `NODE_VERSION=22`
3. **Save and Deploy** → deploys automáticos en cada push a la rama de producción.

**Nota:** la integración Git NO lee ningún build command del repo; los settings viven en el dashboard (el `wrangler.toml` que existía para deploys CLI fue retirado — ver §2).

## §4 Verificación post-deploy

1. **Cabeceras (multihilo vivo):**

```bash
curl -sI https://digielect14.pages.dev/ | grep -i cross-origin
#   cross-origin-opener-policy: same-origin
#   cross-origin-embedder-policy: require-corp
```

2. **App:** cargar la URL → DevTools consola → `crossOriginIsolated` debe ser `true` (OCR multihilo activo).
3. **Assets raíz correctos:** DevTools Network sin 404 en `/models/rapidocr/*`, `/wasm/zxing_reader.wasm`, `/vendor/onnxruntime/*`.

## §5 Ctrl+Shift+R (obligatorio tras cada deploy)

Idéntico a DEPLOY-vercel.md §5: el navegador cachea el `index.html` viejo que apunta a chunks con hash nuevo. Hard refresh (`Ctrl+Shift+R` / `Cmd+Shift+R`) — no toca IndexedDB: la cola MASIVA y los estados sobreviven. Por eso `_headers` marca `/index.html` y `/sw.js` como `no-cache`.

## §6 Troubleshooting

| Síntoma | Causa probable | Acción |
|---|---|---|
| 404 en `/models/…` o `/wasm/…` | basePath activo (build sin `NEXT_PUBLIC_BASE_PATH=` vacío) | verificar el build command: la variable VACÍA es la que desactiva el basePath |
| `crossOriginIsolated === false` | `_headers` ausente en `out/` | confirmar que el build partió del repo con `public/_headers` commiteado |
| App en blanco tras deploy | caché del `index.html` | hard refresh (§5) |
| Build falla en CF (bun ausente) | imagen sin bun | el `npm i -g bun` del §3 lo instala; verificar que va PRIMERO en el command |
| Deploy CLI pide proyecto | fuera de la raíz del repo | lanzar `wrangler pages deploy` desde donde vive `wrangler.toml` |

## §7 Reglas duras

- **Cero tokens en el chat:** en tu PC `bunx wrangler login` no necesita token. Si el agente usa `CLOUDFLARE_API_TOKEN` one-off, revocarlo al terminar (dash → My Profile → API Tokens).
- `next.config.ts` — el cambio de basePath es aditivo: SIN definir la variable el fallback sigue siendo `/digielect14` (GH Pages y Vercel quedan intactos).
- Este deploy NO genera commits ni toca el repo — es una operación de despliegue (asimetría igual que Vercel: el push a `main` NO actualiza este espejo a menos que se use Git-integration §3).
