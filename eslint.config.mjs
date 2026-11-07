import nextCoreWebVitals from "eslint-config-next/core-web-vitals";
import nextTypescript from "eslint-config-next/typescript";

const eslintConfig = [...nextCoreWebVitals, ...nextTypescript, {
  rules: {
    // TypeScript rules
    // 7.7 (plan de remediación, C1): no-explicit-any sube a WARN (había 0
    // `any` en producción al reactivarlo — barato de mantener; tria los
    // avisos que salgan antes de subir a error).
    "@typescript-eslint/no-explicit-any": "warn",
    "@typescript-eslint/no-unused-vars": ["warn", { argsIgnorePattern: "^_" }],
    "@typescript-eslint/no-non-null-assertion": "off",
    "@typescript-eslint/ban-ts-comment": "off",
    "@typescript-eslint/prefer-as-const": "off",
    "@typescript-eslint/no-unused-disable-directive": "off",

    // React rules (mismo criterio que scanner-lab; las dos últimas son las
    // reglas nuevas de eslint-plugin-react-hooks 7.1.x del lockfile raíz)
    // 7.7: exhaustive-deps WARN global — el bloque por-archivo de ScanView
    // se elimina (sus directivas justificadas línea a línea ya están
    // puestas; los avisos nuevos se trian con plan de limpieza, no se
    // silencian a ciegas).
    "react-hooks/exhaustive-deps": "warn",
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
  // 7.5 (plan de remediación, A4): las VISTAS no tocan el motor — los
  // componentes importan por la fachada `@/lib/e14/fachada`. MODO `warn`
  // TRANSITORIO: el swap de los ~22 imports existentes lo hace el agente de
  // UI; cuando termine, subir a "error" (queda anotado en
  // docs/PENDIENTES-INTEGRACION.md).
  files: ["src/components/**"],
  rules: {
    "no-restricted-imports": ["error", {
      patterns: [{
        group: ["@jg-stevan/scanner-core", "@jg-stevan/scanner-core/*"],
        message:
          "Las vistas no tocan el motor: re-exporta desde src/lib/e14/fachada.ts (7.5/A4; swap hecho en la misma remediación).",
      }],
    }],
  },
}, {
  // 7.7 — la capa politica/ (extraída en 7.1–7.2) NACE limpia: se defiende
  // desde el día uno con la regla en error.
  files: ["src/lib/e14/politica/**"],
  rules: {
    "@typescript-eslint/no-explicit-any": "error",
  },
}, {
  // Vendor y artefactos: `eslint .` no debe parsear JS minificado de terceros
  // ni bundles de build/deploy. src/lib/e14/qr/vendor/jsQR.js es el UMD
  // byte-exacto de jsQR@1.4.0 (asigna `module` y trae expresiones sueltas);
  // public/vendor + public/scanner son los assets copiados del core
  // (opencv/detection-worker); .open-next/.wrangler son bundles del deploy y
  // sin este ignore el lint los parsea y muere por RAM (SIGABRT).
  ignores: ["node_modules/**", ".next/**", "out/**", "build/**", ".open-next/**", ".wrangler/**", "next-env.d.ts", "docs/**", "public/vendor/**", "public/scanner/**", "src/lib/e14/qr/vendor/jsQR.js", "packages/scanner-core/src/qr/vendor/**", "packages/scanner-core/assets/**"]
}];

export default eslintConfig;
