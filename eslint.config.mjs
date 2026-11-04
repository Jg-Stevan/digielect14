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
  // cámara usa refs a propósito para evitar staleness — ver docs/DEUDA.md,
  // hallazgo ALTO de hooks). El resto del repo sigue sin la regla hasta el
  // análisis de Fase 4; al activarla global, este bloque se elimina (1 línea) y
  // las directivas ya están puestas. Reemplaza el enfoque «reportUnusedDisable
  // Directives: off» (7de9fd7) para no perder la higiene de directivas.
  files: ["src/components/e14/screens/ScanView.tsx"],
  rules: { "react-hooks/exhaustive-deps": "warn" },
}, {
  // Vendor y artefactos: `eslint .` no debe parsear JS minificado de terceros
  // ni bundles de build/deploy. src/lib/e14/qr/vendor/jsQR.js es el UMD
  // byte-exacto de jsQR@1.4.0 (asigna `module` y trae expresiones sueltas);
  // public/vendor + public/scanner son los assets copiados del core
  // (opencv/detection-worker); .open-next/.wrangler son bundles del deploy y
  // sin este ignore el lint los parsea y muere por RAM (SIGABRT).
  ignores: ["node_modules/**", ".next/**", "out/**", "build/**", ".open-next/**", ".wrangler/**", "next-env.d.ts", "docs/**", "public/vendor/**", "public/scanner/**", "src/lib/e14/qr/vendor/jsQR.js"]
}];

export default eslintConfig;
