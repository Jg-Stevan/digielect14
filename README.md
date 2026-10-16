# digielect14

Digitalizador de actas E-14. App Next.js que consume el motor
`@jg-stevan/scanner-core` (npm) para detección de bordes, procesado,
OCR y exportación.

Demo: https://jg-stevan.github.io/digielect14/
Motor: https://github.com/Jg-Stevan/web-scanner (packages/scanner-core → npm `@jg-stevan/scanner-core`)
Versión del motor consumida: ^0.1.0

## Desarrollo

    bun install
    bun run dev      # :3001
    bunx tsc --noEmit
    bun run lint
test: disparar primer Vercel Preview del repo nuevo (se borra tras la prueba).
