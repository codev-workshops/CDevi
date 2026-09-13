export function hexToRgb(hex: string): [number, number, number];
export function luminance(hex: string): number;
export function contrastRatio(a: string, b: string): number;
export function resolveColor(tokens: unknown, ref: string, theme?: 'light' | 'dark'): string;
