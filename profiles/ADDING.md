# Adding a channel strip

Stripline only scans and hosts the channel strips it has a profile for: the profiles in this folder are built into
the bridge and are its whitelist. Adding a plugin means adding a profile here, and its parameter dump to
`params/`, then rebuilding the bridge. Only VST3 plugins are supported.

## 1. Dump the plugin's parameters

`StriplineParams` is built with the bridge (`stripline-bridge`, `build/StriplineParams_artefacts/Release/`). It loads
one VST3 outside any DAW and writes two files:

```bash
StriplineParams "/Library/Audio/Plug-Ins/VST3/Lindell 50 Channel.vst3" --out params/
# A shell file holds many plugins: run it without --plugin to list them, then pick one.
StriplineParams "/Library/Audio/Plug-Ins/VST3/WaveShell1-VST3 14.12.vst3" --plugin "CLA MixHub Stereo" --out params/
```

- `<Vendor> <Plugin>.params.json`: every parameter with its index, id, name, unit label, number of steps, default,
  and its display text sampled along its travel (21 points, or each step of a stepped parameter).
- `<profile-id>.json`: a draft profile with the plugin's name, vendor, VST3 uid and a scan hint filled in.

Commit the `.params.json` to `params/` (it is what the profile is checked against, now and when the plugin
updates). The draft goes to step 2.

## 2. Write the profile

Move the draft to `profiles/<id>.json` (the file name must be the profile's `id`) and fill it in from the dump.
`examples/profiles/example.channel-strip.json` shows every option; the existing profiles are good models.

- **`plugin`**: `name` matches the plugin and any name that starts with it ("CLA MixHub" covers Mono and Stereo);
  `aliases` for other names; `scan.files` are parts of the `.vst3` file name. A file is only opened when its name
  contains one of them, so keep them specific; for a shell, use the shell's file name ("WaveShell").
- **`mappings`**: one per shared control (`schema/controls.json`), pointing at a parameter by `id`, `index` and `name`
  from the dump:
  - Knobs: `"type": "continuous"` with `"curve": { "kind": "auto" }`. The console passes the knob position to the
    plugin unchanged and shows the plugin's own text, so no curve needs writing. Add `"invert": true` when the
    plugin's knob runs the other way.
  - Knobs that click through fixed positions: `"type": "stepped", "auto": true`. Same pass-through; the plugin lands
    on its own steps.
  - On/off: `"type": "switch"` (with `on` / `off` positions when they aren't 1 and 0, `invert` when "on" means off).
  - The fader (`output.fader`) is the one control read in dB: `continuous` with an `auto` curve, which the bridge
    reads from the plugin's text.
  - Nothing equivalent in the plugin: `{ "available": false }`.
- **`extras`**: the plugin's own controls (drive, mix, a model selector…), up to 32.
- **`strip`**: where they go on the console (6 global buttons, 4 knobs + 4 buttons per section) and colours.

## 3. Check it

```bash
npm run check          # schema, the profile rules, generated code, tests
```

Then, in `stripline-bridge`, point the `protocol` submodule at the new commit, rebuild, and in REAPER:
**Plugins… → Scan for channel strips**, load the plugin, and check the bridge window ("26/26 shared, 12/12 plugin
controls found"; fewer means a parameter wasn't found by the names given). Turn each control in the console and
compare it with the plugin's own window.

## 4. Commit

Commit the profile and the `.params.json` here (on `develop`), then update the `protocol` submodule in
`stripline-bridge` and `stripline-console`.
