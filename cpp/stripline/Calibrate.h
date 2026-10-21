// Builds mapping curves from a plugin's own display text. Mirrors ts/mapping.ts
// (parseDisplayNumber, curveFromSamples, stepsFromTexts).
#pragma once
#include <stripline/Mapping.h>
#include <cctype>
#include <cstdlib>
#include <cmath>
#include <limits>
#include <optional>
#include <string>
#include <vector>

namespace stripline::protocol
{
namespace detail
{
    inline std::string lowerCase (const std::string& s)
    {
        std::string out;
        for (char c : s)
            out += (char) std::tolower ((unsigned char) c);
        return out;
    }
    inline bool isLetter (char c) { return std::isalpha ((unsigned char) c) != 0; }

    /** "ms", "s" or "" for the text right after a number. */
    inline std::string timeUnitOf (const std::string& rest)
    {
        size_t i = 0;
        while (i < rest.size() && rest[i] == ' ')
            ++i;
        size_t j = i;
        while (j < rest.size() && isLetter (rest[j]))
            ++j;
        const auto word = lowerCase (rest.substr (i, j - i));
        if (word == "ms")
            return "ms";
        if (word == "s" || word == "sec" || word == "secs" || word == "second" || word == "seconds")
            return "s";
        return {};
    }

    /** Index just past the first number in t, and its start; npos when there is none. */
    inline size_t findNumber (const std::string& t, size_t& start)
    {
        for (size_t i = 0; i < t.size(); ++i)
        {
            const bool digit = std::isdigit ((unsigned char) t[i]) != 0;
            const bool dotDigit = t[i] == '.' && i + 1 < t.size() && std::isdigit ((unsigned char) t[i + 1]);
            if (! digit && ! dotDigit)
                continue;
            start = i;
            if (start > 0 && (t[start - 1] == '-' || t[start - 1] == '+'))
                --start;
            size_t end = i;
            bool seenDot = false;
            while (end < t.size() && (std::isdigit ((unsigned char) t[end]) || (t[end] == '.' && ! seenDot)))
            {
                seenDot = seenDot || t[end] == '.';
                ++end;
            }
            return end;
        }
        return std::string::npos;
    }

    inline std::string firstTimeUnit (const std::vector<std::pair<float, std::string>>& texts)
    {
        for (const auto& [n, text] : texts)
        {
            size_t start = 0;
            const auto end = findNumber (text, start);
            if (end != std::string::npos)
                if (auto u = timeUnitOf (text.substr (end)); ! u.empty())
                    return u;
        }
        return {};
    }
} // namespace detail

/** The first number in a display text: "3.20 kHz" -> 3200, "-12 dB" -> -12, "∞", "inf" or "oo" -> ±infinity.
    `unit` ("ms" or "s") converts times shown in the other unit: "308 ms" with unit "s" -> 0.308. */
inline std::optional<float> parseDisplayNumber (const std::string& text, const std::string& unit = {})
{
    std::string t;
    t.reserve (text.size());
    for (size_t i = 0; i < text.size(); ++i)
    {
        // U+2212 MINUS SIGN (E2 88 92) -> '-'
        if ((unsigned char) text[i] == 0xE2 && i + 2 < text.size() && (unsigned char) text[i + 1] == 0x88 && (unsigned char) text[i + 2] == 0x92)
        {
            t += '-';
            i += 2;
            continue;
        }
        t += text[i] == ',' ? '.' : text[i];
    }
    const auto lower = detail::lowerCase (t);
    // Infinity: "∞", "inf", or "oo" as a word ("oo : 1", "-oo"), with its sign.
    for (const std::string token : { std::string ("\xE2\x88\x9E"), std::string ("inf"), std::string ("oo") })
    {
        for (size_t at = lower.find (token); at != std::string::npos; at = lower.find (token, at + 1))
        {
            const bool asciiWord = token != "\xE2\x88\x9E";
            if (asciiWord && ((at > 0 && detail::isLetter (lower[at - 1])) || (at + token.size() < lower.size() && detail::isLetter (lower[at + token.size()]))))
                continue;
            size_t k = at;
            while (k > 0 && lower[k - 1] == ' ')
                --k;
            const bool negative = k > 0 && lower[k - 1] == '-';
            return negative ? -std::numeric_limits<float>::infinity() : std::numeric_limits<float>::infinity();
        }
    }

    size_t start = 0;
    const auto end = detail::findNumber (t, start);
    if (end == std::string::npos)
        return std::nullopt;
    float v = std::strtof (t.substr (start, end - start).c_str(), nullptr);
    size_t k = end;
    while (k < t.size() && t[k] == ' ')
        ++k;
    if (k < t.size() && (t[k] == 'k' || t[k] == 'K'))
        v *= 1000.0f;
    const auto time = detail::timeUnitOf (t.substr (end));
    if (time == "ms" && unit == "s")
        v /= 1000.0f;
    else if (time == "s" && unit == "ms")
        v *= 1000.0f;
    return v;
}

/** Table curve from [normalized, display text] samples. Keeps numeric samples while they stay monotonic.
    Times are read in `unit` ("ms"/"s"), by default the first one the texts use.
    Returns false when fewer than two usable points remain. */
inline bool curveFromSamples (const std::vector<std::pair<float, std::string>>& samples, Curve& out, const std::string& unit = {})
{
    const auto u = unit.empty() ? detail::firstTimeUnit (samples) : unit;
    std::vector<std::pair<float, float>> pts;
    for (const auto& [n, text] : samples)
        if (auto v = parseDisplayNumber (text, u); v && std::isfinite (*v))
            pts.emplace_back (n, *v);
    if (pts.size() < 2)
        return false;
    // Decide the direction from the ends, then drop samples that go against it (e.g. a wrapped label).
    const bool rising = pts.back().second >= pts.front().second;
    std::vector<std::pair<float, float>> mono { pts.front() };
    for (size_t i = 1; i < pts.size(); ++i)
        if (rising ? pts[i].second >= mono.back().second : pts[i].second <= mono.back().second)
            mono.push_back (pts[i]);
    if (mono.size() < 2 || ! (std::abs (mono.back().second - mono.front().second) > 0.0f))
        return false;
    out = {};
    out.kind = Curve::Kind::Table;
    out.points = std::move (mono);
    return true;
}

/** Steps from the display text of each position of a stepped parameter. Positions without a number
    (OFF, AUTO, VAR) take the control's minimum when first, its maximum when last, and the value between
    their neighbours otherwise; infinity becomes the control's maximum. */
inline std::vector<Step> stepsFromTexts (const std::vector<std::pair<float, std::string>>& positions, float controlMin, float controlMax,
                                         const std::string& unit = {})
{
    const auto u = unit.empty() ? detail::firstTimeUnit (positions) : unit;
    std::vector<Step> steps;
    std::vector<bool> known;
    for (const auto& [n, text] : positions)
    {
        auto v = parseDisplayNumber (text, u);
        if (v && std::isinf (*v))
            v = *v > 0 ? controlMax : controlMin;
        steps.push_back ({ n, v ? *v : 0.0f });
        known.push_back (v.has_value());
    }
    for (size_t i = 0; i < steps.size(); ++i)
    {
        if (known[i])
            continue;
        if (i == 0)
            steps[i].value = controlMin;
        else if (i + 1 == steps.size())
            steps[i].value = controlMax;
        else
        {
            size_t j = i + 1;
            while (j < steps.size() && ! known[j])
                ++j;
            const float next = j < steps.size() ? steps[j].value : controlMax;
            steps[i].value = 0.5f * (steps[i - 1].value + next);
        }
    }
    return steps;
}
} // namespace stripline::protocol
