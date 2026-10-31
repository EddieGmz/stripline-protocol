// Validates example messages and every profile (examples/ and the built-in profiles/) against the
// schemas, plus checks a schema can't express: control ids exist, strip slots resolve and fit,
// extras are unique and fit the bridge's slots, every shared control is covered by built-in profiles.
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv2020 from 'ajv/dist/2020.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => JSON.parse(readFileSync(join(root, p), 'utf8'));
const ajv = new Ajv2020({ allErrors: true, strict: false });
const validateMessage = ajv.compile(read('schema/messages.schema.json'));
const validateProfile = ajv.compile(read('schema/profile.schema.json'));
const { controls, extraSlots } = read('schema/controls.json');
const controlIds = new Set(controls.map((c) => c.id));

let failed = 0;
const report = (file, problems) => {
  if (!problems.length) console.log('ok  ', file);
  else {
    failed++;
    console.error('FAIL', file);
    problems.forEach((p) => console.error('     ', typeof p === 'string' ? p : JSON.stringify(p)));
  }
};

for (const f of readdirSync(join(root, 'examples/messages'))) {
  const p = `examples/messages/${f}`;
  report(p, validateMessage(read(p)) ? [] : validateMessage.errors);
}

function checkProfile(profile, builtIn) {
  const problems = [];
  if (!validateProfile(profile)) return validateProfile.errors;
  for (const k of Object.keys(profile.mappings)) if (!controlIds.has(k)) problems.push(`unknown control in mappings: ${k}`);
  const extras = profile.extras ?? [];
  const extraIds = new Set();
  for (const e of extras) {
    if (extraIds.has(e.id)) problems.push(`duplicate extra id: ${e.id}`);
    extraIds.add(e.id);
    if (e.kind === 'continuous' && !(e.min < e.max)) problems.push(`extra ${e.id}: needs min < max`);
    if (e.kind === 'stepped' && !e.steps) problems.push(`extra ${e.id}: stepped needs steps`);
  }
  if (extras.length > extraSlots) problems.push(`too many extras: ${extras.length} > ${extraSlots}`);
  // The strip: every slot names a control that exists; bottom-row slots fit in 4 characters.
  const used = new Set();
  const labelOf = (key) => {
    if (key.startsWith('x.')) return extras.find((e) => e.id === key.slice(2))?.label;
    return controls.find((c) => c.id === key)?.label;
  };
  const strip = profile.strip ?? {};
  const slot = (where, sl, bottom) => {
    const key = typeof sl === 'string' ? sl : sl.control;
    const ok = key.startsWith('x.') ? extraIds.has(key.slice(2)) : controlIds.has(key);
    if (!ok) return problems.push(`strip ${where}: unknown control ${key}`);
    if (used.has(key)) problems.push(`strip ${where}: ${key} is placed twice`);
    used.add(key);
    const label = (typeof sl === 'object' && sl.label) || labelOf(key) || '';
    if (bottom && label.length > 4) problems.push(`strip ${where}: label "${label}" of ${key} is longer than 4 characters (give the slot a label)`);
    const extra = key.startsWith('x.') ? extras.find((e) => e.id === key.slice(2)) : null;
    if (bottom && where.endsWith('buttons') && extra?.kind === 'stepped')
      for (const t of extra.steps) if (t.length > 4) problems.push(`strip ${where}: step "${t}" of ${key} is longer than 4 characters`);
  };
  (strip.global ?? []).forEach((sl) => slot('global', sl, false));
  for (const sid of ['in', 'filt', 'eq', 'comp', 'gate']) {
    (strip[sid]?.knobs ?? []).forEach((sl) => slot(`${sid}.knobs`, sl, true));
    (strip[sid]?.buttons ?? []).forEach((sl) => slot(`${sid}.buttons`, sl, true));
  }
  for (const key of Object.keys(strip.colors ?? {}))
    if (!(key.startsWith('x.') ? extraIds.has(key.slice(2)) : controlIds.has(key))) problems.push(`strip colors: unknown control ${key}`);
  if (builtIn) {
    for (const id of controlIds) if (!(id in profile.mappings)) problems.push(`built-in profile must map or mark unavailable: ${id}`);
    for (const e of extras) if (!used.has('x.' + e.id)) problems.push(`extra ${e.id} has no strip slot`);
    if (!profile.plugin.scan?.files?.length) problems.push('built-in profile needs plugin.scan.files');
  }
  return problems;
}

for (const f of readdirSync(join(root, 'examples/profiles'))) report(`examples/profiles/${f}`, checkProfile(read(`examples/profiles/${f}`), false));
const ids = new Set();
for (const f of readdirSync(join(root, 'profiles')).filter((n) => n.endsWith('.json'))) {
  const p = read(`profiles/${f}`);
  const problems = checkProfile(p, true);
  if (f !== `${p.id}.json`) problems.push(`file name must be ${p.id}.json`);
  if (ids.has(p.id)) problems.push(`duplicate profile id ${p.id}`);
  ids.add(p.id);
  report(`profiles/${f}`, problems);
}
if (failed) process.exit(1);
