# stripline-protocol

The shared contract between the two halves of **Stripline**:

- **stripline-console** — the desktop app (Tauri + React) that shows every channel strip as a console.
- **stripline-bridge** — the plugin you put on each DAW track. It hosts a third-party channel strip (SSL, bx_console, CLA MixHub…), passes audio through it, and maps its parameters to Stripline's generic controls.

Both repos include this one as a git submodule at `protocol/`.

## What's in here

| Path | What it is |
|---|---|
| `schema/controls.json` | The 36 shared controls: stable id, section, label, range, default, step, unit and knob scale, plus the number of extra slots (32). **Ids never change.** |
| `schema/messages.schema.json` | Every WebSocket message between bridge and console (JSON Schema 2020-12). |
| `schema/profile.schema.json` | Profiles: how to find a plugin, how its parameters map to shared and extra controls, and how it fills the console's base strip (global buttons, extra slots, colours). |
| `profiles/` | Built-in profiles, shipped inside the bridge: UADx API Vision Channel Strip, Lindell 80 Channel, Lindell 50 Channel, bx_console Focusrite SC, bx_console N, CLA MixHub, White Channel. Verified against each plugin's own parameter list. |
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
- **Knobs travel as the plugin parameter's own 0..1 position**, passed straight through like a MIDI-learned knob:
  the plugin applies its own curve and steps, and the bridge sends the plugin's own text for each knob
  (`positions`, `texts`, `defaults` in `hello`; `texts` in `values`). A profile only says which plugin parameter
  goes on which knob (and `invert`). The fader stays in dB and switches in 0/1; older bridges send everything in
  real units.
- `set` carries a `gesture` (`begin` / `change` / `end` / `single`) so the DAW records automation and undo correctly.
- Meters arrive about 30 times a second in dBFS.
- **In REAPER** the bridge reaches REAPER's API through its VST3 host interface and says so in `hello`
  (`capabilities: ["reaper"]`). It then reports the track's position, mute and solo in `track` (and in `trackInfo`
  when they change), accepts `trackCommand` (mute, solo) and `transportCommand` (play, stop, pause, record, repeat,
  rewind/forward while held), and, while the console sends it `watchTransport`, reports the transport in `transport`
  messages. Without it, the console falls back to REAPER's OSC for the transport.

## The base strip

Every plugin is drawn on the same strip, so the console looks and works the same whatever is loaded:

| Part | Holds |
|---|---|
| top (fixed) | track name, meter, up to **6 global buttons** (polarity, pad, EQ before dynamics, sidechain routing…) |
| **IN** | LINE (`input.trim`), PRE (`input.gain`); engaged by `input.in` |
| **FILT** | HPF, LPF; engaged by `filter.in` |
| **EQ** | 4 bands (HIGH, HI MID, LO MID, LOW), each GAIN, FREQ, Q; HIGH and LOW also BELL; engaged by `eq.in` |
| **COMP** | RATIO, THRSH, RLASE, ATTACK; engaged by `dyn.in` |
| **GATE** | RANGE, THRSH, RLASE, RATIO, EXP; engaged by `gate.in` |
| bottom (fixed) | fader, mute, solo |

Each section ends with two rows of 4 slots, one of small knobs and one of small buttons (4 characters at most), for controls
only that plugin has. A base control the plugin lacks (`{"available": false}`) and an unused slot are drawn disabled.

## What a profile holds (v3)

- **plugin**: name (also matches names that start with it, e.g. "CLA MixHub Stereo"), aliases, vendor, and **scan** hints: file name substrings, whether it lives in a shell file (Waves), and a scan timeout.
- **mappings**: one per shared control, or `{ "available": false }`.
- **extras**: up to 32 controls only this plugin has (Thrust, Knee, NIVEAU…). Each gets one of the bridge's extra automation slots, named after it. Values travel as `x.<id>`.
- **strip**: the plugin's global buttons (up to 6) and, per section, its bottom-row knobs and buttons (up to 4 each); a slot names a shared control or `x.<extra>` and may give it a short label. Plus per-control cap, arc and lit colours.
- **skin**: panel, text, knob and button colours sampled from the plugin. Colours only; no logos or artwork.

Parameters are found by id, then index, then name; `name` may list several candidates, matched ignoring case, then by prefix.
`auto` curves and `auto` steps are read from the plugin when it loads: the bridge samples the plugin's own display text and
parses the numbers ("3.20 kHz" → 3200). The resolved profile is what the bridge sends to the console.

## Mapping types

| Type | Use it when | Example |
|---|---|---|
| `continuous` + `linear`/`log` curve | The plugin's knob is a simple linear or log sweep | Gain, HPF |
| `continuous` + `table` curve | Anything else; built automatically by calibration | Most EQ frequencies |
| `continuous` + `auto` curve | Let the bridge build the table from the plugin's display text | Draft profiles |
| `stepped` (`steps` or `auto`) | The plugin parameter has fixed positions | Compressor ratio 2:1 / 4:1 / 10:1, API frequency selectors |
| `even` | A stepped or choice extra: step i of n at i/(n-1) | Knee HRD/SFT, Thrust |
| `switch` | On/off parameter (`invert` flips it); a continuous control is split at its midpoint | Bell, Fast attack |
| `{ "available": false }` | The plugin has nothing equivalent | Mix on a strip without parallel compression |

## Working on it

```bash
npm install
npm run check        # generate + validate examples + typecheck + tests
cmake -S . -B build -DSTRIPLINE_PROTOCOL_TESTS=ON && cmake --build build && ./build/stripline_protocol_tests
```

Change a schema → run `npm run generate` → commit the schema and the generated files together. CI fails if they drift.
`npm run validate` checks every profile, including that strip slots only use controls that exist, bottom-row labels fit in 4 characters, every extra has a slot, and built-in profiles cover all 36 shared controls.

### Versioning

`protocolVersion` in `controls.json` goes up only for breaking changes (renamed fields, changed meaning). Adding a message type or an optional field is not breaking. Bridges and console exchange the version in `hello` / `welcome` and refuse a mismatch.
