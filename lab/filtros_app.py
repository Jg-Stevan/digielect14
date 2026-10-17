# -*- coding: utf-8 -*-
"""filtros_app.py — Variantes ORIGINAL / TEXTO-CLARO / GRIS con la matemática
EXACTA de los filtros del app (kit FILTROS-1 §2.4).

FUENTE 1:1 (replicada, no importable desde Python — el app la ejecuta en el
worker WASM):  `public/scanner/detection-worker.js` de ESTE repo (digielect14),
funciones `enhanceToRgba` (L1062) y helpers:
  · rgbaToGray (L752)             — luma 77/150/29 >> 8
  · estimateShadowModel (L865)    — mapa de iluminación: downscl 800 + close
                                    morfológico k=25 (separable filas/cols)
  · correctedGrayWithModel (L894) — aplicación BILINEAR del mapa de ganancias
  · whitePointStretchPct (L585)   — estiramiento por percentil blanco
  · textTargetLumaLut (L632)      — LUT sigmoidal tinta/fondo (256)
  · edgeAwareSharpenGray (L657)   — afilado selectivo grad>25 · luma<240
  · rebuildRgbaWithChroma (L697)  — reconstrucción RGBA preservando croma
  · grayToRgba (L761)             — gris → RGBA
Constantes (L440-451, L648-695): TEXT_CLARO_WHITE_PCT=0.95 · CONTRAST=1.45 ·
PIVOT=0.82 · BLACK_POINT=0.15 · ILLUM_MAP_LONG_SIDE=800 · TEXT_EDGE_GRADIENT=25
· TEXT_EDGE_AMOUNT=0.75 · TEXT_WHITE_TARGET=253 · TEXT_NEUTRAL_INK=45 ·
TEXT_CHROMA_FADE_START=200 · TEXT_CHROMA_MAX_GAIN=1.5.
El propio worker declara: «Espejo EXACTO de las funciones puras de
src/lib/scanner/image-modes.ts — worker y fallback comparten la MISMA
matemática (contrato §4.2)».

Mapeo de filtros del producto → modos del worker (image-processor.ts
filterToEnhanceMode, L68): original → "raw" · texto-claro ("text") → "text" ·
gris → "gray" (modo gray del mismo enhanceToRgba; el informe §D8.3 ya usaba
«grayscale de la variante gray derivado por luma del original»).

Redondeo: JS asigna a Uint8ClampedArray / Math.round (half-up); aquí
_floor_half_up(v) = floor(v + 0.5) para v ≥ 0, equivalente bit a bit en
el rango 0-255 (ambos IEEE-754 double).
"""

from __future__ import annotations

import math
import numpy as np

# ─── Constantes (detection-worker.js) ───────────────────────────────────────

TEXT_CLARO_WHITE_PCT = 0.95
TEXT_CLARO_CONTRAST = 1.45
TEXT_CLARO_PIVOT = 0.82
TEXT_CLARO_BLACK_POINT = 0.15

ILLUM_MAP_LONG_SIDE = 800
FF_FLOOR_DEFAULT = 40  # (solo flatField; el app usa estimateShadowModel)

TEXT_EDGE_GRADIENT = 25
TEXT_EDGE_AMOUNT = 0.75

TEXT_WHITE_TARGET = 253
TEXT_NEUTRAL_INK = 45
TEXT_CHROMA_FADE_START = 200
TEXT_CHROMA_MAX_GAIN = 1.5


def _r(v):
    """Math.round / Uint8ClampedArray (half-up, v ≥ 0)."""
    return math.floor(v + 0.5)


# ─── rgbaToGray (L752) ──────────────────────────────────────────────────────


def rgba_to_gray(rgba: np.ndarray) -> np.ndarray:
    """(r*77 + g*150 + b*29) >> 8 — aritmética entera idéntica."""
    r = rgba[..., 0].astype(np.uint32)
    g = rgba[..., 1].astype(np.uint32)
    b = rgba[..., 2].astype(np.uint32)
    return ((r * 77 + g * 150 + b * 29) >> 8).astype(np.uint8)


def gray_to_rgba(gray: np.ndarray) -> np.ndarray:
    """grayToRgba (L761)."""
    h, w = gray.shape
    out = np.zeros((h, w, 4), dtype=np.uint8)
    out[..., 0] = gray
    out[..., 1] = gray
    out[..., 2] = gray
    out[..., 3] = 255
    return out


# ─── Mapa de iluminación (L817-912) ─────────────────────────────────────────


def _sliding_minmax_1d_rowwise(m: np.ndarray, k: int, is_max: bool) -> np.ndarray:
    """slidingMinMax1D aplicado por filas (causal + half ≡ ventana centrada,
    índices clampeados al borde — ver comentario de la función JS)."""
    n = m.shape[1]
    half = (k - 1) >> 1
    out = np.empty_like(m)
    for i in range(n):
        e = min(n - 1, i + half)
        win = m[:, max(0, i - k + 1) : e + 1]
        out[:, i] = win.max(axis=1) if is_max else win.min(axis=1)
    return out


def _sliding_minmax_1d_colwise(m: np.ndarray, k: int, is_max: bool) -> np.ndarray:
    n = m.shape[0]
    half = (k - 1) >> 1
    out = np.empty_like(m)
    for i in range(n):
        e = min(n - 1, i + half)
        win = m[max(0, i - k + 1) : e + 1, :]
        out[i, :] = win.max(axis=0) if is_max else win.min(axis=0)
    return out


def _morph_close(map_: np.ndarray, k: int) -> np.ndarray:
    """morphClose (L822): max filas → max cols (dilate) → min filas → min cols
    (erode). Kernel k×k separable, bordes replicados."""
    hmax = _sliding_minmax_1d_rowwise(map_, k, True)
    dil = _sliding_minmax_1d_colwise(hmax, k, True)
    hmin = _sliding_minmax_1d_rowwise(dil, k, False)
    return _sliding_minmax_1d_colwise(hmin, k, False)


def _estimate_illumination_map(gray: np.ndarray):
    """estimateIlluminationMap (L854): downscl long-side 800 + close k=25."""
    h, w = gray.shape
    scale = min(1.0, ILLUM_MAP_LONG_SIDE / max(w, h))
    mw = max(1, round(w * scale))
    mh = max(1, round(h * scale))
    ys = np.minimum(h - 1, (np.arange(mh) + 0.5) * h // mh).astype(int)
    xs = np.minimum(w - 1, (np.arange(mw) + 0.5) * w // mw).astype(int)
    reduced = gray[np.ix_(ys, xs)].astype(np.float64)
    kernel = max(3, math.floor(ILLUM_MAP_LONG_SIDE / 32))
    if kernel % 2 == 0:
        kernel = kernel - 1
    map_ = reduced if mw * mh <= 1 else _morph_close(reduced, kernel)
    return map_, mw, mh


def estimate_shadow_model(gray: np.ndarray):
    """estimateShadowModel (L865): gains = mean(map)/map + índices de muestreo."""
    map_, mw, mh = _estimate_illumination_map(gray)
    mean = map_.mean() if map_.size else 255.0
    gains = np.where(map_ > 0, mean / np.maximum(map_, 1e-9), 1.0).astype(np.float32)
    return {"gains": gains, "mw": mw, "mh": mh}


def corrected_gray_with_model(gray: np.ndarray, model) -> np.ndarray:
    """correctedGrayWithModel (L894): muestreo BILINEAR del mapa de ganancias."""
    h, w = gray.shape
    gains = model["gains"]
    if gains.ndim == 1:
        mw = model["mw"] if model["mw"] > 0 else 1
        gains = gains.reshape(max(1, gains.shape[0] // mw), mw)
    mh, mw = gains.shape
    fx = np.arange(w) * mw / w
    x0 = np.minimum(mw - 1, np.floor(fx)).astype(int)
    x1 = np.minimum(mw - 1, x0 + 1)
    tx = np.clip(fx - x0, 0, 1)
    fy = np.arange(h) * mh / h
    y0 = np.minimum(mh - 1, np.floor(fy)).astype(int)
    y1 = np.minimum(mh - 1, y0 + 1)
    ty = np.clip(fy - y0, 0, 1)
    g00 = gains[np.ix_(y0, x0)]
    g01 = gains[np.ix_(y0, x1)]
    g10 = gains[np.ix_(y1, x0)]
    g11 = gains[np.ix_(y1, x1)]
    top = g00 + (g01 - g00) * tx[None, :]
    bottom = g10 + (g11 - g10) * tx[None, :]
    gain = top + (bottom - top) * ty[:, None]
    out = gray.astype(np.float64) * gain
    return np.clip(np.floor(out + 0.5), 0, 255).astype(np.uint8)


# ─── Estiramiento de punto blanco (L585) ────────────────────────────────────


def white_point_stretch_pct(gray: np.ndarray, pct: float) -> np.ndarray:
    h, w = gray.shape
    n = h * w
    if n <= 0:
        return gray.copy()
    p = min(1.0, max(0.0, pct))
    hist = np.bincount(gray.ravel(), minlength=256)
    target = math.ceil(n * p)
    acc = np.cumsum(hist)
    pivot = 255
    for v in range(256):
        if acc[v] >= target:
            pivot = v
            break
    if pivot <= 0:
        return gray.copy()
    scale = 255.0 / pivot
    out = np.floor(gray.astype(np.float64) * scale + 0.5)
    return np.minimum(out, 255).astype(np.uint8)


# ─── F-TEXT-CLEAN: LUT sigmoidal (L632) ─────────────────────────────────────


def text_target_luma_lut(contrast=TEXT_CLARO_CONTRAST, pivot=TEXT_CLARO_PIVOT, bp=TEXT_CLARO_BLACK_POINT):
    lut = np.zeros(256, dtype=np.uint8)
    p = min(0.99, max(0.01, pivot))
    knee = min(p, max(0.0, bp))
    for idx in range(256):
        v = idx / 255.0
        if v >= p:
            t = (v - p) / (1 - p)
            smooth = p + (1 - p) * (t * t * (3 - 2 * t))
            lut[idx] = 255 if smooth > 0.92 else _r(smooth * 255)
        else:
            ink_val = math.pow(v / p, contrast) * p
            if ink_val < knee:
                ink_val = max(0.0, ink_val * (ink_val / knee))
            lut[idx] = _r(ink_val * 255)
    return lut


# ─── Afilado selectivo en bordes (L657) ─────────────────────────────────────


def edge_aware_sharpen_gray(src: np.ndarray) -> np.ndarray:
    h, w = src.shape
    out = src.copy()
    if h < 3 or w < 3:
        return out
    s = src.astype(np.float64)
    grad = np.abs(s[1:-1, 2:] - s[1:-1, :-2]) + np.abs(s[2:, 1:-1] - s[:-2, 1:-1])
    c = s[1:-1, 1:-1]
    mask = (grad > TEXT_EDGE_GRADIENT) & (c < 240)
    lap = (s[1:-1, :-2] + s[1:-1, 2:] + s[:-2, 1:-1] + s[2:, 1:-1]) * 0.25 - c
    val = np.clip(np.floor(c - lap * TEXT_EDGE_AMOUNT + 0.5), 0, 255)
    core = np.where(mask, val, c)
    out[1:-1, 1:-1] = core.astype(np.uint8)
    return out


# ─── Reconstrucción RGBA con croma (L697) ───────────────────────────────────


def rebuild_rgba_with_chroma(rgba: np.ndarray, gray: np.ndarray, target_luma: np.ndarray) -> np.ndarray:
    h, w = gray.shape
    out = np.zeros((h, w, 4), dtype=np.uint8)
    tgt = target_luma.astype(np.int32)
    srcL = gray.astype(np.float64)

    white = tgt >= TEXT_WHITE_TARGET
    scale = np.where(srcL > 5, tgt / np.maximum(srcL, 1e-9), 1.0)
    r = np.floor(rgba[..., 0].astype(np.float64) * scale + 0.5)
    g = np.floor(rgba[..., 1].astype(np.float64) * scale + 0.5)
    b = np.floor(rgba[..., 2].astype(np.float64) * scale + 0.5)
    r = np.minimum(r, 255)
    g = np.minimum(g, 255)
    b = np.minimum(b, 255)

    fade = (tgt > TEXT_CHROMA_FADE_START) & ~white
    if fade.any():
        keep = np.clip((TEXT_WHITE_TARGET - tgt) / (TEXT_WHITE_TARGET - TEXT_CHROMA_FADE_START), 0, 1)
        r = np.where(fade, np.floor(tgt + (r - tgt) * keep), r)
        g = np.where(fade, np.floor(tgt + (g - tgt) * keep), g)
        b = np.where(fade, np.floor(tgt + (b - tgt) * keep), b)

    deep = scale > TEXT_CHROMA_MAX_GAIN
    if deep.any():
        dkeep = TEXT_CHROMA_MAX_GAIN / np.maximum(scale, 1e-9)
        r = np.where(deep, np.floor(tgt + (r - tgt) * dkeep), r)
        g = np.where(deep, np.floor(tgt + (g - tgt) * dkeep), g)
        b = np.where(deep, np.floor(tgt + (b - tgt) * dkeep), b)

    ink = tgt < TEXT_NEUTRAL_INK
    if ink.any():
        blend = tgt / TEXT_NEUTRAL_INK
        rr = np.floor(r * blend + tgt * (1 - blend) + 0.5)
        gg = np.floor(g * blend + tgt * (1 - blend) + 0.5)
        bb = np.floor(b * blend + tgt * (1 - blend) + 0.5)
        r, g, b = np.where(ink, rr, r), np.where(ink, gg, g), np.where(ink, bb, b)

    out[..., 0] = np.clip(r, 0, 255).astype(np.uint8)
    out[..., 1] = np.clip(g, 0, 255).astype(np.uint8)
    out[..., 2] = np.clip(b, 0, 255).astype(np.uint8)
    out[..., 3] = 255
    return out


# ─── API de los 3 filtros del producto ──────────────────────────────────────


def filtro_original(rgba: np.ndarray) -> np.ndarray:
    """'original' → modo "raw" del worker: copia as-is con alpha=255 (L1065)."""
    out = rgba.copy()
    out[..., 3] = 255
    return out


def _texto_claro_base(rgba: np.ndarray):
    gray = rgba_to_gray(rgba)
    shadow = estimate_shadow_model(gray)
    gray_s = corrected_gray_with_model(gray, shadow)
    return rgba, gray, gray_s


def filtro_texto_claro(rgba: np.ndarray) -> np.ndarray:
    """'texto-claro' → modo "text" del worker (F-TEXT-CLEAN, L1095-1113)."""
    rgba, gray, gray_s = _texto_claro_base(rgba)
    wp = white_point_stretch_pct(gray_s, TEXT_CLARO_WHITE_PCT)
    lut = text_target_luma_lut()
    target_luma = lut[wp]
    sharp = edge_aware_sharpen_gray(target_luma)
    return rebuild_rgba_with_chroma(rgba, gray, sharp)


def filtro_gris(rgba: np.ndarray) -> np.ndarray:
    """'gris' → modo "gray" del worker (L1091-1094)."""
    _, _, gray_s = _texto_claro_base(rgba)
    wp = white_point_stretch_pct(gray_s, 0.97)
    return gray_to_rgba(wp)


FILTROS = {"original": filtro_original, "texto-claro": filtro_texto_claro, "gris": filtro_gris}


def aplicar_filtro(rgb: np.ndarray, filtro: str) -> np.ndarray:
    """Entrada RGB uint8 (H,W,3) → RGBA filtrado → RGB (H,W,3).
    El OCR y el JPEG solo consumen 3 canales; alpha siempre 255 aquí."""
    h, w = rgb.shape[:2]
    rgba = np.dstack([rgb, np.full((h, w), 255, dtype=np.uint8)])
    res = FILTROS[filtro](rgba)
    return res[..., :3]
