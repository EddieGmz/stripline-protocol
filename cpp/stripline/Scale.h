// Knob/fader position (0..1) <-> control value. Mirrors ts/scale.ts.
#pragma once
#include <stripline/Controls.h>
#include <algorithm>
#include <cmath>

namespace stripline::protocol
{
inline float clamp01 (float t) noexcept { return std::clamp (t, 0.0f, 1.0f); }

inline float clampValue (const ControlDef& d, float v) noexcept { return std::clamp (v, d.min, d.max); }

inline float snapValue (const ControlDef& d, float v) noexcept
{
    if (d.kind == Kind::Switch)
        return v >= 0.5f ? 1.0f : 0.0f;
    if (d.step > 0.0f)
        v = std::round (v / d.step) * d.step;
    return clampValue (d, v);
}

inline float positionToValue (const ControlDef& d, float t) noexcept
{
    t = clamp01 (t);
    if (d.kind == Kind::Switch)
        return t >= 0.5f ? 1.0f : 0.0f;
    switch (d.scale)
    {
        case Scale::Log:   return d.min * std::pow (d.max / d.min, t);
        case Scale::Fader: return d.min + (d.max - d.min) * std::sqrt (t);
        case Scale::Linear:
        default:           return d.min + (d.max - d.min) * t;
    }
}

inline float valueToPosition (const ControlDef& d, float v) noexcept
{
    if (d.kind == Kind::Switch)
        return v >= 0.5f ? 1.0f : 0.0f;
    v = clampValue (d, v);
    switch (d.scale)
    {
        case Scale::Log:   return clamp01 (std::log (v / d.min) / std::log (d.max / d.min));
        case Scale::Fader: { const float l = (v - d.min) / (d.max - d.min); return clamp01 (l * l); }
        case Scale::Linear:
        default:           return clamp01 ((v - d.min) / (d.max - d.min));
    }
}
} // namespace stripline::protocol
