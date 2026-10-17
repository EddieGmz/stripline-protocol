// Mirrors tests/mapping.test.ts for the C++ headers. Build: see CMakeLists.txt (STRIPLINE_PROTOCOL_TESTS).
#include <stripline/Mapping.h>
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

    const auto& attack = kControls[(size_t) indexOfControl ("comp.attack")];
    Mapping sw;
    sw.type = Mapping::Type::Switch;
    sw.invert = true;
    CHECK (near (genericToNormalized (attack, sw, 1.0f), 1.0f));
    CHECK (near (genericToNormalized (attack, sw, 25.0f), 0.0f));

    Mapping none;
    CHECK (genericToNormalized (attack, none, 1.0f) < 0.0f);

    std::puts ("cpp tests passed");
    return 0;
}
