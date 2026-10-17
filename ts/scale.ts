// Knob/fader position (0..1) <-> control value, matching each control's scale.
// Mirrors cpp/stripline/Scale.h. Keep the two in sync (tests cover both).
import type { ControlDef } from '../generated/ts/controls';

const clamp01 = (t: number) => (t < 0 ? 0 : t > 1 ? 1 : t);

export function clampValue(def: ControlDef, v: number): number {
  return v < def.min ? def.min : v > def.max ? def.max : v;
}

/** Rounds to the control's step (switches to 0/1) and clamps. */
export function snapValue(def: ControlDef, v: number): number {
  if (def.kind === 'switch') return v >= 0.5 ? 1 : 0;
  const s = def.step > 0 ? Math.round(v / def.step) * def.step : v;
  return clampValue(def, Number(s.toFixed(6)));
}

export function positionToValue(def: ControlDef, t: number): number {
  t = clamp01(t);
  if (def.kind === 'switch') return t >= 0.5 ? 1 : 0;
  switch (def.scale) {
    case 'log':
      return def.min * Math.pow(def.max / def.min, t);
    case 'fader':
      return def.min + (def.max - def.min) * Math.sqrt(t);
    default:
      return def.min + (def.max - def.min) * t;
  }
}

export function valueToPosition(def: ControlDef, v: number): number {
  if (def.kind === 'switch') return v >= 0.5 ? 1 : 0;
  v = clampValue(def, v);
  switch (def.scale) {
    case 'log':
      return clamp01(Math.log(v / def.min) / Math.log(def.max / def.min));
    case 'fader': {
      const l = (v - def.min) / (def.max - def.min);
      return clamp01(l * l);
    }
    default:
      return clamp01((v - def.min) / (def.max - def.min));
  }
}

/** Short display text, e.g. "+2.5", "1.20k", "4.0:1", "Off". */
export function formatValue(def: ControlDef, v: number): string {
  if (def.kind === 'switch') return v >= 0.5 ? 'On' : 'Off';
  const sign = (x: number) => (x > 0 ? '+' : '') + x.toFixed(1);
  switch (def.unit) {
    case 'Hz':
      if (def.id === 'filter.hpf' && v <= def.min) return 'Off';
      if (def.id === 'filter.lpf' && v >= def.max) return 'Off';
      return v < 1000 ? String(Math.round(v)) : (v / 1000).toFixed(v < 10000 ? 2 : 1) + 'k';
    case 'dB':
      if (def.id === 'gate.threshold' && v <= def.min) return 'Off';
      if (def.id === 'output.fader' && v <= def.min) return '−∞';
      return def.min >= 0 ? v.toFixed(1) : sign(v);
    case ':1':
      return v.toFixed(1) + ':1';
    case 'ms':
      return (v < 10 ? v.toFixed(1) : Math.round(v)) + 'ms';
    case 's':
      return v.toFixed(2) + 's';
    case '%':
      return Math.round(v) + '%';
    default:
      return v.toFixed(2);
  }
}
