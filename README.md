# digielect14

Digitalizador de actas E-14. App Next.js que consume el motor
`@jg-stevan/scanner-core` (npm) para detección de bordes, procesado
y exportación.

## Stack OCR / decodificación (producción)

- **OCR**: RapidOCR PP-OCRv4 sobre `onnxruntime-web` (EP wasm) —
  módulo `src/lib/e14/ocr/rapidocr.ts`, modelos vendidos en
  `public/models/rapidocr/`, runtime en `public/vendor/onnxruntime/`.
- **Códigos QR/1D**: `zxing-wasm` + capa 0 de identidad con jsQR
  vendorizado (`src/lib/e14/masiva/identidad-qr.ts`).
- **Nota**: `tesseract.js` NO es dependencia del proyecto. Era el motor
  anterior del core (spa+eng OEM1, downscale 1600) y sobrevive solo
  como instrumento de laboratorio en los docs históricos (`docs/`).

Demo: https://jg-stevan.github.io/digielect14/
Motor: https://github.com/Jg-Stevan/web-scanner (packages/scanner-core → npm `@jg-stevan/scanner-core`)
Versión del motor consumida: ^0.4.0

## Desarrollo

    bun install
    bun run dev      # :3001
    bunx tsc --noEmit
    bun run lint
