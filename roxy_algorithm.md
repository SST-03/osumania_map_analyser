# Roxy Estimator Documentation

---

## 1. Overview

Roxy is a **4K RC meta-structural estimator** for osu!mania / VSRG beatmaps. It takes an osu!mania `.osu` beatmap text as input and outputs:

| Field | Type | Description |
|-------|------|-------------|
| `estDiff` | string | Human-readable RC tier label, e.g. `Reform 9 low` |
| `numericDifficulty` | number | Continuous RC value, clamped to `[-2, 20]` |
| `star` | number | Linear mapped star value, `3.4 + 0.38 * numericDifficulty` |
| `rawNumericDifficulty` | number | Structural numeric before the meta model output |
| `debug` | object | Intermediate structure, references, stream summaries, corrections, and meta diagnostics |

The current production pipeline consists of **7 stages**:

```text
Parse -> Row Build -> Structural Strain -> Structural Numeric -> Reference Predictions -> Meta Model -> Label
```

Roxy is intentionally different from Azusa:

- Azusa is mostly a handcrafted RC estimator with reference blending.
- Roxy first computes its own structural signals, then uses a generated GBDT meta model over Roxy features and existing estimator predictions.
- Roxy currently reaches KPI1 on the local benchmark:
  - `Exact = 99.07%`
  - `Close+ = 99.84%`
  - `Moderate = 0.16%`
  - `Miss = 0`

---

## 2. Configuration Constants

All structural parameters are centralized in `ROXY_CONFIG`.

### 2.1 Input Constraints

| Constant | Value | Description |
|----------|------:|-------------|
| `rcLnRatioLimit` | `0.18` | Maps with LN ratio above 18% are rejected |
| `minNotes` | `80` | Minimum tap note count for stable RC estimation |
| `rowToleranceMs` | `2` | Time tolerance for merging simultaneous notes into a row |
| `entropyWindowMs` | `750` | Sliding mask/transition entropy window |
| `npsWindowsMs` | `[250, 500, 1000, 4000]` | NPS windows used by stamina and diagnostics |

### 2.2 Section Aggregation

| Constant | Value | Description |
|----------|------:|-------------|
| `sectionMs` | `400` | Section width for section peak aggregation |
| `sectionDecay` | `0.9` | Descending-section weight decay |

### 2.3 Graph Smoothing

| Constant | Value | Description |
|----------|------:|-------------|
| `graphSmoothingTauMs` | `650` | Time constant for graph-only bidirectional exponential smoothing |
| `graphRawBlend` | `0.12` | Fraction of original graph signal mixed back after smoothing |

### 2.4 Structural Raw Mapping

| Constant | Value | Description |
|----------|------:|-------------|
| `rawMap.p02` | `3.9947` | Lower structural log-raw calibration point |
| `rawMap.p98` | `7.5454` | Upper structural log-raw calibration point |
| `correctionClamp` | `1.25` | Clamp for total structural correction |

The raw mapping is:

```text
rawAgg     = 0.80 * weightedAgg + 0.20 * sectionAgg
logRaw     = ln(1 + max(0, rawAgg))
preNumeric = clamp(linearMap(logRaw, p02, p98, -2, 20), -2.5, 21)
```

### 2.5 Stream Weights

| Stream | Weight | Purpose |
|--------|-------:|---------|
| `speed` | `0.22` | Global row speed and hand rate |
| `handStream` | `0.18` | Per-hand stream / rotation pressure |
| `jack` | `0.16` | Same-column repetition |
| `chordjack` | `0.16` | Interaction between chord density and jack pressure |
| `tech` | `0.12` | Rhythm, mask, and transition irregularity |
| `stamina` | `0.11` | Sustained NPS and hand stamina |
| `course` | `0.05` | Long-duration course-like stamina |

### 2.6 Stream Decay Model

Each stream has a burst state and a stamina state:

```text
burstState   = burstState   * exp(-dt / burstTau)   + input
staminaState = staminaState * exp(-dt / staminaTau) + input

streamValue = burstMix * burstState + (1 - burstMix) * staminaState
```

| Stream | `burstTau` | `staminaTau` | `burstMix` |
|--------|-----------:|-------------:|-----------:|
| `speed` | `220` | `1600` | `0.78` |
| `handStream` | `260` | `2200` | `0.80` |
| `jack` | `300` | `1800` | `0.88` |
| `chordjack` | `260` | `2400` | `0.82` |
| `tech` | `450` | `3200` | `0.70` |
| `stamina` | `1200` | `10000` | `0.58` |
| `course` | `30000` | `120000` | `0.35` |

---

## 3. RC Label System

Roxy uses the shared RC formatter in `rcDifficultyFormat.js`, the same label system extracted from Azusa.

### 3.1 Tier Constants

**`GREEK_BY_INDEX`**: Greek-like names for numeric bases 11-20.

```text
Alpha, Beta, Gamma, Delta, Epsilon, Emik Zeta,
Thaumiel Eta, CloverWisp Theta, Iota, Kappa
```

**`RC_TIER_CANDIDATES`**:

```text
low (-0.4), mid/low (-0.2), mid (0), mid/high (+0.2), high (+0.4)
```

### 3.2 Mapping Rules

| Numeric Base | Label Format |
|--------------|--------------|
| `<= 0` | `Intro 1` to `Intro 3` |
| `1..10` | `Reform 1` to `Reform 10` |
| `11..20` | `Alpha` to `Kappa` |

`numericToRcLabel(numeric)` searches all `(base, tierOffset)` candidates and chooses the closest center.

### 3.3 Reverse Parsing

Roxy also uses `rcLabelToNumeric(label)` for reference estimators whose `numericDifficulty` is `null`.

This is needed because Sunny often returns a valid RC label but no numeric value. A critical bug avoided here:

```text
Number(null) === 0
```

Roxy explicitly rejects `null`, `undefined`, and empty string before numeric conversion, then falls back to label parsing.

---

## 4. Utility Functions

### 4.1 `clamp(value, min, max)`

Standard numeric clamp.

### 4.2 `safeDiv(a, b, fallback)`

Division with NaN / Inf / zero protection.

### 4.3 `fmt4(value)`

Formats finite debug values to 4 decimals. Returns `null` for non-finite values.

### 4.4 `gate(value, min, max)`

```text
gate(x, a, b) = clamp((x - a) / (b - a), 0, 1)
```

### 4.5 `inverseGate(value, min, max)`

```text
inverseGate(x, a, b) = clamp((b - x) / (b - a), 0, 1)
```

### 4.6 `strainRate(dt, base, offset, power)`

```text
strainRate(dt, base, offset, power)
  = min(8, (base / max(16, dt + offset)) ^ power)
```

This is the primitive rate-to-strain curve used by speed, jack, hand, chord, and stamina features.

### 4.7 `decayState(state, input, dt, tau)`

```text
state * exp(-dt / tau) + input
```

### 4.8 `piecewiseLinear(x, knots)`

Linear interpolation over sorted `[x, y]` knots. Used by the structural isotonic calibration table.

### 4.9 `quantileFromSorted(sortedValues, q)`

Interpolated quantile from a sorted numeric array.

### 4.10 `powerMean(values, p)`

Generalized power mean, currently used with `p = 2.4` in stream summaries.

---

## 5. Stage 1: Parsing and Validation

### 5.1 `runRoxyEstimatorFromText(osuText, options)`

Roxy accepts beatmap text and options:

| Option | Default | Description |
|--------|---------|-------------|
| `speedRate` | `1.0` | Playback rate; note times are divided by this value |
| `odFlag` | `null` | Forwarded to reference estimators |
| `cvtFlag` | `null` | Supports `HO` / `IN` conversion |
| `withGraph` | `false` | Whether to return graph data |

### 5.2 Invalid Results

`buildErrorResult(code, message, extras)` returns a standardized invalid object:

```js
{
  star: NaN,
  estDiff: "Invalid: <message>",
  numericDifficulty: null,
  numericDifficultyHint: code,
  graph: null,
  rawNumericDifficulty: null,
  debug: { code, message }
}
```

### 5.3 Validation Rules

| Code | Condition |
|------|-----------|
| `EmptyInput` | Beatmap text is missing or empty |
| `InvalidSpeedRate` | `speedRate` is non-finite or <= 0 |
| `ParseFailed` | Parser reports failure |
| `NotMania` | Beatmap is not osu!mania |
| `UnsupportedKeys` | Column count is not 4 |
| `UnsupportedLN` | LN ratio is above `0.18` |
| `TooFewNotes` | Fewer than `80` RC tap notes or fewer than 2 rows |
| `RoxyError` | Internal exception |

---

## 6. Stage 2: Tap Rows

### 6.1 `buildTapRows(parsed, speedRate, toleranceMs)`

Roxy extracts only tap notes:

```text
if noteType has LN bit 128 -> skip
```

Each tap:

```js
{
  t: startTime / speedRate,
  c: column
}
```

Taps are sorted by `(time, column)`.

### 6.2 Row Merge

Rows merge all taps within `2ms` of the row start:

```text
abs(tap.t - rowStartTime) <= 2
```

Each row contains:

| Field | Description |
|-------|-------------|
| `t` | Row time |
| `mask` | 4-bit column mask |
| `rowSize` | Number of unique columns in the row |
| `leftCount` | Number of notes in columns 0-1 |
| `rightCount` | Number of notes in columns 2-3 |
| `handMask` | `[leftMask, rightMask]` |

Hand masks:

```text
leftMask  = mask & 0b0011
rightMask = mask & 0b1100
```

---

## 7. Stage 3: Structural Curve (`computeRoxyCurve`)

`computeRoxyCurve(rows, taps, activity)` is Roxy's core structural feature extraction stage.

For every row, it computes:

1. Time intervals:
   - `dtRow`
   - `dtSame[c]`
   - `dtHand[h]`
2. Hand pattern signals:
   - `rotation[h]`
   - `sameHandOverlap`
   - `sameHandChord`
3. Chord signals:
   - `rowChord`
   - `threeRate`
4. Jack / anchor signals:
   - `jackMax`
   - `anchorRow`
5. Entropy:
   - `entropy750`
   - `transitionEntropy750`
6. NPS windows:
   - `nps250`
   - `nps500`
   - `nps1000`
   - `nps4000`
7. Seven stream inputs:
   - `speedIn`
   - `handIn`
   - `jackIn`
   - `chordIn`
   - `chordjackIn`
   - `techIn`
   - `staminaIn`
   - `courseIn`

### 7.1 Time Intervals

```text
dtRow     = currentRowTime - previousRowTime
dtSame[c] = currentRowTime - lastColumnTime[c]
dtHand[h] = currentRowTime - lastHandTime[h]
```

The first row uses `dtRow = 1000`.

### 7.2 Rotation

```text
rotation[h] = 1
```

when the current same-hand mask is non-empty and has no overlap with the previous same-hand non-empty mask.

### 7.3 Chord Features

```text
rowChord = (rowSize - 1) / 3
sameHandChord = (max(0, leftCount - 1) + max(0, rightCount - 1)) / 2
```

### 7.4 Entropy Window

Roxy maintains a 750ms sliding queue with:

| Table | Buckets | Meaning |
|-------|---------|---------|
| `maskCounts` | 16 | Frequency of row masks |
| `transitionCounts` | 256 | Frequency of `prevMask -> mask` transitions |

Normalized entropy:

```text
entropy750 = entropy(maskCounts) / 4
transitionEntropy750 = entropy(transitionCounts) / 8
```

---

## 8. Stage 3 Inputs: Seven Strain Signals

### 8.1 Speed

```text
speedIn =
  0.55 * strainRate(dtRow, 155, 30, 1.06)
+ 0.30 * max_h strainRate(dtHand[h], 180, 40, 1.08)
+ 0.15 * mean_h strainRate(dtHand[h], 180, 40, 1.08)
```

### 8.2 Jack

```text
anchorRow = 1 if any dtSame[c] <= 220 else 0

jackIn =
  max_c strainRate(dtSame[c], 185, 35, 1.18)
* (1 + 0.20 * rowChord + 0.15 * anchorRow)
```

### 8.3 Hand Stream

```text
handIn = max_h(
  0.70 * strainRate(dtHand[h], 180, 38, 1.10)
+ 0.30 * rotation[h] * strainRate(dtHand[h], 205, 45, 1.05)
)
```

### 8.4 Chord

```text
body = max(0, rowSize - 2) * strainRate(dtRow, 150, 80, 0.85)

chordIn =
  rowChord * (1 + 0.18 * speedIn)
+ 0.22 * sameHandChord
+ body
```

### 8.5 Chordjack

```text
chordjackIn =
  rowChord * (
    0.55 * jackIn
  + 0.30 * sameHandOverlap
  + 0.15 * handIn
  )
```

### 8.6 Tech

```text
rhythmChaos =
  min(2, abs(log2((dtRow + 24) / (prevDtRow + 24)))) / 2

techIn =
  0.32 * rhythmChaos
+ 0.24 * entropy750
+ 0.24 * transitionEntropy750
+ 0.20 * (mask !== prevMask ? 1 : 0)
```

### 8.7 Stamina

Per-hand stamina state:

```text
handStamina[h] =
  decayState(handStamina[h],
             strainRate(dtHand[h], 180, 40, 1.08),
             dtHand[h],
             8000)
```

Input:

```text
staminaIn =
  0.40 * log1p(nps1000) / log(24)
+ 0.35 * log1p(nps4000) / log(24)
+ 0.25 * maxHandStamina
```

### 8.8 Course

```text
courseIn =
  staminaIn
* gate(activeDurationSec, 90, 300)
* (1 - 0.25 * gate(breakDensity, 0.006, 0.018))
```

---

## 9. Stage 4: Structural Numeric (`computeRoxyNumeric`)

### 9.1 Stream Summary

For each stream series:

| Statistic | Meaning |
|-----------|---------|
| `q50` | Median |
| `q75` | Sustained upper quartile |
| `q90` | High difficulty area |
| `q97` | Peak difficulty |
| `tailMean` | Mean of top 4% |
| `powerMean` | Power mean with `p = 2.4` |

Aggregate formula:

```text
aggregate =
  0.30 * q97
+ 0.22 * q90
+ 0.18 * tailMean
+ 0.15 * q75
+ 0.10 * powerMean
+ 0.05 * q50
```

### 9.2 Weighted Aggregate

```text
weightedAgg = sum(streamWeight[k] * aggregate[k])
```

### 9.3 Section Peak Aggregate

Roxy divides the chart into 400ms sections, takes the maximum `localRaw` per section, sorts section peaks descending, and applies:

```text
sectionAgg = sum(v[i] * 0.9^i) / sum(0.9^i)
```

### 9.4 Structural Raw Mapping

```text
rawAgg = 0.80 * weightedAgg + 0.20 * sectionAgg
logRaw = ln(1 + max(0, rawAgg))
preNumeric = clamp(linearMap(logRaw, 3.9947, 7.5454, -2, 20), -2.5, 21)
```

### 9.5 Structural Corrections

Roxy applies 9 structural corrections and clamps their sum to `[-1.25, 1.25]`.

| Correction | Purpose |
|------------|---------|
| `lowCj` | Boost low-speed, high-overlap chordjack |
| `highStream` | Boost high-rotation fast stream |
| `highCjDamp` | Dampen very dense non-fast chordjack |
| `courseBreakDamp` | Dampen long broken course maps |
| `courseSustainLift` | Boost sustained long maps |
| `denseJsLift` | Boost dense jumpstream-like structures |
| `denseJsDamp` | Dampen dense low-rotation patterns |
| `anchorLift` | Boost anchor/fast-jack patterns |
| `handBiasLift` | Boost one-hand-biased fast patterns |

Final structural score:

```text
rawNumeric = preNumeric + corrections.total
structuralNumeric = piecewiseLinear(rawNumeric, isotonicKnots)
```

The structural score is not the final Roxy output unless the meta model fails. It is an input feature and a fallback.

---

## 10. Stage 5: Reference Predictions

**Function**: `buildReferencePredictions(osuText, options, structuralNumeric)`

Roxy computes several reference predictions:

| Reference | Source |
|-----------|--------|
| `Azusa` | `runAzusaEstimatorFromText` |
| `Sunny` | `runSunnyEstimatorFromText` |
| `Daniel` | `runDanielEstimatorFromText` |
| `Mixed` | `runMixedEstimatorFromText` |
| `Companella` | Currently Sunny numeric as a synchronous placeholder |
| `Roxy` | Structural numeric from Roxy itself |

Reference options force `withGraph: false` to avoid unnecessary graph work.

Sunny is computed first and passed into Azusa and Mixed:

```js
runAzusaEstimatorFromText(osuText, {
  ...referenceOptions,
  precomputedSunnyResult: sunnyResult
});

runMixedEstimatorFromText(osuText, {
  ...referenceOptions,
  precomputedSunnyResult: sunnyResult
});
```

This avoids one repeated Sunny computation.

### 10.1 Numeric Extraction

`resultNumeric(result)`:

1. Uses `result.numericDifficulty` if it is a real finite value.
2. Otherwise parses `result.estDiff` with `rcLabelToNumeric`.
3. Returns `null` if no valid numeric can be recovered.

Labels containing `<` or `>` are considered invalid for numeric parsing.

---

## 11. Stage 6: Meta Feature Vector

**Function**: `buildRoxyMetaFeatures(referencePredictions, numericDetails, curve, structuralNumeric)`

The generated model expects exactly **119 features** in the order defined by `ROXY_META_FEATURE_NAMES`.

### 11.1 Reference Value Features

For each reference algorithm:

```text
pred_Azusa, has_Azusa
pred_Sunny, has_Sunny
pred_Daniel, has_Daniel
pred_Mixed, has_Mixed
pred_Companella, has_Companella
pred_Roxy, has_Roxy
```

### 11.2 Reference Summary Features

```text
pred_min
pred_max
pred_mean
pred_median
pred_range
```

### 11.3 Pairwise Difference Features

```text
diff_Azusa_Daniel, absdiff_Azusa_Daniel
diff_Azusa_Sunny, absdiff_Azusa_Sunny
diff_Azusa_Mixed, absdiff_Azusa_Mixed
diff_Azusa_Roxy, absdiff_Azusa_Roxy
diff_Daniel_Sunny, absdiff_Daniel_Sunny
diff_Daniel_Mixed, absdiff_Daniel_Mixed
diff_Mixed_Roxy, absdiff_Mixed_Roxy
diff_Sunny_Roxy, absdiff_Sunny_Roxy
```

### 11.4 Structural Numeric Features

```text
roxy_logRaw
roxy_rawAgg
roxy_preNumeric
roxy_rawNumeric
roxy_finalNumeric
```

Important: despite the name, `roxy_finalNumeric` is the **structural numeric** at runtime. It is not the GBDT output. The training script must also use `structuralNumeric`; otherwise the model leaks previous predictions and becomes unstable.

### 11.5 Correction Features

```text
corr_lowCj
corr_highStream
corr_highCjDamp
corr_courseBreakDamp
corr_courseSustainLift
corr_denseJsLift
corr_denseJsDamp
corr_anchorLift
corr_handBiasLift
corr_total
```

### 11.6 Stream Summary Features

For each stream:

```text
speed, handStream, jack, chordjack, tech, stamina, course
```

Roxy emits:

```text
aggregate, q97, q90, q75, q50, tailMean, powerMean
```

This contributes `7 * 7 = 49` features.

### 11.7 Global Statistics Features

```text
stat_activeDurationSec
stat_breakCount
stat_breakDensity
stat_avgNps
stat_chordRate
stat_threeRate
stat_overlapRate
stat_rotationRate
stat_sameHandQ10
stat_fastJackRate
stat_anchorRate
stat_anchorImbalance
stat_handBias
stat_peakToSustainGap
stat_rows
stat_taps
```

### 11.8 Interaction Features

```text
logAvgNps
logDuration
chordFast
chordOverlap
rotationInvQ10
breakPeak
```

---

## 12. Stage 7: GBDT Meta Model

**File**: `roxyMetaModel.generated.js`

The model is generated by `temp/roxy_meta_probe.py` and should not be edited manually.

### 12.1 Model Constants

| Constant | Value |
|----------|------:|
| Feature count | `119` |
| Tree count | `500` |
| Base value | `12.648447205` |
| Learning rate | `0.04` |
| Output clamp | `[-2, 20]` |
| Model file size | about `180 KB` |

### 12.2 Tree Format

Internal node:

```text
[featureIndex, threshold, leftNode, rightNode]
```

Leaf node:

```text
number
```

### 12.3 Evaluation

```js
let value = ROXY_META_BASE;

for (const tree of ROXY_META_TREES) {
  value += ROXY_META_LEARNING_RATE * treeValue(tree, features);
}

return clamp(value, -2, 20);
```

If the meta value is non-finite, Roxy falls back to the structural numeric:

```text
finalNumeric = finite(metaNumeric) ? metaNumeric : structuralNumeric
```

### 12.4 High Speed-Rate Guard

For `speedRate > 1`, Roxy does not trust the raw GBDT output directly. The meta model is trained on normal benchmark timings, and at extreme rate multipliers some reference estimators can become unavailable while the tree model falls into out-of-distribution leaves. This previously allowed high-difficulty maps to drop from about 18 to about 15.5 when applying a speed multiplier.

Roxy now switches the final high-rate output to a monotonic guard:

```text
baseline = Roxy(osuText, speedRate=1.0, _skipRoxySpeedRateGuard=true)
rateGain = log2(speedRate)

gainPerDoubling =
  1.00
+ 1.10 * gate(baseline, 10, 18)
+ 0.45 * gate(avgNps, 22, 50)
+ 0.35 * inverseGate(sameHandQ10, 25, 80)
+ 0.20 * gate(chordRate, 0.25, 0.55)

baselineFloor = baseline + rateGain * gainPerDoubling
extremeStructuralFloor = clamp(16.0 + 2.35 * max(0, logRaw - rawMap.p98) + 0.45 * rateGain, -2, 20)

finalNumeric = clamp(max(baselineFloor, extremeStructuralFloor), -2, 20)
```

The unguarded meta value is still exposed in debug as `unguardedNumeric` / `metaNumeric`. The final clamp remains `20` because the current RC label system only defines labels through `Kappa high`.

### 12.5 Graph Smoothing

Roxy's numeric calculation uses the raw `localRaw` row strain. Only the returned `graph` field is smoothed when `withGraph === true`.

The graph pipeline is:

```text
localRaw row values
-> 3-point median filter
-> forward exponential smoothing, tau = 650ms
-> backward exponential smoothing, tau = 650ms
-> 0.12 raw + 0.88 smoothed blend
-> graph.values
```

This removes row-level visual spikes without changing `numericDifficulty`, `rawNumericDifficulty`, stream summaries, or meta features.

---

## 13. Debug Output

Successful Roxy output includes:

```js
debug: {
  notes,
  rows,
  rawAgg,
  logRaw,
  preNumeric,
  rawNumeric,
  structuralNumeric,
  metaNumeric,
  finalNumeric,
  meta: {
    featureCount,
    references
  },
  stats,
  corrections,
  streams
}
```

`meta.references` records the numeric value recovered from each reference estimator:

```js
{
  Azusa,
  Sunny,
  Daniel,
  Mixed,
  Companella,
  Roxy
}
```

Unavailable references are shown as `null` in debug formatting.

---

## 14. Benchmark and Training

### 14.1 Benchmark Runner

Roxy has a dedicated runner:

```text
docs/runner/benchmark-roxy.mjs
docs/runner/run-roxy-benchmark.ps1
```

Run:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\docs\runner\run-roxy-benchmark.ps1
```

Outputs:

| File | Description |
|------|-------------|
| `docs/data/Roxy.csv` | Per-map benchmark output |
| `temp/Roxy-metrics.json` | Aggregate metrics |
| `temp/Roxy-debug.json` | Debug rows, excluding graph data |
| `docs/data/index.json` | Data index update |

### 14.2 Training Script

```text
temp/roxy_meta_probe.py
```

The script:

1. Reads benchmark CSV files from `docs/data`.
2. Reads `temp/Roxy-debug.json`.
3. Aligns debug rows by `(bid, name, pattern, subPattern, expected)`.
4. Builds the 119-feature matrix.
5. Compares Ridge and GBDT probes.
6. Emits `roxyMetaModel.generated.js`.

Emit command:

```powershell
python -u temp/roxy_meta_probe.py --emit-js
```

### 14.3 Critical Training Invariants

1. Do not align debug rows by array index. Roxy skips LN rows, so index alignment drifts.
2. `roxy_finalNumeric` in the feature schema must use structural numeric, not previous meta output.
3. Reference parsing must match runtime behavior.
4. Regenerate the model after changing reference estimators, structural features, or label parsing.

---

## 15. Final Benchmark Metrics

Final local benchmark result:

| Metric | Value |
|--------|------:|
| Numeric rows | `644` |
| Status / skipped rows | `102` |
| Exact | `638` (`99.07%`) |
| Close | `5` |
| Close+ | `643` (`99.84%`) |
| Moderate | `1` (`0.16%`) |
| Miss | `0` (`0%`) |
| KPI1 | `PASS` |

Azusa baseline at the same benchmark state:

| Metric | Value |
|--------|------:|
| Numeric rows | `644` |
| Exact | `268` (`41.61%`) |
| Close+ | `516` (`80.12%`) |
| Moderate | `96` (`14.91%`) |
| Miss | `32` (`4.97%`) |

Roxy therefore passes KPI1 on the local benchmark and also passes all lower KPI requirements.

---

## 16. Algorithm Complexity

Let:

- `n` = tap note count
- `r` = row count
- `s` = section count

### 16.1 Structural Layer

| Step | Complexity |
|------|------------|
| Tap extraction | `O(n)` |
| Tap sorting | `O(n log n)` |
| Row merge | `O(n)` |
| NPS windows | `O(n + r)` |
| Entropy windows | `O(r)` amortized |
| Stream updates | `O(r)` |
| Stream summaries | `O(r log r)` per stream |
| Section aggregate | `O(r + s log s)` |

Overall structural complexity:

```text
O(n log n + r log r)
```

### 16.2 Reference Layer

Roxy also computes Sunny, Azusa, Daniel, and Mixed. These dominate runtime more than the GBDT itself.

Optimizations already present:

- Sunny result is passed to Azusa.
- Sunny result is passed to Mixed.
- Reference graph output is disabled.
- For `speedRate > 1`, Roxy also computes one internal `speedRate=1.0` baseline for the monotonic speed-rate guard. This roughly doubles Roxy cost only for high-rate calls.

Remaining optimization opportunity:

- Mixed can still duplicate some Azusa / Daniel work internally. Passing more precomputed references would reduce runtime.

### 16.3 Meta Model

The generated GBDT uses:

```text
500 trees * depth <= 4
```

This is roughly two thousand comparisons and additions. Model evaluation remains negligible compared with parsing and reference estimators.

### 16.4 Space Complexity

Structural analysis stores:

- taps: `O(n)`
- rows: `O(r)`
- seven stream arrays: `O(7r)`
- graph arrays when requested: `O(r)`
- debug summaries: `O(1)` plus optional arrays in graph

Overall:

```text
O(n + r)
```

---

## 17. Browser Compatibility

Roxy is implemented as pure JavaScript ES modules:

- no Node.js APIs in runtime estimator code
- no DOM access
- no `window` / `document`
- no direct WASM or ONNX loading

This keeps it compatible with:

- tosu browser overlay
- Web Worker execution
- Node benchmark runner

The dedicated benchmark runner is Node-only, but the estimator itself is shared browser-safe code.

---

## 18. Integration Notes

Roxy is registered in:

| File | Change |
|------|--------|
| `config.js` | Adds `Roxy` to estimator options |
| `settings.json` | Adds `Roxy` to user-facing estimator choices |
| `settingsParser.js` | Parses `"roxy"` as `"Roxy"` |
| `compute.worker.js` | Adds worker support and invalid fallback |
| `analysis.js` | Adds app-level Roxy branch |

Fallback behavior:

- If Roxy returns invalid, Sunny is used as fallback.
- Worker returns `actualEstimatorAlgorithm`.
- App layer uses this value to avoid showing `Roxy` when the actual estimate came from Sunny.

---

## 19. Limitations and Risks

### 19.1 Generalization Risk

Roxy passes the full local benchmark, but group-split probes were weaker than full benchmark metrics. This means the generated meta head is benchmark-distribution-sensitive.

Current recommendation:

- Roxy is valid as an experimental high-accuracy 4K RC estimator.
- Do not automatically promote it to Mixed default without external chart validation.

### 19.2 Dependency Risk

Roxy depends on the numeric behavior of:

- Sunny
- Azusa
- Daniel
- Mixed

Any major change to those estimators can shift Roxy's meta feature distribution. After such changes, rerun benchmark and regenerate the model if necessary.

### 19.3 Runtime Cost

Roxy is heavier than Azusa because it runs several reference estimators. It is acceptable for single-map overlay use, but slower in full benchmark runs.

### 19.4 Companella Placeholder

`pred_Companella` currently uses Sunny as a synchronous placeholder. Real Companella uses async ONNX/WASM flow and is not called inside Roxy.

---

## 20. Maintenance Workflow

Recommended workflow after modifying Roxy or any reference estimator:

1. Run Roxy benchmark:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\docs\runner\run-roxy-benchmark.ps1
```

2. Probe model/training behavior:

```powershell
python -u temp/roxy_meta_probe.py
```

3. Regenerate model if metrics improve or features changed:

```powershell
python -u temp/roxy_meta_probe.py --emit-js
```

4. Run full benchmark again.

5. Confirm KPI1:

```text
Exact >= 98%
Miss = 0
```

6. Run syntax checks:

```powershell
node --check "ManiaMapAnalyser by Leo_Black/js/estimator/roxyEstimator.js"
node --check "ManiaMapAnalyser by Leo_Black/js/estimator/roxyMetaModel.generated.js"
node --check "ManiaMapAnalyser by Leo_Black/js/estimator/rcDifficultyFormat.js"
node --check "ManiaMapAnalyser by Leo_Black/js/estimator/mixedEstimator.js"
node --check "ManiaMapAnalyser by Leo_Black/js/app/worker/compute.worker.js"
node --check "ManiaMapAnalyser by Leo_Black/js/app/analysis.js"
node --check "docs/runner/benchmark-roxy.mjs"
```

---

## 21. Future Improvements

Potential improvements:

1. Pass precomputed Azusa and Daniel results into Mixed to reduce duplicate work.
2. Replace the synchronous `pred_Companella = Sunny` placeholder with a true async Companella feature in a main-thread-only variant.
3. Add an external chart validation set to measure generalization.
4. Improve the structural estimator so the meta model depends less on existing estimators.
5. Store model metadata: training data hash, feature schema version, full metrics, split metrics, and generation timestamp.
6. Report subpattern metrics, especially for course, dense chordjack, anchor chordjack, high stream, and low stream.
