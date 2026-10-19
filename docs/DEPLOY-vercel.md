# DEPLOY VERCEL — Receta post-merge (ítem del checklist: «redeploy manual + Ctrl+Shift+R»)

**Qué es:** procedimiento operativo para actualizar la demo de producción en Vercel tras cada merge a `main`. Lo ejecuta el dueño (§2 o §3) o el agente con token one-off provisto (como el deploy post-merge de PR #28, ver worklog). Referencias: D46 (demo Vercel con COOP/COEP), `vercel.json`, `docs/REPORTE-e14-vercel-perf-v1.md`.

---

## §0 Por qué el merge NO despliega solo

- `vercel.json` → `"git": { "deploymentEnabled": { "main": false } }` — decisión fijada: los deploys automáticos de Vercel por push a `main` están **APAGADOS**.
- Asimetría con GH Pages: `deploy-pages.yml` **SÍ** se dispara con el push a `main` (producción canónica `https://jg-stevan.github.io/digielect14/`, sin COOP/COEP → wasm mono-hilo). Vercel es la demo con multihilo (`crossOriginIsolated=true`) y **no** se actualiza con el merge.
- Consecuencia: tras cada merge, Vercel queda en el build **anterior** hasta que alguien lance el deploy manual de esta receta.

## §1 Qué se actualiza

| Dato | Valor |
|---|---|
| Proyecto Vercel | `digielect14` (scope `jg-stevan`) |
| URL demo | https://digielect14.vercel.app/digielect14/ |
| Qué lee Vercel en cada deploy | TODO de `vercel.json` verbatim: `framework: null` · `installCommand: bun install` · `buildCommand: BUILD_STATIC=1 NEXT_PUBLIC_BASE_PATH=/digielect14 bun run build` · `outputDirectory: out` · rewrites `/digielect14*` → `/` · headers COOP/COEP |

## §2 Receta CLI (recomendada)

Desde la **RAÍZ del repo** (donde vive `vercel.json`):

```bash
git switch main
git pull origin main          # baja el merge recién hecho
bunx vercel --prod            # deploy de producción (Ready ~30 s)
```

Primera vez en una máquina nueva (una sola vez, queda guardado):

```bash
bunx vercel login             # sesión propia — NO hace falta token ni pegarlo en chat
bunx vercel link              # vincula esta carpeta ↔ proyecto digielect14 (scope jg-stevan)
```

- La carpeta `.vercel/` que crea `link` va gitignored — nunca se commitea.
- Comprobación de vínculo: `cat .vercel/project.json` → `"digielect14"`.

## §3 Alternativa Dashboard (sin consola) — Deploy Hook

1. **Setup único:** vercel.com → proyecto `digielect14` → **Settings → Git → Deploy Hooks** → nombre `manual-prod`, Branch: `main` → **Create** → copiar la URL y guardarla en favoritos.
2. **Uso tras cada merge:** abrir esa URL (GET) → dispara un deploy de producción con el **último commit de `main`**. Seguir el progreso en la pestaña **Deployments** hasta `Ready`.

**Advertencia — botón «Redeploy»:** reconstruye **EL MISMO commit** del deployment elegido; **NO** trae el merge nuevo. Sirve para reintentar un build fallido del mismo SHA, NO para actualizar a `main` actualizada.

## §4 Verificación post-deploy

1. **Dashboard:** el deployment de arriba en `Ready`, rama `main`, mensaje = «Merge pull request #N…» (SHA del merge, no un SHA viejo).
2. **CLI:** `bunx vercel ls` → el de arriba, hace segundos, prod.
3. **App:** la feature del PR visible a ojo (ej. PR #29 → botón «INFORME ↓» en RESUMEN).
4. **Cabeceras (multihilo vivo):**

```bash
curl -sI https://digielect14.vercel.app/digielect14/ | grep -i cross-origin
#   cross-origin-opener-policy: same-origin
#   cross-origin-embedder-policy: require-corp
```

## §5 Ctrl+Shift+R (obligatorio tras cada deploy)

**Por qué:** el navegador cachea el `index.html` viejo, que referencia los chunks `_next/static/chunks/…` del build anterior (cada build = nombres de chunk nuevos). Sin hard refresh ves la versión vieja, o pantalla en blanco si esos chunks ya no existen en el CDN.

- **Windows/Linux:** `Ctrl + Shift + R` (equivale `Ctrl + F5`)
- **macOS:** `Cmd + Shift + R`
- **iPhone (QA físico):** Safari no hace bypass de caché con el refresh normal → pestaña **privada**, o Ajustes → Safari → Borrar historial y datos.

**Tranquilidad:** el hard refresh solo limpia caché HTTP — **no toca IndexedDB**: la cola MASIVA, los estados EN COLA/ENVIADA y las actas archivadas sobreviven intactos.

## §6 Troubleshooting

| Síntoma | Causa probable | Acción |
|---|---|---|
| App vieja o en blanco tras el deploy | caché del `index.html` | repetir hard refresh · incógnito · DevTools → Network → «Disable cache» |
| CLI pregunta por proyecto | carpeta sin vincular | `bunx vercel link` y verificar `.vercel/project.json` |
| Build de Vercel no respeta la config | deploy lanzado desde una subcarpeta | lanzar SIEMPRE desde la raíz del repo (donde vive `vercel.json`) |
| 404 en `/digielect14/` | rewrite exacto ausente | verificar rewrites de `vercel.json` (desviación #3 del REPORTE-e14-vercel-perf) |
| Build falla en Vercel | — | DETENER y copiar el log literal — no improvisar fixes (regla del kit vercel-perf) |

## §7 Reglas duras

- **Cero tokens en el chat:** en tu PC `bunx vercel login` no necesita token. Si el agente usa `--token=…` (one-off), revocarlo al terminar en vercel.com → Settings → Tokens.
- `vercel.json` es zona sensible: NO se toca sin kit explícito (fue zona prohibida en los kits e14).
- El deploy manual NO genera commits ni toca el repo — es una operación de despliegue.
