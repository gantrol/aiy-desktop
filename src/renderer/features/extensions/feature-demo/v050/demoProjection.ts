export type Point = readonly [number, number];
export type Quad = readonly [Point, Point, Point, Point];
export const full: Quad = [
  [0, 0],
  [1920, 0],
  [1920, 1080],
  [0, 1080],
];
export const screen: Quad = [
  [298, 51],
  [1725, 27],
  [1718, 821],
  [285, 794],
];
export const paper: Quad = [
  [271.796473, 335.513775],
  [644.744131, 324.896768],
  [646.178235, 716.062578],
  [271.035981, 728.762699],
];
export const note: Quad = [
  [270, 300],
  [680, 300],
  [680, 755],
  [270, 755],
];
export const rect = (w: number, h: number): Quad => [
  [0, 0],
  [w, 0],
  [w, h],
  [0, h],
];
export const clamp = (n: number) => Math.max(0, Math.min(1, n));
export const ease = (n: number) => {
  const x = clamp(n);
  return x * x * x * (x * (x * 6 - 15) + 10);
};
export const between = (time: number, start: number, end: number) => ease((time - start) / (end - start));
export const mix = (a: number, b: number, t: number) => a + (b - a) * t;
export const mixQuad = (a: Quad, b: Quad, t: number): Quad =>
  a.map((p, i) => [mix(p[0], b[i][0], t), mix(p[1], b[i][1], t)]) as unknown as Quad;

/** Eight-parameter planar homography, returned in CSS's column-major matrix order. */
export function projection(from: Quad, to: Quad): string {
  const rows: number[][] = [];
  from.forEach(([x, y], i) => {
    const [u, v] = to[i];
    rows.push([x, y, 1, 0, 0, 0, -u * x, -u * y, u]);
    rows.push([0, 0, 0, x, y, 1, -v * x, -v * y, v]);
  });
  for (let i = 0; i < 8; i++) {
    let pivot = i;
    for (let j = i + 1; j < 8; j++) if (Math.abs(rows[j][i]) > Math.abs(rows[pivot][i])) pivot = j;
    [rows[i], rows[pivot]] = [rows[pivot], rows[i]];
    const divisor = rows[i][i];
    if (Math.abs(divisor) < 1e-10) throw new Error('DEMO_CAMERA_DEGENERATE');
    for (let j = i; j <= 8; j++) rows[i][j] /= divisor;
    for (let k = 0; k < 8; k++)
      if (k !== i) {
        const factor = rows[k][i];
        for (let j = i; j <= 8; j++) rows[k][j] -= factor * rows[i][j];
      }
  }
  const [a, b, c, d, e, f, g, h] = rows.map((row) => row[8]);
  return `matrix3d(${[a, d, 0, g, b, e, 0, h, 0, 0, 1, 0, c, f, 0, 1].join(',')})`;
}
