import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  CONTROL_BY_ID,
  CONTROLS,
  curveFromSamples,
  genericToNormalized,
  normalizedToGeneric,
  parseDisplayNumber,
  stepsFromTexts,
  positionToValue,
  snapValue,
  valueToPosition,
  type StriplineProfile,
} from '../ts';

const profile: StriplineProfile = JSON.parse(
  readFileSync(new URL('../examples/profiles/example.channel-strip.json', import.meta.url), 'utf8'),
);

describe('scale', () => {
  it('round-trips every control through position and back', () => {
    for (const c of CONTROLS) {
      for (const t of [0, 0.1, 0.37, 0.5, 0.9, 1]) {
        const v = positionToValue(c, t);
        if (c.kind === 'switch') continue;
        expect(valueToPosition(c, v)).toBeCloseTo(t, 5);
      }
    }
  });
  it('puts 0 dB on the fader at the expected position', () => {
    expect(valueToPosition(CONTROL_BY_ID['output.fader'], 0)).toBeCloseTo((60 / 72) ** 2, 5);
  });
  it('snaps to step and range', () => {
    expect(snapValue(CONTROL_BY_ID['input.gain'], 2.26)).toBe(2.5);
    expect(snapValue(CONTROL_BY_ID['input.gain'], 99)).toBe(70);
  });
});

describe('mapping', () => {
  const m = profile.mappings;
  it('linear curve', () => {
    expect(genericToNormalized(CONTROL_BY_ID['input.gain'], m['input.gain'], 0)).toBeCloseTo(0.5);
    expect(normalizedToGeneric(CONTROL_BY_ID['input.gain'], m['input.gain'], 0.75)).toBeCloseTo(10);
  });
  it('log curve clamps to the plugin range', () => {
    expect(genericToNormalized(CONTROL_BY_ID['filter.hpf'], m['filter.hpf'], 500)).toBe(1);
  });
  it('table curve interpolates both ways', () => {
    const d = CONTROL_BY_ID['eq.lmf.freq'];
    expect(genericToNormalized(d, m['eq.lmf.freq'], 700)).toBeCloseTo(0.5);
    expect(genericToNormalized(d, m['eq.lmf.freq'], 520)).toBeCloseTo(0.375);
    expect(normalizedToGeneric(d, m['eq.lmf.freq'], 0.375)).toBeCloseTo(520);
  });
  it('stepped snaps to the nearest value', () => {
    const d = CONTROL_BY_ID['comp.ratio'];
    expect(genericToNormalized(d, m['comp.ratio'], 4.4)).toBe(0.5);
    expect(normalizedToGeneric(d, m['comp.ratio'], 0.52)).toBe(4);
  });
  it('even mapping for stepped extras', () => {
    const knee = profile.extras![1];
    const d = CONTROL_BY_ID['comp.ratio']; // def is not used by 'even'
    expect(genericToNormalized(d, knee.mapping, 1, 3)).toBe(0.5);
    expect(normalizedToGeneric(d, knee.mapping, 0.9, 3)).toBe(2);
  });
  it('auto curves and steps stay unresolved until the bridge reads the plugin', () => {
    expect(genericToNormalized(CONTROL_BY_ID['filter.lpf'], m['filter.lpf'], 8000)).toBeNull();
    expect(genericToNormalized(CONTROL_BY_ID['eq.hmf.freq'], m['eq.hmf.freq'], 3000)).toBeNull();
  });
  it('unavailable and missing mappings return null', () => {
    expect(genericToNormalized(CONTROL_BY_ID['comp.mix'], m['comp.mix'], 50)).toBeNull();
    expect(genericToNormalized(CONTROL_BY_ID['gate.range'], m['gate.range'], 50)).toBeNull();
  });
});

describe('calibration', () => {
  it('parses display text', () => {
    expect(parseDisplayNumber('3.20 kHz')).toBe(3200);
    expect(parseDisplayNumber('-12.5 dB')).toBe(-12.5);
    expect(parseDisplayNumber('Off')).toBeNull();
    expect(parseDisplayNumber('∞:1')).toBe(Infinity);
    expect(parseDisplayNumber('\u221212.0 dB')).toBe(-12);
    expect(parseDisplayNumber('.75s')).toBe(0.75);
    expect(parseDisplayNumber('oo : 1')).toBe(Infinity);
    expect(parseDisplayNumber('-oo')).toBe(-Infinity);
    expect(parseDisplayNumber('Boost 3 dB')).toBe(3); // "oo" inside a word is not infinity
    expect(parseDisplayNumber('308 ms', 's')).toBeCloseTo(0.308);
    expect(parseDisplayNumber('1.50 s', 'ms')).toBe(1500);
  });

  it('reads knobs that switch from ms to s on one scale', () => {
    const c = curveFromSamples(['20 ms', '144 ms', '308 ms', '1.50 s', '4.00 s'].map((text, i) => ({ normalized: i / 4, text })));
    expect(c?.points.map((p) => p[1])).toEqual([20, 144, 308, 1500, 4000]);
    const s = curveFromSamples(['20 ms', '308 ms', '1.50 s'].map((text, i) => ({ normalized: i / 2, text })), 's');
    expect(s?.points[2][1]).toBe(1.5);
    expect(s?.points[1][1]).toBeCloseTo(0.308);
  });
  it('builds steps from display text, filling OFF/AUTO/∞', () => {
    const steps = stepsFromTexts(
      ['OFF', '45 Hz', '70 Hz', 'AUTO', '360 Hz', '∞'].map((text, i) => ({ normalized: i / 5, text })),
      10,
      1000,
    );
    expect(steps.map((s) => s.value)).toEqual([10, 45, 70, 215, 360, 1000]);
  });
  it('drops samples that break monotonicity', () => {
    const c = curveFromSamples(['20 Hz', '100 Hz', 'Off', '1.00 kHz', '900 Hz', '16 kHz'].map((text, i) => ({ normalized: i / 5, text })));
    expect(c?.points.map((p) => p[1])).toEqual([20, 100, 1000, 16000]);
  });
  it('builds a table curve and skips non-numeric samples', () => {
    const c = curveFromSamples([
      { normalized: 0, text: 'Off' },
      { normalized: 0.5, text: '1.00 kHz' },
      { normalized: 1, text: '16 kHz' },
    ]);
    expect(c).toEqual({ kind: 'table', points: [[0.5, 1000], [1, 16000]] });
  });
});
