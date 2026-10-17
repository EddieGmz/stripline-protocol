// Validates every example message and profile against the schemas,
// and checks that profiles only map control ids that exist.
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv2020 from 'ajv/dist/2020.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => JSON.parse(readFileSync(join(root, p), 'utf8'));
const ajv = new Ajv2020({ allErrors: true, strict: false });
const validateMessage = ajv.compile(read('schema/messages.schema.json'));
const validateProfile = ajv.compile(read('schema/profile.schema.json'));
const controlIds = new Set(read('schema/controls.json').controls.map((c) => c.id));

let failed = 0;
const check = (file, ok, errors) => {
  if (ok) console.log('ok  ', file);
  else {
    failed++;
    console.error('FAIL', file, JSON.stringify(errors, null, 2));
  }
};

for (const f of readdirSync(join(root, 'examples/messages'))) {
  const p = `examples/messages/${f}`;
  check(p, validateMessage(read(p)), validateMessage.errors);
}
for (const f of readdirSync(join(root, 'examples/profiles'))) {
  const p = `examples/profiles/${f}`;
  const profile = read(p);
  const unknown = Object.keys(profile.mappings ?? {}).filter((k) => !controlIds.has(k));
  check(p, validateProfile(profile) && unknown.length === 0, validateProfile.errors ?? [{ unknownControls: unknown }]);
}
if (failed) process.exit(1);
