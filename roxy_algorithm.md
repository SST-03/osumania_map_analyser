# Roxy 4K RC Difficulty Estimator

Roxy is a synchronous 4-key regular-chain difficulty estimator for osu!mania. It combines a structural strain model with a compact meta calibration head. The structural layer reads the chart directly; the reference layer uses Sunny, Daniel, and a Roxy-private Azusa call as additional numeric signals. Roxy does not call Mixed or Companella.

## 1. Scope

Roxy is intended for 4K RC charts. It rejects maps that are outside its scope:

- empty or unparsable input
- non-mania beatmaps
- non-4K beatmaps
- LN ratio above `0.18`
- fewer than `80` tap notes
- non-finite or non-positive speed rate
- internal estimator errors

Invalid results use the same estimator result shape as valid results, but return no numeric difficulty.

## 2. Pipeline

```text
Parse .osu text
  -> build 4K tap rows
  -> compute row, hand, column, rhythm, entropy, and NPS features
  -> update seven structural strain streams
  -> aggregate streams into structural numeric difficulty
  -> compute Sunny and Daniel once
  -> call private Azusa with those precomputed references
  -> build meta features from Azusa/Sunny/Daniel/Roxy
  -> evaluate GBDT calibration head
  -> apply high-speed monotonic guard
  -> format RC label and optional Azusa graph
```

The reference order is deliberately fixed:

1. Reuse `precomputedSunnyResult` when available; otherwise compute Sunny once.
2. Reuse `precomputedDanielResult` when available; otherwise compute Daniel once.
3. Call Azusa with both precomputed results.

This keeps Roxy, Azusa, Daniel, and Sunny aligned without recomputing Daniel or Sunny inside Azusa.

## 3. Basic Functions

Roxy uses small bounded primitives instead of unbounded raw ratios.

```text
clamp(x, lo, hi) = min(max(x, lo), hi)

g(x, a, b)  = clamp((x - a) / (b - a), 0, 1)
gi(x, a, b) = clamp((b - x) / (b - a), 0, 1)

r(dt, base, offset, power)
  = min(8, (base / max(16, dt + offset)) ^ power)

decay(state, input, dt, tau)
  = state * exp(-dt / tau) + input
```

`g` is a rising gate, `gi` is a falling gate, and `r` maps shorter intervals to larger strain with a hard cap.

## 4. Row Model

Each tap note is scaled by speed rate:

```text
t = startTime / speedRate
```

Notes within `2 ms` are merged into one row. Each row stores:

- `mask`: 4-bit column mask
- `rowSize`: number of active columns
- `leftCount`, `rightCount`: notes on columns `0-1` and `2-3`
- `dtRow`: interval from previous row
- `dtSame[c]`: interval from previous note in column `c`
- `dtHand[h]`: interval from previous active row on hand `h`
- `handMask[h]`: active mask for each hand
- `nps250`, `nps500`, `nps1000`, `nps4000`: rolling density windows

Hand split is fixed as columns `0-1` for left hand and `2-3` for right hand.

Important row-level features:

```text
rotation[h] = 1
  when current hand mask and previous non-empty same-hand mask have no overlap

sameHandOverlap = (overlapLeft + overlapRight) / 2

rowChord = (rowSize - 1) / 3

sameHandChord =
  (max(0, leftCount - 1) + max(0, rightCount - 1)) / 2

rhythmChaos =
  min(2, abs(log2((dtRow + 24) / (prevDtRow + 24)))) / 2
```

Two entropy windows are maintained over `750 ms`:

- `entropy750`: frequency entropy of the 16 possible row masks
- `transitionEntropy750`: frequency entropy of 256 possible `prevMask -> mask` transitions

## 5. Structural Inputs

Roxy converts every row into seven input signals.

### Speed

```text
speedIn =
  0.55 * r(dtRow, 155, 30, 1.06)
+ 0.30 * max_h r(dtHand[h], 180, 40, 1.08)
+ 0.15 * mean_h r(dtHand[h], 180, 40, 1.08)
```

Speed is based on row interval and hand interval, not directly on NPS.

### Jack

```text
anchorRow = 1 if any dtSame[c] <= 220 ms else 0

jackIn =
  max_c r(dtSame[c], 185, 35, 1.18)
* (1 + 0.20 * rowChord + 0.15 * anchorRow)
```

### Hand Stream

```text
handIn =
  max_h (
    0.70 * r(dtHand[h], 180, 38, 1.10)
  + 0.30 * rotation[h] * r(dtHand[h], 205, 45, 1.05)
  )
```

### Chord

```text
chordIn =
  rowChord * (1 + 0.18 * speedIn)
+ 0.22 * sameHandChord
+ max(0, rowSize - 2) * r(dtRow, 150, 80, 0.85)
```

### Chordjack

```text
chordjackIn =
  rowChord * (
    0.55 * jackIn
  + 0.30 * sameHandOverlap
  + 0.15 * handIn
  )
```

### Tech

```text
techIn =
  0.32 * rhythmChaos
+ 0.24 * entropy750
+ 0.24 * transitionEntropy750
+ 0.20 * (mask != prevMask ? 1 : 0)
```

### Stamina

```text
handStamina[h] =
  decay(handStamina[h], r(dtHand[h], 180, 40, 1.08), dtHand[h], 8000)

staminaIn =
  0.40 * log1p(nps1000) / log(24)
+ 0.35 * log1p(nps4000) / log(24)
+ 0.25 * max(handStamina[0], handStamina[1])
```

## 6. Strain Streams

Each structural input updates a burst and sustain state. The stream output is a weighted mix of those states.

| Stream | Burst tau | Sustain tau | Burst weight | Sustain weight |
|---|---:|---:|---:|---:|
| speed | 220 | 1600 | 0.78 | 0.22 |
| hand | 260 | 2200 | 0.80 | 0.20 |
| jack | 300 | 1800 | 0.88 | 0.12 |
| chordjack | 260 | 2400 | 0.82 | 0.18 |
| tech | 450 | 3200 | 0.70 | 0.30 |
| stamina | 1200 | 10000 | 0.58 | 0.42 |
| course | 30000 | 120000 | 0.35 | 0.65 |

The local raw strain is the weighted sum of stream outputs:

```text
localRaw =
  0.22 * speed
+ 0.18 * hand
+ 0.16 * jack
+ 0.16 * chordjack
+ 0.12 * tech
+ 0.11 * stamina
+ 0.05 * course
```

## 7. Aggregation

For each stream:

```text
A =
  0.30 * q97
+ 0.22 * q90
+ 0.18 * tailMeanTop4%
+ 0.15 * q75
+ 0.10 * powerMean(p = 2.4)
+ 0.05 * q50
```

Roxy also computes a fixed `400 ms` section peak aggregation over `localRaw`:

```text
sectionAgg = sum(sortedPeak[i] * 0.9^i) / sum(0.9^i)
```

The raw structural score is:

```text
rawAgg = 0.80 * weightedAgg + 0.20 * sectionAgg
logRaw = ln(1 + max(0, rawAgg))
preNumeric = linearMap(logRaw, p02, p98, -2, 20)
```

The pre-numeric value is corrected structurally, passed through an isotonic mapping, then clamped to the RC numeric range.

## 8. Global Statistics

Roxy measures chart-wide shape to adjust local strain:

```text
activeDurationSec = (lastT - firstT - inactiveMs) / 1000
inactiveMs = sum(gap - 1000 for gap > 1000)
breakDensity = breakCount / max(activeDurationSec / 60, 1)
avgNps = tapCount / max(activeDurationSec, 1)
handBias = abs(leftLoad - rightLoad) / max(leftLoad, rightLoad, 1e-6)
```

Other statistics include chord rate, triple rate, same-hand overlap rate, rotation rate, same-hand interval Q10, fast jack rate, anchor rate, anchor imbalance, and peak-to-sustain gap.

## 9. Structural Corrections

The correction layer handles pattern families that are not well represented by a single strain sum:

- low-density chordjack lift
- high-speed stream lift
- very dense high-chord damping
- long course break damping
- sustained course lift
- dense jumpstream lift and damping
- anchor jack lift
- hand-bias lift

The total correction is clamped before the isotonic mapping.

## 10. Meta Calibration

The meta layer receives four numeric sources:

| Source | Meaning |
|---|---|
| Azusa | Private Azusa result using Roxy's precomputed Sunny and Daniel references |
| Sunny | General estimator reference, computed once or supplied by caller |
| Daniel | 4K RC reference, computed once or supplied by caller |
| Roxy | Roxy structural numeric before meta calibration |

Feature groups:

- `pred_*` and `has_*` for each source
- min, max, mean, median, and range over available predictions
- pairwise differences for `Azusa/Daniel`, `Azusa/Sunny`, `Azusa/Roxy`, `Daniel/Sunny`, `Daniel/Roxy`, and `Sunny/Roxy`
- structural numeric details
- correction terms
- stream summaries
- global statistics and small interaction features

Unavailable references are encoded as `has = 0` and `pred = 0`. The GBDT head returns the final calibrated numeric value.

## 11. OD Override

Roxy accepts `odFlag`, `OD`, `od`, or `overallDifficulty` in the options object. Supported values are:

- `HR`
- `EZ`
- a numeric OD value, used for DA-style OD override

The OD transform follows Sunny's judgement-window logic:

```text
effectiveOD = baseOD                         if no override
effectiveOD = 6.462 + 0.715 * baseOD         if HR
effectiveOD = -20.761 + 2.566 * baseOD       if EZ
effectiveOD = numeric override               otherwise

rawWindow = 0.3 * sqrt((64.5 - ceil(od * 3)) / 500)
judgeWindow(od) = min(rawWindow, 0.6 * (rawWindow - 0.09) + 0.09)

pressureRatio = clamp(baseWindow / effectiveWindow, 0.55, 1.85)
odCorrection = clamp(log(pressureRatio) * (1.15 + 0.70 * gate(numeric, 6, 18)), -0.75, 0.75)
```

OD is applied after the meta model and before the high-speed guard. The meta reference layer is kept OD-neutral because the GBDT was trained without OD-varied samples; feeding OD-shifted Sunny/Azusa predictions into that model can create unstable reversals.

## 12. High-Speed Guard

For `speedRate > 1`, Roxy applies an additional lower-bound guard. The guard compares the meta value against:

- the unsped baseline estimate
- a baseline-relative speed-rate lift
- a recursive lower-rate anchor floor
- a current-rate reference floor
- an extreme structural floor derived from `logRaw` only when the current structure exceeds the calibrated raw range

The speed lift uses both logarithmic and linear rate terms:

```text
rateIntensity = log2(speedRate) + 0.35 * max(0, speedRate - 1)
baselineFloor = baseline + rateIntensity * gainPerDoubling
```

`gainPerDoubling` depends on baseline difficulty, current sped density, hand interval pressure, chord rate, and speed stream aggregate. A mid-difficulty band-pass term strengthens the `10.5..17` range so high multipliers do not collapse after the meta model leaves its training distribution.

The recursive anchor floor evaluates a lower speed rate with its own guard enabled, then adds a small positive local lift:

```text
anchorRate =
  speedRate - 0.025  for speedRate <= 1.15
  speedRate - 0.05   for speedRate <= 1.30
  speedRate - 0.10   for speedRate <= 1.50
  speedRate - 0.125  for speedRate <= 2.00
  speedRate - 0.25   otherwise

anchorFloor = Roxy(osuText, speedRate=anchorRate).numericDifficulty
            + localAnchorLift(speedRate / anchorRate)
```

The guard uses an internal recursion depth cap and a per-call cache so repeated baseline/anchor probes do not recompute the same rate inside one top-level estimate.

The extreme structural floor no longer activates merely because `speedRate > 1`; it only activates when:

```text
logRaw > rawMap.p98
```

The final guarded value is:

```text
final = clamp(
  max(unguardedNumeric, baselineFloor, anchorFloor, referenceFloor, extremeStructuralFloor),
  -2,
  30
)
```

The structural layer and meta feature values still stay in the original calibrated range. The wider final clamp only prevents high-rate estimates from being flattened at `20.00`.

## 13. Label Soft Cap

Roxy keeps numeric difficulty internally, but its RC label display is capped above `CloverWisp Theta high`:

```text
if numericDifficulty > 18.4:
    estDiff = "> CloverWisp Theta high"
else:
    estDiff = numericToRcLabel(numericDifficulty)
```

This prevents Roxy from displaying `Iota` or higher labels while still allowing the numeric value and star value to reflect values above Theta high.

## 14. Graph Output

The numeric calculation uses Roxy's structural strain data. The returned `graph` field does not use Roxy's local strain series. When graph output is requested, Roxy returns the graph provided by its private Azusa call, which currently resolves to Azusa/Sunny graph data.

## 15. Complexity

Let `N` be the number of tap notes and `R` the number of merged rows.

- parsing and row construction: `O(N)`
- rolling NPS windows: `O(R)` with two pointers
- entropy windows: `O(R)` with bounded mask tables
- strain update and aggregation: `O(R)`
- meta feature build and GBDT evaluation: bounded by model size
- memory: `O(R)` for rows and strain arrays, plus reference estimator memory

Roxy is heavier than a single estimator because it uses Sunny, Daniel, and private Azusa references, but Sunny and Daniel are each computed at most once in the normal Roxy path. High-rate calls add recursive baseline/anchor probes; those probes use a small cache and disable graph output.
