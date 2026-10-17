// Converts a generic control value (real units) to a hosted plugin's normalized
// parameter value and back, following one mapping from a profile.
// Mirrors cpp/stripline/Mapping.h. Keep the two in sync (tests cover both).
import type { ControlDef } from '../generated/ts/controls';
import type { Curve, Mapping } from '../generated/ts/profile';

const clamp01 = (t: number) => (t < 0 ? 0 : t > 1 ? 1 : t);

export function isMapped(m: Mapping | undefined): m is Exclude<Mapping, { available: false }> {
  return !!m && !('available' in m);
}

/** Plugin value (in the curve's units) for a normalized position. */
export function curveValueAt(curve: Curve, n: number): number {
  n = clamp01(n);
  if (curve.kind === 'linear') return curve.min + (curve.max - curve.min) * n;
  if (curve.kind === 'log') return curve.min * Math.pow(curve.max / curve.min, n);
  const pts = curve.points;
  if (n <= pts[0][0]) return pts[0][1];
  for (let i = 1; i < pts.length; i++) {
    const [n1, v1] = pts[i];
    if (n <= n1) {
      const [n0, v0] = pts[i - 1];
      return n1 === n0 ? v1 : v0 + ((v1 - v0) * (n - n0)) / (n1 - n0);
    }
  }
  return pts[pts.length - 1][1];
}

/** Normalized position for a plugin value. Values outside the curve clamp to its ends. */
export function curvePositionOf(curve: Curve, v: number): number {
  if (curve.kind === 'linear') return clamp01((v - curve.min) / (curve.max - curve.min));
  if (curve.kind === 'log') return clamp01(Math.log(v / curve.min) / Math.log(curve.max / curve.min));
  const pts = curve.points;
  const rising = pts[pts.length - 1][1] >= pts[0][1];
  const lo = rising ? pts[0] : pts[pts.length - 1];
  const hi = rising ? pts[pts.length - 1] : pts[0];
  if (v <= lo[1]) return lo[0];
  if (v >= hi[1]) return hi[0];
  for (let i = 1; i < pts.length; i++) {
    const [n0, v0] = pts[i - 1];
    const [n1, v1] = pts[i];
    if ((v >= Math.min(v0, v1)) && (v <= Math.max(v0, v1))) {
      return v1 === v0 ? n0 : n0 + ((n1 - n0) * (v - v0)) / (v1 - v0);
    }
  }
  return 0;
}

/** True when the generic value counts as "on" for a switch target. */
function genericIsOn(def: ControlDef, v: number): boolean {
  return def.kind === 'switch' ? v >= 0.5 : v >= (def.min + def.max) / 2;
}

/** Generic value -> plugin normalized 0..1. Returns null for unmapped controls. */
export function genericToNormalized(def: ControlDef, m: Mapping | undefined, v: number): number | null {
  if (!isMapped(m)) return null;
  switch (m.type) {
    case 'continuous': {
      const n = def.kind === 'switch' ? (v >= 0.5 ? 1 : 0) : curvePositionOf(m.curve, v);
      return m.invert ? 1 - n : n;
    }
    case 'stepped': {
      let best = m.steps[0];
      for (const s of m.steps) if (Math.abs(s.value - v) < Math.abs(best.value - v)) best = s;
      return best.normalized;
    }
    case 'switch': {
      const on = genericIsOn(def, v) !== !!m.invert;
      return on ? (m.on ?? 1) : (m.off ?? 0);
    }
  }
}

/** Plugin normalized 0..1 -> generic value. Returns null for unmapped controls. */
export function normalizedToGeneric(def: ControlDef, m: Mapping | undefined, n: number): number | null {
  if (!isMapped(m)) return null;
  switch (m.type) {
    case 'continuous': {
      const p = m.invert ? 1 - clamp01(n) : clamp01(n);
      return def.kind === 'switch' ? (p >= 0.5 ? 1 : 0) : curveValueAt(m.curve, p);
    }
    case 'stepped': {
      let best = m.steps[0];
      for (const s of m.steps) if (Math.abs(s.normalized - n) < Math.abs(best.normalized - n)) best = s;
      return best.value;
    }
    case 'switch': {
      const onN = m.on ?? 1;
      const offN = m.off ?? 0;
      const on = (Math.abs(n - onN) <= Math.abs(n - offN)) !== !!m.invert;
      if (def.kind === 'switch') return on ? 1 : 0;
      return on ? def.max : def.min;
    }
  }
}

/** Pulls the first number out of a plugin's display text ("3.20 kHz" -> 3200, "-12 dB" -> -12). */
export function parseDisplayNumber(text: string): number | null {
  const m = text.replace(',', '.').match(/[-+−]?\d+(?:\.\d+)?/);
  if (!m) return null;
  let v = parseFloat(m[0].replace('−', '-'));
  const rest = text.slice((m.index ?? 0) + m[0].length).trim().toLowerCase();
  if (rest.startsWith('k')) v *= 1000; // "kHz", "k"
  return v;
}

/** Builds a table curve from calibration samples, dropping samples without a number. */
export function curveFromSamples(samples: { normalized: number; text: string }[]): Curve | null {
  const points = samples
    .map((s) => [s.normalized, parseDisplayNumber(s.text)] as const)
    .filter((p): p is readonly [number, number] => p[1] !== null)
    .map(([n, v]) => [n, v]);
  if (points.length < 2) return null;
  points.sort((a, b) => a[0] - b[0]);
  return { kind: 'table', points };
}
