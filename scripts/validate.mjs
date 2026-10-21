// Validates example messages and every profile (examples/ and the built-in profiles/) against the
// schemas, plus checks a schema can't express: control ids exist, layout references resolve,
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
  const used = new Set();
  for (const [sid, sec] of Object.entries(profile.layout ?? {})) {
    for (const c of [...(sec.head ?? []), ...sec.items.filter((i) => 'control' in i)]) {
      const ok = c.control.startsWith('x.') ? extraIds.has(c.control.slice(2)) : controlIds.has(c.control);
      if (!ok) problems.push(`${sid}: layout refers to unknown control ${c.control}`);
      used.add(c.control);
    }
    for (const c of sec.items.filter((i) => 'control' in i)) {
      if (c.x === undefined || c.y === undefined) problems.push(`${sid}: ${c.control} needs x and y`);
      else if (c.x < 0 || c.x > 70) problems.push(`${sid}: ${c.control} x=${c.x} is outside the 108 px column`);
    }
  }
  if (builtIn) {
    for (const id of controlIds) if (!(id in profile.mappings)) problems.push(`built-in profile must map or mark unavailable: ${id}`);
    for (const e of extras) if (!used.has('x.' + e.id)) problems.push(`extra ${e.id} is never drawn`);
    if (!profile.plugin.scan?.files?.length) problems.push('built-in profile needs plugin.scan.files');
  }
  return problems;
}

for (const f of readdirSync(join(root, 'examples/profiles'))) report(`examples/profiles/${f}`, checkProfile(read(`examples/profiles/${f}`), false));
const ids = new Set();
for (const f of readdirSync(join(root, 'profiles'))) {
  const p = read(`profiles/${f}`);
  const problems = checkProfile(p, true);
  if (f !== `${p.id}.json`) problems.push(`file name must be ${p.id}.json`);
  if (ids.has(p.id)) problems.push(`duplicate profile id ${p.id}`);
  ids.add(p.id);
  report(`profiles/${f}`, problems);
}
if (failed) process.exit(1);
