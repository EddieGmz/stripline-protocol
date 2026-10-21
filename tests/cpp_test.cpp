// Mirrors tests/mapping.test.ts for the C++ headers. Build: see CMakeLists.txt (STRIPLINE_PROTOCOL_TESTS).
#include <stripline/Calibrate.h>
#include <cassert>
#include <cmath>
#include <cstdio>

using namespace stripline::protocol;

static bool near (float a, float b, float eps = 1e-3f) { return std::abs (a - b) < eps; }
#define CHECK(x) do { if (! (x)) { std::fprintf (stderr, "FAIL %s:%d %s\n", __FILE__, __LINE__, #x); return 1; } } while (0)

int main()
{
    static_assert (kControls.size() == 28);
    static_assert (indexOfControl ("output.fader") == 27);

    for (const auto& c : kControls)
        if (c.kind == Kind::Continuous)
            for (float t : { 0.0f, 0.1f, 0.37f, 0.5f, 0.9f, 1.0f })
                CHECK (near (valueToPosition (c, positionToValue (c, t)), t));

    const auto& fader = kControls[(size_t) indexOfControl ("output.fader")];
    CHECK (near (valueToPosition (fader, 0.0f), (60.0f / 72.0f) * (60.0f / 72.0f)));

    const auto& freq = kControls[(size_t) indexOfControl ("eq.lmf.freq")];
    Mapping table;
    table.type = Mapping::Type::Continuous;
    table.curve.kind = Curve::Kind::Table;
    table.curve.points = { { 0.0f, 200.0f }, { 0.25f, 340.0f }, { 0.5f, 700.0f }, { 0.75f, 1400.0f }, { 1.0f, 2500.0f } };
    CHECK (near (genericToNormalized (freq, table, 700.0f), 0.5f));
    CHECK (near (genericToNormalized (freq, table, 520.0f), 0.375f));
    float out = 0;
    CHECK (normalizedToGeneric (freq, table, 0.375f, out) && near (out, 520.0f));

    const auto& ratio = kControls[(size_t) indexOfControl ("comp.ratio")];
    Mapping stepped;
    stepped.type = Mapping::Type::Stepped;
    stepped.steps = { { 0.0714f, 1.5f }, { 0.2143f, 2.0f }, { 0.3571f, 3.0f }, { 0.5f, 4.0f }, { 0.6429f, 6.0f }, { 0.7857f, 10.0f } };
    CHECK (near (genericToNormalized (ratio, stepped, 4.4f), 0.5f));

    const auto& phase = kControls[(size_t) indexOfControl ("input.phase")];
    Mapping sw;
    sw.type = Mapping::Type::Switch;
    sw.invert = true;
    CHECK (near (genericToNormalized (phase, sw, 1.0f), 0.0f));
    CHECK (near (genericToNormalized (phase, sw, 0.0f), 1.0f));

    Mapping even;
    even.type = Mapping::Type::Even;
    even.count = 3;
    CHECK (near (genericToNormalized (phase, even, 1.0f), 0.5f));
    CHECK (normalizedToGeneric (phase, even, 0.9f, out) && near (out, 2.0f));

    CHECK (near (*parseDisplayNumber ("3.20 kHz"), 3200.0f));
    CHECK (near (*parseDisplayNumber ("\xE2\x88\x92" "12.0 dB"), -12.0f));
    CHECK (std::isinf (*parseDisplayNumber ("\xE2\x88\x9E:1")));
    CHECK (! parseDisplayNumber ("Off").has_value());
    CHECK (near (*parseDisplayNumber (".75s"), 0.75f));
    CHECK (std::isinf (*parseDisplayNumber ("oo : 1")) && *parseDisplayNumber ("oo : 1") > 0);
    CHECK (std::isinf (*parseDisplayNumber ("-oo")) && *parseDisplayNumber ("-oo") < 0);
    CHECK (near (*parseDisplayNumber ("Boost 3 dB"), 3.0f));
    CHECK (near (*parseDisplayNumber ("308 ms", "s"), 0.308f));
    CHECK (near (*parseDisplayNumber ("1.50 s", "ms"), 1500.0f));
    {
        Curve mixed;
        CHECK (curveFromSamples ({ { 0.0f, "20 ms" }, { 0.5f, "308 ms" }, { 1.0f, "4.00 s" } }, mixed));
        CHECK (mixed.points.size() == 3 && near (mixed.points[2].second, 4000.0f));
    }

    Curve auto_;
    CHECK (curveFromSamples ({ { 0.0f, "20 Hz" }, { 0.2f, "100 Hz" }, { 0.4f, "Off" }, { 0.6f, "1.00 kHz" }, { 0.8f, "900 Hz" }, { 1.0f, "16 kHz" } }, auto_));
    CHECK (auto_.points.size() == 4 && near (auto_.points[2].second, 1000.0f));

    const auto st = stepsFromTexts ({ { 0.0f, "OFF" }, { 0.2f, "45 Hz" }, { 0.4f, "70 Hz" }, { 0.6f, "AUTO" }, { 0.8f, "360 Hz" }, { 1.0f, "\xE2\x88\x9E" } }, 10.0f, 1000.0f);
    CHECK (near (st[0].value, 10.0f) && near (st[3].value, 215.0f) && near (st[5].value, 1000.0f));

    Mapping none;
    CHECK (genericToNormalized (phase, none, 1.0f) < 0.0f);

    std::puts ("cpp tests passed");
    return 0;
}
