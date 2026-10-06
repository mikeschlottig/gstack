import { FORMATS, type FormatId } from '../../shared/contract';

export interface Layout {
  /** Scale unit: 1.0 at 1080px on the short side. */
  u: number;
  width: number;
  height: number;
  vertical: boolean;
  /** Horizontal / vertical padding in px, with platform UI safe-zone applied at the bottom. */
  padX: number;
  padTop: number;
  padBottom: number;
  /** Max content width in px. */
  maxW: number;
}

export function makeLayout(format: FormatId): Layout {
  const { width, height, safeBottom } = FORMATS[format];
  const u = Math.min(width, height) / 1080;
  const vertical = height > width;
  const padX = Math.round((vertical ? 84 : 160) * u);
  return {
    u,
    width,
    height,
    vertical,
    padX,
    padTop: Math.round(150 * u),
    padBottom: Math.round(height * safeBottom + 90 * u),
    maxW: width - padX * 2,
  };
}

/** Headline-style size that steps down as the text gets longer. */
export function fitSize(text: string, sizes: [number, number, number], breaks: [number, number], u: number): number {
  const n = text.length;
  const px = n <= breaks[0] ? sizes[0] : n <= breaks[1] ? sizes[1] : sizes[2];
  return Math.round(px * u);
}
