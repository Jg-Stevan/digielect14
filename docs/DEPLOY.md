# DEPLOY — digielect14

Tres destinos, dos mecánicas. El **código** es el mismo: un export estático de
Next (`BUILD_STATIC=1` → `out/`) o el worker de OpenNext.

| destino | URL | COOP/COEP (multihilo OCR) | cómo se actualiza |
|---|---|---|---|
| Cloudflare Pages (objetivo) | `digielect14.pages.dev` | ✓ vía `public/_headers` | manual (o Git-integration) |
| Cloudflare Worker | `digielect14e.julistevan02.workers.dev` | ✓ (config del worker) | `bun run deploy` (o Build de la app en el dashboard) |
| GitHub Pages (retiro aprobado — A-02 del plan 2026-11-12) | `jg-stevan.github.io/digielect14/` | ✗ → wasm a un hilo | automático: `deploy-pages.yml` en push a `main` (el workflow aún existe; se apaga con A-02) |

El canal vigente es Cloudflare (Pages + Worker). GitHub Pages no puede enviar
cabeceras cross-origin, así que ahí
`crossOriginIsolated` es `false` y `onnxruntime-web` baja a un hilo; su retiro
está aprobado (A-02 del plan 2026-11-12) y la demo canónica pasa a ser
`digielect14.pages.dev`.

**Por qué el merge no basta**: ni Pages ni el Worker se disparan solos con el
push (hoy el único automático es GH Pages, que se retira con A-02; después de
eso ningún canal se auto-dispara). Después de mergear hay que lanzar el deploy.

## 1. Cloudflare Pages (demo multihilo en la raíz)

```bash
git switch main && git pull origin main
BUILD_STATIC=1 NEXT_PUBLIC_BASE_PATH= bun run build   # variable VACÍA = sin basePath
bunx wrangler pages deploy out --project-name digielect14
```

`NEXT_PUBLIC_BASE_PATH=""` desactiva el basePath en `next.config.ts`; el código
e14 y el core resuelven `/models/…`, `/wasm/…`, `/vendor/…` en la raíz.
`public/_headers` viaja dentro de `out/` y es lo que habilita SharedArrayBuffer.
Si wrangler protesta por `main`/assets es que leyó `wrangler.jsonc` (ese es del
**Worker**): el deploy de Pages con `--project-name` y el directorio explícitos
no necesita config.

Alternativa sin consola (Git-integration): dash → Workers & Pages → Create →
Pages → Connect to Git → repo `Jg-Stevan/digielect14`; preset **None**; build
command
`npm i -g bun && bun install --frozen-lockfile && BUILD_STATIC=1 NEXT_PUBLIC_BASE_PATH= bunx next build`;
output `out`; variable `NODE_VERSION=22`. La integración no lee comandos del
repo: esos settings viven en el dashboard.

## 2. Cloudflare Worker (`digielect14e`)

Este repo es la única fuente del worker (el mirror `Jg-Stevan/digielect14e`
quedó obsoleto). La config canónica es `wrangler.jsonc` + `open-next.config.ts`;
no volver a correr `opennextjs-cloudflare migrate` (regeneraría el nombre).

```bash
bun install
bun run deploy     # opennextjs-cloudflare build && … deploy
bun run preview    # correr el build de OpenNext localmente
bun run cf-typegen # regenerar cloudflare-env.d.ts
```

Reglas duras: no renombrar `name`/`service` en `wrangler.jsonc` (rompe el deploy
y el self-reference). Con token en vez de `bunx wrangler login`:
`CLOUDFLARE_ACCOUNT_ID` + `CLOUDFLARE_API_TOKEN` (Workers Scripts Write) en el
entorno del shell — **nunca** pegados en un chat ni en el repo.

Para automatizar: Settings → Build → Connect del worker, rama de producción
`main`, comandos `npx opennextjs-cloudflare build` / `deploy`.

## 3. Verificación post-deploy

```bash
curl -sI https://digielect14.pages.dev/ | grep -i cross-origin
curl -sI https://digielect14e.julistevan02.workers.dev/ | head -1
```

- Cabeceras: `cross-origin-opener-policy: same-origin` y
  `cross-origin-embedder-policy: require-corp`.
- En la app: `crossOriginIsolated === true` en la consola y cero 404 en
  `/models/rapidocr/*`, `/wasm/zxing_reader.wasm`, `/vendor/onnxruntime/*`.
- El deployment debe señalar el SHA del merge, no un SHA viejo.

## 4. Hard refresh obligatorio

El navegador cachea el `index.html` del build anterior, que apunta a chunks con
hash nuevos → app vieja o pantalla en blanco. `Ctrl+Shift+R` (o `Cmd+Shift+R`);
en iPhone Safari: pestaña privada o borrar historial y datos de sitios. Eso
**no** toca IndexedDB: las actas en cola, los estados y la jornada sobreviven.
`_headers` ya marca `/index.html` y `/sw.js` como `no-cache` para reducir el
problema.

## 5. Troubleshooting

| síntoma | causa | acción |
|---|---|---|
| 404 en `/models/…` o `/wasm/…` | build sin `NEXT_PUBLIC_BASE_PATH=` vacío | reconstruir con la variable vacía |
| `crossOriginIsolated === false` | `_headers` no llegó al deploy | confirmar `public/_headers` commiteado y `out/_headers` generado |
| app vieja tras el deploy | caché del `index.html` | hard refresh / incógnito |
| build falla en Pages | `bun` ausente en la imagen | `npm i -g bun` debe ir **primero** en el build command |
| build del worker falla | — | detenerse y copiar el log literal; no improvisar parches |

## 6. Retirado

- **Vercel** (D73, 2026-10-23): el espejo y su `vercel.json` se fueron; Cloudflare
  Pages asumió el rol de demo multihilo.
- **Ledger remoto D1** (`DB_ENVIOS_E14`, `src/app/api/e14/envios`): se retiró con
  la cola MASIVA. No hay binding D1 en `wrangler.jsonc` ni route `/api` en el
  export; el envío sigue siendo `POST {hub}/actas` directo desde el cliente.

## 6. Trampas de entorno (C-27)

- **basePath sin variable:** `BUILD_STATIC=1` sin `NEXT_PUBLIC_BASE_PATH` definida
  hornea el fallback `/digielect14` (el basePath histórico de GH Pages, canal
  en retiro — A-02 del plan 2026-11-12). Para la raíz, la variable VACÍA.
  El `prebuild` imprime un aviso ruidoso con el basePath efectivo
  (`scripts/aviso-basepath.mjs`) — no lo silencies: es el 404 de `/models` evitado.
- **Git Bash manglea la variable** (Windows): `NEXT_PUBLIC_BASE_PATH=/digielect14`
  se convierte en `C:/Program Files/Git/digielect14` y Next rechaza el basePath.
  Anteponer `MSYS_NO_PATHCONV=1` al comando; en CI (Linux) no aplica. Detalle en
  `docs/DEUDA.md`.
