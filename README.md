# stripline-protocol

The shared contract between the two halves of **Stripline**:

- **stripline-console** — the desktop app (Tauri + React) that shows every channel strip as a console.
- **stripline-bridge** — the plugin you put on each DAW track. It hosts a third-party channel strip (SSL, bx_console, CLA MixHub…), passes audio through it, and maps its parameters to Stripline's generic controls.

Both repos include this one as a git submodule at `protocol/`.

## What's in here

| Path | What it is |
|---|---|
| `schema/controls.json` | The 28 generic controls: stable id, section, label, range, default, step, unit and knob scale. **Ids never change.** |
| `schema/messages.schema.json` | Every WebSocket message between bridge and console (JSON Schema 2020-12). |
| `schema/profile.schema.json` | Mapping profiles: how each generic control drives one plugin's parameter. |
| `generated/ts/`, `generated/cpp/` | Types and tables generated from the schemas. Committed; never edit by hand. |
| `ts/` | TypeScript helpers: knob scales, value formatting, mapping math, calibration parsing. |
| `cpp/stripline/` | Header-only C++ mirror of the same helpers for the bridge. |
| `examples/` | Example messages and a profile showing every mapping type. |

## How the pieces talk

```
 DAW track                                        Stripline console (Tauri)
 ┌──────────────────────────────┐   WebSocket    ┌─────────────────────────┐
 │ Stripline bridge (VST3)       │ ─────────────▶ │ ws://127.0.0.1:9420     │
 │  ├─ hosts SSL / bx / CLA …   │  hello, values │                         │
 │  ├─ profile: generic ↔ param │  meters        │  console view           │
 │  └─ generic params (automation)│ ◀──────────── │  mapping editor         │
 └──────────────────────────────┘  set, learn,   └─────────────────────────┘
                                    loadProfile
```

- The **bridge connects** to the console; the console never connects to plugins.
- Control values always travel in **real units** (dB, Hz, ms, s, %, ratio). Only the bridge deals with the hosted plugin's 0..1 values, using the profile.
- `set` carries a `gesture` (`begin` / `change` / `end` / `single`) so the DAW records automation and undo correctly.
- Meters arrive about 30 times a second in dBFS.

## Mapping types

| Type | Use it when | Example |
|---|---|---|
| `continuous` + `linear`/`log` curve | The plugin's knob is a simple linear or log sweep | Gain, HPF |
| `continuous` + `table` curve | Anything else; built automatically by calibration | Most EQ frequencies |
| `stepped` | The plugin parameter has fixed positions | Compressor ratio 2:1 / 4:1 / 10:1 |
| `switch` | On/off parameter (`invert` flips it); a continuous control is split at its midpoint | Bell, Fast attack |
| `{ "available": false }` | The plugin has nothing equivalent | Mix on a strip without parallel compression |

## Working on it

```bash
npm install
npm run check        # generate + validate examples + typecheck + tests
cmake -S . -B build -DSTRIPLINE_PROTOCOL_TESTS=ON && cmake --build build && ./build/stripline_protocol_tests
```

Change a schema → run `npm run generate` → commit the schema and the generated files together. CI fails if they drift.

### Versioning

`protocolVersion` in `controls.json` goes up only for breaking changes (renamed fields, changed meaning). Adding a message type or an optional field is not breaking. Bridges and console exchange the version in `hello` / `welcome` and refuse a mismatch.
