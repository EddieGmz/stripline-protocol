// Converts a control value to a hosted plugin's normalized parameter value and back,
// following one mapping from a profile, and builds curves from a plugin's display text.
// Mirrors cpp/stripline/Mapping.h and cpp/stripline/Calibrate.h. Keep them in sync (tests cover both).
import type { ControlDef } from '../generated/ts/controls';
import type { Curve, Mapping, Step } from '../generated/ts/profile';

const clamp01 = (t: number) => (t < 0 ? 0 : t > 1 ? 1 : t);

type Mapped = Exclude<Mapping, { available: false }>;
type TableCurve = Extract<Curve, { kind: 'table' }>;
/** A curve the bridge can compute with ('auto' has been resolved to a table). */
export type ResolvedCurve = Exclude<Curve, { kind: 'auto' }>;

export function isMapped(m: Mapping | undefined): m is Mapped {
  return !!m && !('available' in m);
}

/** Plugin value (in the curve's units) for a normalized position. */
export function curveValueAt(curve: ResolvedCurve, n: number): number {
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
export function curvePositionOf(curve: ResolvedCurve, v: number): number {
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
    if (v >= Math.min(v0, v1) && v <= Math.max(v0, v1)) {
      return Math.abs(v1 - v0) < 1e-12 ? n0 : n0 + ((n1 - n0) * (v - v0)) / (v1 - v0);
    }
  }
  return 0;
}

/** The range of values a curve covers, low to high. */
export function curveRange(curve: ResolvedCurve): [number, number] {
  if (curve.kind !== 'table') return [Math.min(curve.min, curve.max), Math.max(curve.min, curve.max)];
  const vs = curve.points.map((p) => p[1]);
  return [Math.min(...vs), Math.max(...vs)];
}

function genericIsOn(def: ControlDef, v: number): boolean {
  return def.kind === 'switch' ? v >= 0.5 : v >= (def.min + def.max) / 2;
}

function nearestStep(steps: Step[], key: 'value' | 'normalized', x: number): Step {
  let best = steps[0];
  for (const s of steps) if (Math.abs(s[key] - x) < Math.abs(best[key] - x)) best = s;
  return best;
}

/**
 * Control value -> plugin normalized 0..1. Returns null when unmapped or not resolved yet
 * ('auto' curves and steps are resolved by the bridge when the plugin loads).
 * `count` is the number of positions of the control, for 'even' mappings.
 */
export function genericToNormalized(def: ControlDef, m: Mapping | undefined, v: number, count = 2): number | null {
  if (!isMapped(m)) return null;
  switch (m.type) {
    case 'continuous': {
      if (m.curve.kind === 'auto') return null;
      const n = def.kind === 'switch' ? (v >= 0.5 ? 1 : 0) : curvePositionOf(m.curve, v);
      return m.invert ? 1 - n : n;
    }
    case 'stepped':
      return m.steps ? nearestStep(m.steps, 'value', v).normalized : null;
    case 'switch': {
      const on = genericIsOn(def, v) !== !!m.invert;
      return on ? (m.on ?? 1) : (m.off ?? 0);
    }
    case 'even':
      return count > 1 ? clamp01(Math.round(v) / (count - 1)) : 0;
  }
}

/** Plugin normalized 0..1 -> control value. Returns null when unmapped or not resolved yet. */
export function normalizedToGeneric(def: ControlDef, m: Mapping | undefined, n: number, count = 2): number | null {
  if (!isMapped(m)) return null;
  switch (m.type) {
    case 'continuous': {
      if (m.curve.kind === 'auto') return null;
      const p = m.invert ? 1 - clamp01(n) : clamp01(n);
      return def.kind === 'switch' ? (p >= 0.5 ? 1 : 0) : curveValueAt(m.curve, p);
    }
    case 'stepped':
      return m.steps ? nearestStep(m.steps, 'normalized', n).value : null;
    case 'switch': {
      const on = (Math.abs(n - (m.on ?? 1)) <= Math.abs(n - (m.off ?? 0))) !== !!m.invert;
      if (def.kind === 'switch') return on ? 1 : 0;
      return on ? def.max : def.min;
    }
    case 'even':
      return count > 1 ? Math.round(clamp01(n) * (count - 1)) : 0;
  }
}

/** The first number in a display text: "3.20 kHz" -> 3200, "-12 dB" -> -12, "∞"/"inf" -> Infinity. */
export function parseDisplayNumber(text: string): number | null {
  const t = text.replace(/−/g, '-').replace(/,/g, '.');
  if (/∞|inf/i.test(t)) return Infinity;
  const m = t.match(/[-+]?(?:\d+(?:\.\d+)?|\.\d+)/);
  if (!m) return null;
  let v = parseFloat(m[0]);
  const rest = t.slice((m.index ?? 0) + m[0].length).trimStart();
  if (rest.startsWith('k') || rest.startsWith('K')) v *= 1000;
  return v;
}

/** Table curve from calibration samples: numeric samples only, kept while monotonic. */
export function curveFromSamples(samples: { normalized: number; text: string }[]): TableCurve | null {
  const pts = samples
    .map((s) => [s.normalized, parseDisplayNumber(s.text)] as const)
    .filter((p): p is readonly [number, number] => p[1] !== null && Number.isFinite(p[1]))
    .map(([n, v]) => [n, v]);
  if (pts.length < 2) return null;
  const rising = pts[pts.length - 1][1] >= pts[0][1];
  const mono = [pts[0]];
  for (let i = 1; i < pts.length; i++) {
    const last = mono[mono.length - 1][1];
    if (rising ? pts[i][1] >= last : pts[i][1] <= last) mono.push(pts[i]);
  }
  if (mono.length < 2 || mono[mono.length - 1][1] === mono[0][1]) return null;
  return { kind: 'table', points: mono };
}

/**
 * Steps from the display text at each position of a stepped parameter. Texts without a number
 * (OFF, AUTO, VAR) take the control's min when first, max when last, else the value between neighbours.
 */
export function stepsFromTexts(positions: { normalized: number; text: string }[], min: number, max: number): Step[] {
  const vals = positions.map((p) => {
    const v = parseDisplayNumber(p.text);
    return v === Infinity ? max : v;
  });
  return positions.map((p, i) => {
    let v = vals[i];
    if (v === null) {
      if (i === 0) v = min;
      else if (i === vals.length - 1) v = max;
      else {
        const prev = vals.slice(0, i).reverse().find((x) => x !== null) ?? min;
        const next = vals.slice(i + 1).find((x) => x !== null) ?? max;
        v = (prev + next) / 2;
      }
      vals[i] = v;
    }
    return { normalized: p.normalized, value: v, text: p.text };
  });
}
