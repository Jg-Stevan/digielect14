/**
 * C-27 (plan 2026-11-11) — AVISO del basePath efectivo en el build estático.
 * Actualizado por A-02 (2026-11-12): el fallback histórico a `/digielect14`
 * (GitHub Pages) se RETIRÓ de `next.config.ts` — el canal único es Cloudflare
 * Pages en la RAÍZ del dominio y `BUILD_STATIC=1` construye siempre sin
 * basePath. Este aviso deja constancia en la salida del basePath que se va a
 * hornear; hoy solo puede ser la raíz, así que el caso ruidoso es alguien
 * definiendo NEXT_PUBLIC_BASE_PATH a mano (el valor NO tiene efecto en
 * next.config.ts, pero el código cliente del motor lo lee con `?? ""` y unas
 * rutas no vacías apuntarían `/models` y `/wasm` a un subpath inexistente).
 * Invocado al frente del `prebuild` de package.json.
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

if (definida && valor !== "") {
  const linea = "─".repeat(64);
  console.error(
    `\n${linea}\n` +
      `AVISO (C-27/A-02): NEXT_PUBLIC_BASE_PATH="${valor}" definida en un build estático.\n` +
      `  basePath EFECTIVO: "/" (la raíz — el fallback /digielect14 de GH Pages se retiró con A-02).\n` +
      `  next.config.ts ya NO fija basePath con esta variable, PERO el código cliente\n` +
      `  del motor la lee (` + "`?? \"\"`): las rutas `/models`, `/wasm` y `/vendor` quedarían\n" +
      `  bajo "${valor}/" y darían 404 en el deploy. Desdefine la variable o déjala VACÍA:\n` +
      `    ·  NEXT_PUBLIC_BASE_PATH= bun run build\n` +
      `  · En Git Bash de Windows anteponer MSYS_NO_PATHCONV=1 (mangleo de\n` +
      `    rutas: /digielect14 → C:/Program Files/Git/digielect14).\n` +
      `${linea}\n`,
  );
  process.exit(0);
}

console.info(
  `[aviso-basepath] BUILD_STATIC=1 · NEXT_PUBLIC_BASE_PATH="${valor}" → basePath ${
    valor === "" ? "DESACTIVADO (raíz — canal único Cloudflare, A-02)" : `"${valor}"`
  }`,
);
