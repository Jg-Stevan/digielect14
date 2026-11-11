/**
 * C-27 (plan 2026-11-11) — AVISO RUIDOSO del basePath efectivo en el build
 * estático. `next.config.ts` mantiene el fallback histórico a `/digielect14`
 * cuando `BUILD_STATIC=1` y `NEXT_PUBLIC_BASE_PATH` no está definida: un
 * build para la RAÍZ (Cloudflare Pages) que olvide la variable sale con
 * rutas `/digielect14/…` y 404 silencioso en `/models`, `/wasm` y `/vendor`.
 *
 * Este aviso NO bloquea el build (el fallback es legítimo para GH Pages):
 * deja constancia en la salida del basePath que se va a hornear y del cómo
 * sobreescribirlo. Invocado al frente del `prebuild` de package.json.
 *
 * Nota de entorno (trampa de Git Bash): `NEXT_PUBLIC_BASE_PATH=/digielect14`
 * en Git Bash de Windows se manglea a `C:/Program Files/Git/digielect14` —
 * anteponer `MSYS_NO_PATHCONV=1`. Documentado en docs/DEPLOY.md §6 y
 * docs/DEUDA.md.
 */

const estatico = process.env.BUILD_STATIC === "1";

if (!estatico) {
  // Dev / worker OpenNext: sin basePath — nada que avisar.
  process.exit(0);
}

const definida = process.env.NEXT_PUBLIC_BASE_PATH !== undefined;
const valor = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

if (!definida) {
  const linea = "─".repeat(64);
  console.error(
    `\n${linea}\n` +
      `AVISO (C-27): BUILD_STATIC=1 SIN NEXT_PUBLIC_BASE_PATH definida.\n` +
      `  basePath EFECTIVO: "/digielect14" (fallback histórico de GH Pages).\n` +
      `  · Deploy a GitHub Pages (repo subpath): correcto, no hagas nada.\n` +
      `  · Deploy a la RAÍZ (Cloudflare Pages / dominio propio): define la\n` +
      `    variable VACÍA —  NEXT_PUBLIC_BASE_PATH= bun run build\n` +
      `    (el string vacío explícito desactiva el basePath a propósito).\n` +
      `  · En Git Bash de Windows anteponer MSYS_NO_PATHCONV=1 (mangleo de\n` +
      `    rutas: /digielect14 → C:/Program Files/Git/digielect14).\n` +
      `${linea}\n`,
  );
  process.exit(0);
}

console.info(
  `[aviso-basepath] BUILD_STATIC=1 · NEXT_PUBLIC_BASE_PATH="${valor}" → basePath ${
    valor === "" ? "DESACTIVADO (raíz)" : `"${valor}"`
  }`,
);
