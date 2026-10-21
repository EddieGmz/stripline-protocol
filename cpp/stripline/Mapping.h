// Generic control value <-> hosted plugin normalized value, for one profile mapping.
// Mirrors ts/mapping.ts. Header-only, no JSON: the bridge parses profiles into these structs.
#pragma once
#include <stripline/Controls.h>
#include <stripline/Scale.h>
#include <cmath>
#include <string>
#include <utility>
#include <vector>

namespace stripline::protocol
{
struct Curve
{
    enum class Kind { Linear, Log, Table };
    Kind kind = Kind::Linear;
    float min = 0.0f, max = 1.0f;
    std::vector<std::pair<float, float>> points; // [normalized, value], sorted by normalized

    float valueAt (float n) const noexcept
    {
        n = clamp01 (n);
        if (kind == Kind::Linear) return min + (max - min) * n;
        if (kind == Kind::Log)    return min * std::pow (max / min, n);
        if (points.empty())       return 0.0f;
        if (n <= points.front().first) return points.front().second;
        for (size_t i = 1; i < points.size(); ++i)
        {
            const auto [n1, v1] = points[i];
            if (n <= n1)
            {
                const auto [n0, v0] = points[i - 1];
                return ! (n1 > n0) ? v1 : v0 + (v1 - v0) * (n - n0) / (n1 - n0); // points are sorted, so ! (n1 > n0) means equal
            }
        }
        return points.back().second;
    }

    float positionOf (float v) const noexcept
    {
        if (kind == Kind::Linear) return clamp01 ((v - min) / (max - min));
        if (kind == Kind::Log)    return clamp01 (std::log (v / min) / std::log (max / min));
        if (points.size() < 2)    return 0.0f;
        const bool rising = points.back().second >= points.front().second;
        const auto& lo = rising ? points.front() : points.back();
        const auto& hi = rising ? points.back() : points.front();
        if (v <= lo.second) return lo.first;
        if (v >= hi.second) return hi.first;
        for (size_t i = 1; i < points.size(); ++i)
        {
            const auto [n0, v0] = points[i - 1];
            const auto [n1, v1] = points[i];
            if (v >= std::min (v0, v1) && v <= std::max (v0, v1))
                return std::abs (v1 - v0) < 1.0e-12f ? n0 : n0 + (n1 - n0) * (v - v0) / (v1 - v0);
        }
        return 0.0f;
    }
};

struct Step { float normalized = 0.0f, value = 0.0f; };

struct Mapping
{
    enum class Type { Unmapped, Unavailable, Continuous, Stepped, Switch, Even };
    Type type = Type::Unmapped;

    std::string paramId;    // stable id, matched first
    int paramIndex = -1;    // fallback
    std::string paramName;  // last resort, and for display (first of paramNames)
    std::vector<std::string> paramNames; // candidate names, tried in order (ignoring case, then as prefix)
    bool autoCurve = false; // Continuous: build the curve from the plugin's display text when it loads
    bool autoSteps = false; // Stepped: read the steps from the plugin when it loads

    Curve curve;            // Continuous
    std::vector<Step> steps;// Stepped
    float on = 1.0f, off = 0.0f; // Switch
    int count = 2;              // Even: number of positions of the control (step i sits at i/(count-1))
    bool invert = false;

    bool isMapped() const noexcept { return type == Type::Continuous || type == Type::Stepped || type == Type::Switch || type == Type::Even; }
};

inline bool genericIsOn (const ControlDef& d, float v) noexcept
{
    return d.kind == Kind::Switch ? v >= 0.5f : v >= (d.min + d.max) * 0.5f;
}

/** Generic value -> plugin normalized. Returns -1 when unmapped. */
inline float genericToNormalized (const ControlDef& d, const Mapping& m, float v) noexcept
{
    switch (m.type)
    {
        case Mapping::Type::Continuous:
        {
            const float n = d.kind == Kind::Switch ? (v >= 0.5f ? 1.0f : 0.0f) : m.curve.positionOf (v);
            return m.invert ? 1.0f - n : n;
        }
        case Mapping::Type::Stepped:
        {
            if (m.steps.empty()) return -1.0f;
            const Step* best = &m.steps.front();
            for (const auto& s : m.steps)
                if (std::abs (s.value - v) < std::abs (best->value - v)) best = &s;
            return best->normalized;
        }
        case Mapping::Type::Switch:
            return (genericIsOn (d, v) != m.invert) ? m.on : m.off;
        case Mapping::Type::Even:
            return m.count > 1 ? clamp01 (std::round (v) / (float) (m.count - 1)) : 0.0f;
        case Mapping::Type::Unmapped:
        case Mapping::Type::Unavailable:
        default:
            return -1.0f;
    }
}

/** Plugin normalized -> generic value. Returns false when unmapped. */
inline bool normalizedToGeneric (const ControlDef& d, const Mapping& m, float n, float& out) noexcept
{
    switch (m.type)
    {
        case Mapping::Type::Continuous:
        {
            const float p = m.invert ? 1.0f - clamp01 (n) : clamp01 (n);
            out = d.kind == Kind::Switch ? (p >= 0.5f ? 1.0f : 0.0f) : m.curve.valueAt (p);
            return true;
        }
        case Mapping::Type::Stepped:
        {
            if (m.steps.empty()) return false;
            const Step* best = &m.steps.front();
            for (const auto& s : m.steps)
                if (std::abs (s.normalized - n) < std::abs (best->normalized - n)) best = &s;
            out = best->value;
            return true;
        }
        case Mapping::Type::Switch:
        {
            const bool on = (std::abs (n - m.on) <= std::abs (n - m.off)) != m.invert;
            out = d.kind == Kind::Switch ? (on ? 1.0f : 0.0f) : (on ? d.max : d.min);
            return true;
        }
        case Mapping::Type::Even:
            out = m.count > 1 ? std::round (clamp01 (n) * (float) (m.count - 1)) : 0.0f;
            return true;
        case Mapping::Type::Unmapped:
        case Mapping::Type::Unavailable:
        default:
            return false;
    }
}
} // namespace stripline::protocol
