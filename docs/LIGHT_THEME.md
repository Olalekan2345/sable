# A light theme, when there is time for one

Deferred deliberately, twice, with the submission deadline close. This records what the work
actually involves so nobody has to measure it again.

Sable ships one theme. It is dark, finished, and consistent.

---

## The part that looked hard, and is not

The brand accent cannot be used as a foreground colour on white:

| `#ffce1a` | Contrast |
| --- | --- |
| on `#0a0a0a` (current surface) | **13.29:1** |
| on white | **1.49:1** — fails even the 3:1 non-text threshold |

The first read of that was "a light theme needs a different brand colour", which would have
made this a design decision rather than an implementation one.

That was overstated. The yellow survives where it matters most — as a **fill**:

```
#ffce1a fill + #1a1600 ink  →  12.17:1
```

So primary buttons, the faucet call to action and badges keep the signature colour unchanged.
Only accent *text* and *borders* need a darker variant:

| Candidate | On white | Verdict |
| --- | --- | --- |
| `#B8860B` | 3.25:1 | UI elements only, not text |
| `#9A6F00` | 4.52:1 | passes AA, no margin |
| **`#8A6200`** | **5.49:1** | passes AA comfortably, same hue family |
| `#7A5600` | 6.65:1 | darker than the brand reads |

`#8A6200` is the recommendation: one derived token, not a rebrand.

---

## The part that is actually the work

**58 hardcoded colour values across 23 component files.** Every one needs to become a token
before a palette swap can reach it. That is mechanical but not quick, and it is where a
half-finished attempt leaves visible damage.

**23 palette entries need a light value.** Mostly straightforward.

**The things that invert badly**, which is where the bugs will be:

- Hairlines are `rgba(244, 243, 238, …)` — light-on-dark alpha. On a light surface they
  vanish rather than darkening. Every border needs its own light value, not an inversion.
- The `masked-value` treatment and its `scan` animation are tuned for a dark ground.
- Both landing mode visuals draw on `--color-elevated`/`--color-raised` gradients.
- The glows added for the connected-wallet pill and the amount-field focus ring are alpha over
  dark; they need re-tuning, not inverting.
- Token marks carry `ink` colours chosen against their own discs. Those are unaffected — the
  discs are opaque brand colours — but the shared inset hairline on each is
  `rgba(244, 243, 238, 0.10)` and will need the light equivalent.

**Then**: a toggle honouring `prefers-color-scheme`, and the browser suite re-run. The
accessibility tests will not catch a contrast regression on their own — that needs looking at
every screen.

---

## Why it keeps being deferred

Not difficulty. Sequencing. The dark theme is what a judge sees, it is tested, and it is done.
A subtle inversion bug on a screen being filmed costs more than a light theme gains, and
nothing about doing this after submission is harder than doing it before.
