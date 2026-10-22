import nextCoreWebVitals from "eslint-config-next/core-web-vitals";
import nextTypescript from "eslint-config-next/typescript";
import { dirname } from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const eslintConfig = [...nextCoreWebVitals, ...nextTypescript, {
  rules: {
    // TypeScript rules
    "@typescript-eslint/no-explicit-any": "off",
    "@typescript-eslint/no-unused-vars": "off",
    "@typescript-eslint/no-non-null-assertion": "off",
    "@typescript-eslint/ban-ts-comment": "off",
    "@typescript-eslint/prefer-as-const": "off",
    "@typescript-eslint/no-unused-disable-directive": "off",

    // React rules (mismo criterio que scanner-lab; las dos últimas son las
    // reglas nuevas de eslint-plugin-react-hooks 7.1.x del lockfile raíz)
    "react-hooks/exhaustive-deps": "off",
    "react-hooks/purity": "off",
    "react-hooks/refs": "off",
    "react-hooks/set-state-in-effect": "off",
    "react/no-unescaped-entities": "off",
    "react/display-name": "off",
    "react/prop-types": "off",
    "react-compiler/react-compiler": "off",

    // Next.js rules
    "@next/next/no-img-element": "off",
    "@next/next/no-html-link-for-pages": "off",

    // General JavaScript rules
    "prefer-const": "off",
    "no-unused-vars": "off",
    "no-console": "off",
    "no-debugger": "error",
    "no-empty": "off",
    "no-irregular-whitespace": "off",
    "no-case-declarations": "off",
    "no-fallthrough": "off",
    "no-mixed-spaces-and-tabs": "off",
    "no-redeclare": "off",
    "no-undef": "off",
    "no-unreachable": "off",
    "no-useless-escape": "off",
  },
}, {
  // "public/vendor/**" + "public/scanner/**": assets del core copiados en L0
  // (opencv/detection-worker, mismos bytes que scanner-lab) — JS vendor
  // minificado, mismo patrón de ignores que apps/scanner-lab.
  // "lab/**/*.bundle.js": bundle ESM del core 0.4.0 para el panel «origen» del
  // harness quad-repro (kit e14-quad-sobel-v1 §4-D) — ARTEFACTO de build del
  // PR de Fase A (web-scanner #14), no código fuente: mismo criterio vendor.
  // "tools/bench-qr-identidad/jsQR.js": jsQR@1.4.0 VENDIDO byte-exacto del
  // npm tarball (UMD webpack — kit banco-qr-identidad-v1 §1) — MISMO criterio
  // vendor: JS de terceros, no código fuente del repo (el UMD asigna `module`
  // y trae expresiones sueltas del bundle: fallaría lint sin este ignore).
  // "src/lib/e14/masiva/vendor/jsQR.js": EL MISMO archivo vendido a producción
  // por e63m (kit e63m-capa0-qr-identidad-v1 §1.1 — copia BYTE-IDÉNTICA de la
  // de #72; d.ts aparte con los tipos): mismo criterio vendor.
  ignores: ["node_modules/**", ".next/**", "out/**", "build/**", "next-env.d.ts", "docs/**", "public/vendor/**", "public/scanner/**", "lab/**/*.bundle.js", "tools/bench-qr-identidad/jsQR.js", "src/lib/e14/masiva/vendor/jsQR.js"]
}];

export default eslintConfig;
