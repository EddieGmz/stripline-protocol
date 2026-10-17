import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  CONTROL_BY_ID,
  CONTROLS,
  curveFromSamples,
  genericToNormalized,
  normalizedToGeneric,
  parseDisplayNumber,
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
    expect(snapValue(CONTROL_BY_ID['input.gain'], 99)).toBe(20);
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
  it('continuous control driving an inverted switch', () => {
    const d = CONTROL_BY_ID['comp.attack'];
    expect(genericToNormalized(d, m['comp.attack'], 1)).toBe(1); // short attack -> Fast on
    expect(genericToNormalized(d, m['comp.attack'], 25)).toBe(0);
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
