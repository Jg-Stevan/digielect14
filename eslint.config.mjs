import nextCoreWebVitals from "eslint-config-next/core-web-vitals";
import nextTypescript from "eslint-config-next/typescript";

const eslintConfig = [...nextCoreWebVitals, ...nextTypescript, {
  rules: {
    // TypeScript rules
    "@typescript-eslint/no-explicit-any": "off",
    "@typescript-eslint/no-unused-vars": ["warn", { argsIgnorePattern: "^_" }],
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
    "prefer-const": "warn",
    "no-unused-vars": "off",
    "no-console": "off",
    "no-debugger": "error",
    "no-empty": ["warn", { allowEmptyCatch: true }],
    "no-irregular-whitespace": "off",
    "no-case-declarations": "off",
    "no-fallthrough": "off",
    "no-mixed-spaces-and-tabs": "off",
    "no-redeclare": "off",
    "no-undef": "off",
    "no-unreachable": "error",
    "no-useless-escape": "off",
  },
}, {
  // exhaustive-deps ACTIVA SOLO en ScanView.tsx: los 3 useEffect con refs
  // deliberados ya llevan directiva justificada línea a línea (el loop de
  // cámara usa refs a propósito para evitar staleness — ver AUDIT.md, hallazgo
  // ALTO de hooks). El resto del repo sigue sin la regla hasta el análisis de
  // Fase 4; al activarla global, este bloque se elimina (1 línea) y las
  // directivas ya están puestas. Reemplaza el enfoque «reportUnusedDisable
  // Directives: off» (7de9fd7) para no perder la higiene de directivas.
  files: ["src/components/e14/screens/ScanView.tsx"],
  rules: { "react-hooks/exhaustive-deps": "warn" },
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
  // "tools/bench-ocr-cascada/vendor/**": bundle CONGELADO de esbuild con los
  // módulos REALES de prod (rapidocr+clasificador+core — kit
  // e14-bench-ocr-cascada-v1 §1) — ARTEFACTO de build del banco, se regenera
  // con generar-vendor.sh: mismo criterio vendor (no código fuente).
  // "src/lib/e14/qr/vendor/jsQR.js": jsQR@1.4.0 VENDIDO byte-exacto (kit
  // e63m — antes src/lib/e14/masiva/vendor/, reubicado con la eliminación del
  // módulo masiva): mismo criterio vendor (el UMD asigna `module` y trae
  // expresiones sueltas del bundle: fallaría lint sin este ignore).
  // ".open-next/**" + ".wrangler/**": ARTEFACTOS del deploy Workers (Opción A
  // — opennextjs-cloudflare build / wrangler state): bundles minificados del
  // worker, no código fuente. SIN este ignore `eslint .` los parsea y muere
  // por RAM (SIGABRT — hallazgo wave3: el gate de ayer corrió ANTES del
  // primer deploy; hoy .open-next existe y el lint OOM-ea).
  ignores: ["node_modules/**", ".next/**", "out/**", "build/**", ".open-next/**", ".wrangler/**", "next-env.d.ts", "docs/**", "public/vendor/**", "public/scanner/**", "lab/**/*.bundle.js", "tools/bench-qr-identidad/jsQR.js", "tools/bench-ocr-cascada/vendor/**", "src/lib/e14/qr/vendor/jsQR.js"]
}];

export default eslintConfig;
