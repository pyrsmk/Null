/**
 * Converts an HTML hex color string (e.g. '#00ffff') to normalized RGB { r, g, b } (0–1).
 */
export function hexToRGB(hex) {
  const n = parseInt(hex.slice(1), 16);
  return { r: (n >> 16 & 0xff) / 255, g: (n >> 8 & 0xff) / 255, b: (n & 0xff) / 255 };
}
