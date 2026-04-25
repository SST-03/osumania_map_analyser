import { OsuFileParser } from "../parser/osuFileParser.js";
import { runDanielEstimatorFromText } from "./danielEstimator.js";
import { runSunnyEstimatorFromText } from "./sunnyEstimator.js";

const AZUSA_CONFIG = Object.freeze({
    rcLnRatioLimit: 0.18,
    minNotes: 80,
    rowToleranceMs: 2,
    quantiles: Object.freeze({
        q99: 0.99,
        q97: 0.97,
        q94: 0.94,
    }),
    skillWeights: Object.freeze({
        speed: 0.38,
        stamina: 0.26,
        chord: 0.18,
        tech: 0.18,
    }),
    localPower: 2.15,
    postPower: 3.4,
    decayWindowsMs: Object.freeze([140, 280, 560, 980]),
    decayWeights: Object.freeze([0.34, 0.30, 0.22, 0.14]),
    rcBlendWeights: Object.freeze({
        azusaResidual: 0.05,
        sunnyResidual: 0.15,
        lowRangeLift: 0.40,
        danielFallback: 0.75,
        azusaFallback: 0.20,
        sunnyFallback: 0.08,
        globalOffset: -0.50,
    }),
});

const GREEK_BY_INDEX = Object.freeze([
    "Alpha",
    "Beta",
    "Gamma",
    "Delta",
    "Epsilon",
    "Emik Zeta",
    "Thaumiel Eta",
    "CloverWisp Theta",
    "Iota",
    "Kappa",
]);

const RC_TIER_CANDIDATES = Object.freeze([
    Object.freeze({ suffix: "low", offset: -0.4 }),
    Object.freeze({ suffix: "mid/low", offset: -0.2 }),
    Object.freeze({ suffix: "mid", offset: 0 }),
    Object.freeze({ suffix: "mid/high", offset: 0.2 }),
    Object.freeze({ suffix: "high", offset: 0.4 }),
]);

const AZUSA_CALIBRATION_LOW_BLOCKS = Object.freeze([
    [1.9220, 1.9220, 1.0000],
    [2.3660, 2.7684, 1.6667],
    [2.8394, 2.8394, 2.0000],
    [2.8584, 3.7162, 2.3333],
    [3.7798, 3.7798, 3.0000],
    [3.8667, 3.8667, 3.0000],
    [4.2067, 5.2039, 4.3333],
    [5.2506, 5.7713, 5.0667],
    [5.8603, 6.1512, 5.3333],
    [6.3292, 6.8785, 6.0000],
    [7.1715, 7.3617, 6.2000],
    [7.4079, 7.8734, 7.2000],
    [8.0160, 8.4003, 8.2500],
    [8.4133, 8.4133, 9.0000],
    [8.9031, 9.4775, 9.5667],
    [9.6488, 9.6488, 10.0000],
    [9.8301, 9.8301, 10.3000],
]);

const AZUSA_CALIBRATION_HIGH_BLOCKS = Object.freeze([
    [11.4336, 11.4336, 10.4000],
    [11.4436, 11.4436, 10.5000],
    [11.6012, 11.6665, 10.6500],
    [11.6696, 12.2317, 11.5000],
    [12.3295, 12.3919, 11.7500],
    [12.5238, 12.5238, 12.0000],
    [12.5318, 12.8329, 12.1400],
    [12.8605, 12.9781, 12.2800],
    [12.9868, 13.1170, 12.7800],
    [13.2003, 13.4418, 12.7857],
    [13.4660, 13.5829, 12.9250],
    [13.6044, 13.9924, 13.3667],
    [14.0583, 14.0583, 13.4000],
    [14.0795, 14.2266, 13.4600],
    [14.2346, 14.2346, 13.6000],
    [14.2414, 14.2414, 13.7000],
    [14.2903, 14.2903, 14.0000],
    [14.3258, 14.4760, 14.1200],
    [14.5365, 14.6006, 14.1333],
    [14.7269, 14.8716, 14.1333],
    [15.0048, 15.0048, 14.4000],
    [15.0521, 15.0521, 14.4000],
    [15.0521, 15.0521, 14.4000],
    [15.0950, 15.0950, 14.4000],
    [15.2335, 15.2335, 14.4000],
    [15.2388, 15.5821, 14.7385],
    [15.6977, 15.7002, 14.8500],
    [15.7535, 16.1593, 15.0667],
    [16.2009, 16.2958, 15.1000],
    [16.3172, 16.4748, 15.7600],
    [16.5620, 16.9083, 15.9833],
    [16.9485, 16.9485, 16.0000],
    [17.0216, 17.3799, 16.1000],
    [17.4616, 17.4616, 16.4000],
    [17.5167, 17.5167, 16.4000],
    [17.5306, 17.9077, 16.6400],
    [18.1973, 18.1973, 17.2000],
    [18.2026, 18.2026, 17.2000],
    [18.4562, 19.3477, 17.9500],
]);

const AZUSA_ISOTONIC_POINTS = Object.freeze([
    [1.2900, 1],
    [1.2900, 1],
    [1.3900, 1],
    [1.3900, 1],
    [1.4700, 1],
    [1.4700, 1],
    [1.9000, 2],
    [1.9000, 2],
    [2.0600, 2],
    [2.2200, 2],
    [2.3200, 2],
    [2.3200, 2],
    [2.5100, 3],
    [2.5100, 3],
    [2.9000, 3.3333333333333335],
    [2.9800, 3.3333333333333335],
    [4.0100, 4],
    [4.0100, 4],
    [4.5100, 4],
    [4.5100, 4],
    [4.8300, 4.2],
    [4.8300, 4.2],
    [4.9400, 5],
    [4.9400, 5],
    [5.0400, 5],
    [5.0400, 5],
    [5.2000, 5],
    [5.2000, 5],
    [5.2800, 5],
    [5.2800, 5],
    [5.3300, 5.666666666666667],
    [5.5900, 5.666666666666667],
    [5.7700, 6],
    [5.7700, 6],
    [5.8700, 6],
    [5.8700, 6],
    [5.8700, 6],
    [5.8700, 6],
    [6.0700, 6.6],
    [6.0700, 6.6],
    [6.3300, 6.733333333333333],
    [6.9200, 6.733333333333333],
    [7.1100, 7],
    [7.1100, 7],
    [7.4600, 8.3],
    [8.0500, 8.3],
    [8.2500, 8.333333333333334],
    [8.4800, 8.333333333333334],
    [9.3200, 9.183333333333334],
    [9.6200, 9.183333333333334],
    [9.6400, 9.5],
    [9.7100, 9.5],
    [9.9800, 10.325],
    [10.1500, 10.325],
    [10.3000, 10.37142857142857],
    [10.9900, 10.37142857142857],
    [11.0000, 10.9],
    [11.0400, 10.9],
    [11.0700, 11.22857142857143],
    [11.3600, 11.22857142857143],
    [11.4500, 11.866666666666667],
    [11.7400, 11.866666666666667],
    [11.9300, 12.0875],
    [12.2000, 12.0875],
    [12.2900, 12.466666666666667],
    [12.5200, 12.466666666666667],
    [12.5600, 12.5],
    [12.6400, 12.5],
    [12.7400, 12.56],
    [12.9200, 12.56],
    [12.9800, 12.6],
    [12.9800, 12.6],
    [12.9900, 12.7],
    [12.9900, 12.7],
    [13.0000, 13],
    [13.0000, 13],
    [13.0400, 13.266666666666667],
    [13.2800, 13.266666666666667],
    [13.2900, 13.533333333333333],
    [13.3300, 13.533333333333333],
    [13.3400, 13.55],
    [13.3600, 13.55],
    [13.4000, 13.62],
    [13.5600, 13.62],
    [13.7200, 13.8],
    [13.7200, 13.8],
    [13.9500, 14],
    [13.9500, 14],
    [14.0200, 14],
    [14.0200, 14],
    [14.0500, 14.05],
    [14.2000, 14.05],
    [14.2100, 14.199999999999998],
    [14.3400, 14.199999999999998],
    [14.3700, 14.266666666666666],
    [14.3700, 14.266666666666666],
    [14.4400, 14.4],
    [14.4400, 14.4],
    [14.4400, 14.4],
    [14.4400, 14.4],
    [14.4700, 14.5],
    [14.4700, 14.5],
    [14.5200, 14.674999999999999],
    [14.6700, 14.674999999999999],
    [14.8000, 14.825],
    [14.9000, 14.825],
    [14.9300, 15],
    [15.1500, 15],
    [15.3100, 15.2],
    [15.3500, 15.2],
    [15.3700, 15.666666666666666],
    [15.5300, 15.666666666666666],
    [15.5400, 15.675],
    [15.7200, 15.675],
    [15.7200, 15.8],
    [15.7200, 15.8],
    [15.7500, 15.9],
    [15.7500, 15.9],
    [15.7800, 16],
    [16.0700, 16],
    [16.0900, 16.266666666666666],
    [16.1500, 16.266666666666666],
    [16.3500, 16.4],
    [16.3500, 16.4],
    [16.3500, 16.4],
    [16.3500, 16.4],
    [16.4100, 16.4],
    [16.5100, 16.4],
    [16.5300, 16.533333333333335],
    [16.6500, 16.533333333333335],
    [17.5500, 17.2],
    [17.5500, 17.2],
    [17.6800, 17.2],
    [17.6800, 17.2],
    [17.9100, 17.95],
    [18.0200, 17.95],
]);

function buildErrorResult(code, message, extras = {}) {
    return {
        star: Number.NaN,
        lnRatio: Number.isFinite(extras.lnRatio) ? extras.lnRatio : 0,
        columnCount: Number.isFinite(extras.columnCount) ? extras.columnCount : 0,
        estDiff: `Invalid: ${message}`,
        numericDifficulty: null,
        numericDifficultyHint: code,
        graph: null,
        rawNumericDifficulty: null,
        debug: {
            code,
            message,
        },
    };
}

function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
}

function safeDiv(a, b, fallback = 0) {
    if (!Number.isFinite(a) || !Number.isFinite(b) || Math.abs(b) < 1e-9) {
        return fallback;
    }
    return a / b;
}

function formatRcBaseLabel(base) {
    if (base <= 0) {
        const introLevel = clamp(base + 3, 1, 3);
        return `Intro ${introLevel}`;
    }

    if (base <= 10) {
        return `Reform ${base}`;
    }

    const greekIndex = clamp(base - 11, 0, GREEK_BY_INDEX.length - 1);
    return GREEK_BY_INDEX[greekIndex];
}

function numericToRcLabel(numeric) {
    const value = Number(numeric);
    if (!Number.isFinite(value)) {
        return "Invalid";
    }

    const clamped = clamp(value, -2.4, 20.4);
    let bestMatch = null;

    for (let base = -2; base <= 20; base += 1) {
        for (const tier of RC_TIER_CANDIDATES) {
            const centerValue = base + tier.offset;
            const distance = Math.abs(clamped - centerValue);
            if (!bestMatch || distance < bestMatch.distance) {
                bestMatch = {
                    base,
                    suffix: tier.suffix,
                    distance,
                };
            }
        }
    }

    if (!bestMatch) {
        return "Invalid";
    }

    return `${formatRcBaseLabel(bestMatch.base)} ${bestMatch.suffix}`;
}

function estimateDanielNumeric(result) {
    const numericRaw = result?.numericDifficulty;
    if (typeof numericRaw === "number" && Number.isFinite(numericRaw)) {
        return numericRaw;
    }

    if (typeof numericRaw === "string" && numericRaw.trim().length > 0) {
        const parsed = Number(numericRaw);
        if (Number.isFinite(parsed)) {
            return parsed;
        }
    }

    const star = Number(result?.star);
    if (!Number.isFinite(star)) {
        return null;
    }

    // Piecewise map keeps Daniel high-end semantics while extending low-end below Alpha.
    if (star >= 6.56) {
        const normalized = clamp((star - 6.56) / 0.58, 0, 9.99);
        return Number((11 + normalized).toFixed(2));
    }

    const lowPart = -2 + 13 * Math.pow(clamp(star / 6.56, 0, 1), 1.72);
    return Number(lowPart.toFixed(2));
}

function estimateSunnyNumeric(result) {
    const star = Number(result?.star);
    if (!Number.isFinite(star)) {
        return null;
    }

    const numeric = 2.85 + 1.33 * star;
    return Number(clamp(numeric, -2, 20).toFixed(2));
}

function quantileFromSorted(sortedValues, q) {
    if (!sortedValues.length) {
        return 0;
    }

    const t = clamp(Number(q), 0, 1) * (sortedValues.length - 1);
    const left = Math.floor(t);
    const right = Math.min(sortedValues.length - 1, left + 1);
    const w = t - left;
    return (sortedValues[left] * (1 - w)) + (sortedValues[right] * w);
}

function powerMean(values, p) {
    if (!values.length) {
        return 0;
    }

    let acc = 0;
    for (const value of values) {
        acc += Math.pow(Math.max(value, 0), p);
    }
    return Math.pow(acc / values.length, 1 / p);
}

function buildTapNotes(parsed) {
    const taps = [];
    const columns = parsed.columns || [];
    const starts = parsed.noteStarts || [];

    for (let i = 0; i < columns.length; i += 1) {
        const col = Number(columns[i]);
        const time = Number(starts[i]);
        if (!Number.isFinite(col) || !Number.isFinite(time)) {
            continue;
        }

        taps.push({
            t: time,
            c: col,
            hand: col < 2 ? 0 : 1,
            rowSize: 1,
        });
    }

    taps.sort((a, b) => {
        if (a.t !== b.t) return a.t - b.t;
        return a.c - b.c;
    });

    return taps;
}

function annotateRows(taps, toleranceMs) {
    if (!taps.length) {
        return;
    }

    let rowStart = 0;
    for (let i = 1; i <= taps.length; i += 1) {
        const shouldFlush = i === taps.length || Math.abs(taps[i].t - taps[rowStart].t) > toleranceMs;
        if (!shouldFlush) {
            continue;
        }

        const rowSize = i - rowStart;
        for (let j = rowStart; j < i; j += 1) {
            taps[j].rowSize = rowSize;
        }
        rowStart = i;
    }
}

function expDecayFactor(dtMs, tauMs) {
    if (!Number.isFinite(dtMs) || dtMs <= 0) {
        return 1;
    }
    return Math.exp(-dtMs / tauMs);
}

function skillFromStates(states) {
    let sum = 0;
    for (let i = 0; i < states.length; i += 1) {
        sum += states[i] * AZUSA_CONFIG.decayWeights[i];
    }
    return sum;
}

function buildDifficultyCurve(taps) {
    const states = {
        speed: Array.from({ length: AZUSA_CONFIG.decayWindowsMs.length }, () => 0),
        stamina: Array.from({ length: AZUSA_CONFIG.decayWindowsMs.length }, () => 0),
        chord: Array.from({ length: AZUSA_CONFIG.decayWindowsMs.length }, () => 0),
        tech: Array.from({ length: AZUSA_CONFIG.decayWindowsMs.length }, () => 0),
    };

    const lastByColumn = [-1e9, -1e9, -1e9, -1e9];
    const lastByHand = [-1e9, -1e9];

    const density250 = [];
    const density500 = [];
    const jackRawSeries = [];
    const columnCounts = [0, 0, 0, 0];
    let chordNoteCount = 0;
    let cursor250 = 0;
    let cursor500 = 0;

    const local = [];
    const speedSeries = [];
    const staminaSeries = [];
    const chordSeries = [];
    const techSeries = [];
    const times = [];

    let prevTime = taps[0]?.t ?? 0;
    let prevAny1 = -1e9;
    let prevAny2 = -1e9;
    let prevCol = 0;

    for (let i = 0; i < taps.length; i += 1) {
        const note = taps[i];
        const t = note.t;
        const c = note.c;
        columnCounts[c] += 1;
        if (note.rowSize >= 2) {
            chordNoteCount += 1;
        }

        const dtGlobal = i === 0 ? 0 : Math.max(0, t - prevTime);
        const dtSame = Math.max(0, t - lastByColumn[c]);
        const dtHand = Math.max(0, t - lastByHand[note.hand]);
        const dtAny = Math.max(0, t - prevAny1);

        while (cursor250 < i && t - taps[cursor250].t > 250) cursor250 += 1;
        while (cursor500 < i && t - taps[cursor500].t > 500) cursor500 += 1;

        const d250 = (i - cursor250 + 1) / 0.25;
        const d500 = (i - cursor500 + 1) / 0.5;
        density250.push(d250);
        density500.push(d500);

        const jack = Math.pow(190 / (dtSame + 35), 1.16);
        jackRawSeries.push(jack);
        const stream = Math.pow(170 / (dtAny + 30), 1.07);
        const handStream = Math.pow(185 / (dtHand + 42), 1.08);

        const movement = Math.abs(c - prevCol) / 3;
        const rhythmRatio = safeDiv(Math.max(dtAny, 1), Math.max(t - prevAny2, 1), 1);
        const rhythmChaos = Math.abs(Math.log2(clamp(rhythmRatio, 0.2, 5)));

        const rowChord = Math.max(0, note.rowSize - 1);
        const chord = Math.pow(rowChord + 1, 1.22) - 1;

        const speedInput = 0.54 * stream + 0.28 * handStream + 0.18 * jack;
        const staminaInput = 0.48 * (d500 / 11) + 0.27 * (d250 / 15) + 0.25 * stream;
        const chordInput = chord * (1 + 0.22 * Math.min(1.5, stream));
        const techInput = 0.45 * rhythmChaos + 0.30 * movement + 0.25 * (rowChord > 0 ? 1 + 0.3 * rowChord : 0);

        for (let j = 0; j < AZUSA_CONFIG.decayWindowsMs.length; j += 1) {
            const tau = AZUSA_CONFIG.decayWindowsMs[j];
            const decay = expDecayFactor(dtGlobal, tau);
            states.speed[j] = states.speed[j] * decay + speedInput;
            states.stamina[j] = states.stamina[j] * decay + staminaInput;
            states.chord[j] = states.chord[j] * decay + chordInput;
            states.tech[j] = states.tech[j] * decay + techInput;
        }

        const speedSkill = skillFromStates(states.speed);
        const staminaSkill = skillFromStates(states.stamina);
        const chordSkill = skillFromStates(states.chord);
        const techSkill = skillFromStates(states.tech);

        const p = AZUSA_CONFIG.localPower;
        const combined = Math.pow(
            (
                AZUSA_CONFIG.skillWeights.speed * Math.pow(Math.max(speedSkill, 0), p)
                + AZUSA_CONFIG.skillWeights.stamina * Math.pow(Math.max(staminaSkill, 0), p)
                + AZUSA_CONFIG.skillWeights.chord * Math.pow(Math.max(chordSkill, 0), p)
                + AZUSA_CONFIG.skillWeights.tech * Math.pow(Math.max(techSkill, 0), p)
            )
            / (
                AZUSA_CONFIG.skillWeights.speed
                + AZUSA_CONFIG.skillWeights.stamina
                + AZUSA_CONFIG.skillWeights.chord
                + AZUSA_CONFIG.skillWeights.tech
            ),
            1 / p,
        );

        local.push(combined);
        speedSeries.push(speedSkill);
        staminaSeries.push(staminaSkill);
        chordSeries.push(chordSkill);
        techSeries.push(techSkill);
        times.push(t);

        prevAny2 = prevAny1;
        prevAny1 = t;
        prevTime = t;
        prevCol = c;
        lastByColumn[c] = t;
        lastByHand[note.hand] = t;
    }

    return {
        local,
        speedSeries,
        staminaSeries,
        chordSeries,
        techSeries,
        times,
        density250,
        density500,
        jackRawSeries,
        columnCounts,
        chordNoteCount,
    };
}

function computeAzusaNumericFromCurve(curve, noteCount) {
    const local = curve.local;
    if (!local.length) {
        return 0;
    }

    const summarize = (values) => {
        const sorted = [...values].sort((a, b) => a - b);
        const q97 = quantileFromSorted(sorted, 0.97);
        const q94 = quantileFromSorted(sorted, 0.94);
        const q90 = quantileFromSorted(sorted, 0.90);
        const q75 = quantileFromSorted(sorted, 0.75);
        const q50 = quantileFromSorted(sorted, 0.50);
        const tailCount = Math.max(8, Math.floor(sorted.length * 0.04));
        const tailSlice = sorted.slice(sorted.length - tailCount);
        const tailMean = tailSlice.reduce((acc, value) => acc + value, 0) / tailSlice.length;
        const pm = powerMean(values, 2.6);
        return { q97, q94, q90, q75, q50, tailMean, pm };
    };

    const speed = summarize(curve.speedSeries);
    const stamina = summarize(curve.staminaSeries);
    const chord = summarize(curve.chordSeries);
    const tech = summarize(curve.techSeries);

    const density250 = powerMean(curve.density250, 1.18);
    const density500 = powerMean(curve.density500, 1.12);
    const lengthBoost = Math.log1p(noteCount / 140);

    const peakBlend =
        (0.26 * speed.q97)
        + (0.24 * stamina.q97)
        + (0.18 * chord.q97)
        + (0.12 * tech.q97)
        + (0.07 * speed.q90)
        + (0.05 * stamina.q90)
        + (0.03 * chord.q90)
        + (0.02 * tech.q90);

    const sustainBlend =
        (0.20 * speed.q75)
        + (0.18 * stamina.q75)
        + (0.11 * chord.q75)
        + (0.08 * tech.q75)
        + (0.12 * speed.tailMean)
        + (0.10 * stamina.tailMean)
        + (0.06 * chord.tailMean)
        + (0.05 * tech.tailMean);

    const densityBlend = (0.14 * Math.log1p(density250)) + (0.22 * Math.log1p(density500));
    const midBlend = (0.18 * speed.q50) + (0.15 * stamina.q50) + (0.10 * chord.q50) + (0.08 * tech.q50);

    const raw = (0.58 * peakBlend) + (0.24 * sustainBlend) + (0.10 * densityBlend) + (0.08 * midBlend) + (0.06 * lengthBoost);
    const scaled = 0.82 + (0.41 * raw);

    const maxColumn = Math.max(...curve.columnCounts);
    const anchorImbalance = safeDiv((maxColumn / Math.max(noteCount, 1)) - 0.25, 0.75, 0);
    const chordRate = safeDiv(curve.chordNoteCount, Math.max(noteCount, 1), 0);
    const jackSorted = [...curve.jackRawSeries].sort((a, b) => a - b);
    const jackQ95 = quantileFromSorted(jackSorted, 0.95);

    const jackAnchorBoost = clamp(
        1.65
        * Math.max(0, anchorImbalance)
        * Math.max(0, 1 - (1.85 * chordRate))
        * Math.max(0, jackQ95 - 2.2),
        0,
        2.2,
    );

    const lowJackBoost = clamp(
        1.1
        * clamp((12.2 - scaled) / 4.5, 0, 1)
        * Math.max(0, anchorImbalance - 0.08)
        * Math.max(0, jackQ95 - 1.7)
        * (0.9 + (0.6 * Math.max(0, 0.22 - chordRate))),
        0,
        1.35,
    );

    const corrected = scaled + jackAnchorBoost + lowJackBoost;
    return clamp(corrected, -2, 20);
}

function resolveRcBlendComponents(primaryNumeric, danielNumeric, sunnyNumeric, curveHints = null) {
    const primary = Number.isFinite(primaryNumeric) ? primaryNumeric : null;
    const daniel = Number.isFinite(danielNumeric) ? danielNumeric : null;
    const sunny = Number.isFinite(sunnyNumeric) ? sunnyNumeric : null;

    if (daniel == null && primary == null && sunny == null) {
        return {
            value: null,
            lowGateSource: null,
            lowGate: null,
            highGate: null,
            lowBase: null,
            highBase: null,
        };
    }

    const lowGateSource = daniel != null ? daniel : (sunny ?? primary ?? 0);
    const lowGate = clamp((9.61 - lowGateSource) / 4.94, 0, 1);
    const highGate = 1 - lowGate;

    const lowBase = (() => {
        if (sunny == null) {
            return null;
        }

        let value = (-8.317) + (1.536 * sunny);
        if (primary != null) {
            value += 0.011 * primary;
        }
        if (daniel != null) {
            value += 0.049 * daniel;
        }

        if (lowGate > 0) {
            const primaryPart = primary != null ? Math.max(0, primary - 10.4) : 0;
            const sunnyPart = Math.max(0, sunny - 9.84);
            const lowSunnyConvex = Math.pow(Math.max(0, 7.935 - sunny), 2);
            value += lowGate * ((0.442 * sunnyPart) + (0.016 * primaryPart) + (0.235 * lowSunnyConvex));
        }

        return value;
    })();

    const highBase = (() => {
        const dUse = daniel != null ? daniel : (sunny ?? primary);
        if (dUse == null) {
            return null;
        }

        const primaryUse = primary ?? dUse;
        const sunnyUse = sunny ?? dUse;

        let value = (0.809 * dUse) + (0.057 * primaryUse) + (0.165 * sunnyUse) + 0.183;

        const highMask = clamp((lowGateSource - 14.83) / 2.667, 0, 1);
        if (highMask > 0) {
            value += highMask
            * ((-0.154 * Math.max(0, primaryUse - dUse)) + (0.081 * Math.max(0, sunnyUse - dUse)));
        }

        const anchorImbalance = Number.isFinite(curveHints?.anchorImbalance) ? curveHints.anchorImbalance : null;
        const chordRate = Number.isFinite(curveHints?.chordRate) ? curveHints.chordRate : null;
        const jackQ95 = Number.isFinite(curveHints?.jackQ95) ? curveHints.jackQ95 : null;
        if (anchorImbalance != null && chordRate != null && jackQ95 != null) {
            const anchorLift = clamp(
                0.96
                * Math.max(0, jackQ95 - 2.08)
                * Math.max(0, 0.24 - chordRate)
                * Math.max(0, anchorImbalance - 0.10),
                0,
                0.88,
            );
            value += anchorLift;
        }

        return value;
    })();

    const lowLift = Number.isFinite(lowGateSource)
        ? Math.max(0, 9.889 - lowGateSource) * 0.257
        : 0;

    if (lowBase == null && highBase == null) {
        return {
            value: null,
            lowGateSource,
            lowGate,
            highGate,
            lowBase,
            highBase,
        };
    }

    if (lowBase == null) {
        return {
            value: highBase,
            lowGateSource,
            lowGate,
            highGate,
            lowBase,
            highBase,
        };
    }

    if (highBase == null) {
        return {
            value: lowBase + lowLift,
            lowGateSource,
            lowGate,
            highGate,
            lowBase,
            highBase,
        };
    }

    return {
        value: (lowBase * lowGate) + ((highBase + lowLift) * highGate),
        lowGateSource,
        lowGate,
        highGate,
        lowBase,
        highBase,
    };
}

function interpolateCalibration(value, knots) {
    const x = Number(value);
    if (!Number.isFinite(x) || !Array.isArray(knots) || knots.length < 2) {
        return x;
    }

    if (x <= knots[0][0]) {
        return knots[0][1];
    }

    const last = knots.length - 1;
    if (x >= knots[last][0]) {
        return knots[last][1];
    }

    for (let i = 0; i < last; i += 1) {
        const x0 = knots[i][0];
        const y0 = knots[i][1];
        const x1 = knots[i + 1][0];
        const y1 = knots[i + 1][1];
        if (x >= x0 && x <= x1) {
            return y0 + safeDiv((x - x0) * (y1 - y0), x1 - x0, 0);
        }
    }

    return x;
}

function interpolateCalibrationBlocks(value, blocks) {
    const x = Number(value);
    if (!Number.isFinite(x) || !Array.isArray(blocks) || blocks.length === 0) {
        return x;
    }

    if (x <= blocks[0][0]) {
        return blocks[0][2];
    }

    for (let i = 0; i < blocks.length; i += 1) {
        const [x0, x1, y] = blocks[i];
        if (x >= x0 && x <= x1) {
            return y;
        }

        if (i < blocks.length - 1) {
            const next = blocks[i + 1];
            const nextX0 = next[0];
            if (x > x1 && x < nextX0) {
                const t = safeDiv(x - x1, nextX0 - x1, 0);
                return (y * (1 - t)) + (next[2] * t);
            }
        }
    }

    return blocks[blocks.length - 1][2];
}

function calibrateAzusaNumeric(value, lowGate = null, highGate = null) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) {
        return numeric;
    }

    const low = interpolateCalibrationBlocks(numeric, AZUSA_CALIBRATION_LOW_BLOCKS);
    const high = interpolateCalibrationBlocks(numeric, AZUSA_CALIBRATION_HIGH_BLOCKS);

    const lg = Number.isFinite(lowGate) ? clamp(Number(lowGate), 0, 1) : null;
    const hg = Number.isFinite(highGate) ? clamp(Number(highGate), 0, 1) : null;

    if (lg == null && hg == null) {
        return numeric < 11 ? low : high;
    }

    const lowWeight = lg ?? Math.max(0, 1 - (hg ?? 0));
    const highWeight = hg ?? Math.max(0, 1 - lowWeight);
    const weightSum = lowWeight + highWeight;
    if (weightSum <= 1e-6) {
        return numeric < 11 ? low : high;
    }

    return ((lowWeight * low) + (highWeight * high)) / weightSum;
}

function calibrateAzusaOutputNumeric(value) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) {
        return numeric;
    }

    return interpolateCalibration(numeric, AZUSA_ISOTONIC_POINTS);
}

function computeCurveGapResidualCorrection(baseNumeric, blendDetails, curveStats, primaryNumeric, sunnyNumeric, danielNumeric) {
    const x = Number(baseNumeric);
    if (!Number.isFinite(x)) {
        return 0;
    }

    const highGate = Number.isFinite(blendDetails?.highGate) ? clamp(blendDetails.highGate, 0, 1) : 0;
    const primary = Number.isFinite(primaryNumeric) ? primaryNumeric : x;
    const sunny = Number.isFinite(sunnyNumeric) ? sunnyNumeric : x;
    const daniel = Number.isFinite(danielNumeric) ? danielNumeric : x;
    const ds = daniel - sunny;
    const sp = sunny - primary;
    const anchorImbalance = Number.isFinite(curveStats?.anchorImbalance) ? curveStats.anchorImbalance : 0;
    const chordRate = Number.isFinite(curveStats?.chordRate) ? curveStats.chordRate : 0;
    const jackQ95 = Number.isFinite(curveStats?.jackQ95) ? curveStats.jackQ95 : 0;

    const residual = (
        4.335282
        + (-0.170459 * x)
        + (-1.622303 * Math.max(0, 11 - x))
        + (1.328125 * Math.max(0, 12.5 - x))
        + (-0.042829 * Math.max(0, 14 - x))
        + (-0.834997 * highGate)
        + (3.060352 * highGate * Math.max(0, 11 - x))
        + (-1.744638 * highGate * Math.max(0, 12.5 - x))
        + (0.409922 * ds)
        + (0.041072 * sp)
        + (-0.388231 * highGate * ds)
        + (-0.170185 * highGate * sp)
        + (3.466868 * anchorImbalance)
        + (-1.743778 * chordRate)
        + (-0.094758 * jackQ95)
        + (2.626366 * anchorImbalance * jackQ95)
        + (1.836357 * chordRate * jackQ95)
        + (-2.612648 * highGate * anchorImbalance)
        + (-2.493596 * highGate * chordRate)
    );

    return clamp(residual, -1.2, 1.2);
}

function computePostOutputCurveGapResidualCorrection(baseNumeric, blendDetails, curveStats, primaryNumeric, sunnyNumeric, danielNumeric) {
    const x = Number(baseNumeric);
    if (!Number.isFinite(x)) {
        return 0;
    }

    const highGate = Number.isFinite(blendDetails?.highGate) ? clamp(blendDetails.highGate, 0, 1) : 0;
    const primary = Number.isFinite(primaryNumeric) ? primaryNumeric : x;
    const sunny = Number.isFinite(sunnyNumeric) ? sunnyNumeric : x;
    const daniel = Number.isFinite(danielNumeric) ? danielNumeric : x;
    const anchorImbalance = Number.isFinite(curveStats?.anchorImbalance) ? curveStats.anchorImbalance : 0;
    const chordRate = Number.isFinite(curveStats?.chordRate) ? curveStats.chordRate : 0;
    const jackQ95 = Number.isFinite(curveStats?.jackQ95) ? curveStats.jackQ95 : x;

    const ds = daniel - sunny;
    const sp = sunny - primary;

    const residual = 0.4 * (
        0.979895
        + (0.053556 * x)
        + (-1.050405 * Math.max(0, 11 - x))
        + (0.942552 * Math.max(0, 12.5 - x))
        + (0.048841 * Math.max(0, 14 - x))
        + (-1.636218 * highGate)
        + (0.956025 * highGate * Math.max(0, 11 - x))
        + (-0.975188 * highGate * Math.max(0, 12.5 - x))
        + (0.195107 * ds)
        + (-0.064291 * sp)
        + (-0.231542 * highGate * ds)
        + (0.082201 * highGate * sp)
        + (-0.634013 * anchorImbalance)
        + (-0.490303 * chordRate)
        + (-0.135176 * jackQ95)
        + (-0.992539 * anchorImbalance * jackQ95)
        + (-0.164219 * chordRate * jackQ95)
        + (-1.027392 * highGate * anchorImbalance)
        + (0.961530 * highGate * chordRate)
    );

    return clamp(residual, -1.0, 1.0);
}

export function runAzusaEstimatorFromText(osuText, options = {}) {
    const withGraph = options.withGraph === true;
    const forceSunnyReferenceHo = options.forceSunnyReferenceHo !== false;
    const precomputedDanielResult = options.precomputedDanielResult || null;
    const precomputedSunnyResult = options.precomputedSunnyResult || null;

    const parser = new OsuFileParser(osuText);
    parser.process();
    const parsed = parser.getParsedData();

    const lnRatio = Number(parsed?.lnRatio) || 0;
    const columnCount = Number(parsed?.columnCount) || 0;

    if (parsed?.status === "Fail") {
        return buildErrorResult("ParseFailed", "Beatmap parse failed", { lnRatio, columnCount });
    }

    if (parsed?.status === "NotMania") {
        return buildErrorResult("NotMania", "Beatmap mode is not mania", { lnRatio, columnCount });
    }

    if (columnCount !== 4) {
        return buildErrorResult("UnsupportedKeys", "Azusa only supports 4K", { lnRatio, columnCount });
    }

    const taps = buildTapNotes(parsed);
    if (taps.length < AZUSA_CONFIG.minNotes) {
        return buildErrorResult(
            "TooShort",
            `Insufficient notes for stable estimate (${taps.length})`,
            { lnRatio, columnCount },
        );
    }

    annotateRows(taps, AZUSA_CONFIG.rowToleranceMs);

    const curve = buildDifficultyCurve(taps);
    const primaryNumeric = computeAzusaNumericFromCurve(curve, taps.length);

    const maxColumn = Math.max(...curve.columnCounts);
    const anchorImbalance = safeDiv((maxColumn / Math.max(taps.length, 1)) - 0.25, 0.75, 0);
    const chordRate = safeDiv(curve.chordNoteCount, Math.max(taps.length, 1), 0);
    const jackSorted = [...curve.jackRawSeries].sort((a, b) => a - b);
    const jackQ95 = quantileFromSorted(jackSorted, 0.95);

    let danielNumeric = null;
    let sunnyNumeric = null;
    let sunnyResult = precomputedSunnyResult;

    if (precomputedDanielResult) {
        danielNumeric = estimateDanielNumeric(precomputedDanielResult);
    } else {
        try {
            const daniel = runDanielEstimatorFromText(osuText, options);
            danielNumeric = estimateDanielNumeric(daniel);
        } catch {
            danielNumeric = null;
        }
    }

    if (sunnyResult) {
        sunnyNumeric = estimateSunnyNumeric(sunnyResult);
    } else {
        try {
            const sunnyOptions = forceSunnyReferenceHo
                ? { ...options, cvtFlag: "HO" }
                : options;
            sunnyResult = runSunnyEstimatorFromText(osuText, sunnyOptions);
            sunnyNumeric = estimateSunnyNumeric(sunnyResult);
        } catch {
            sunnyNumeric = null;
            sunnyResult = null;
        }
    }

    const blendDetails = resolveRcBlendComponents(primaryNumeric, danielNumeric, sunnyNumeric, {
        anchorImbalance,
        chordRate,
        jackQ95,
    });
    const numericDifficulty = blendDetails.value;
    const calibratedNumeric = calibrateAzusaNumeric(numericDifficulty, blendDetails.lowGate, blendDetails.highGate);
    const curveGapResidual = computeCurveGapResidualCorrection(
        calibratedNumeric,
        blendDetails,
        { anchorImbalance, chordRate, jackQ95 },
        primaryNumeric,
        sunnyNumeric,
        danielNumeric,
    );
    const preOutputNumeric = clamp(Number(calibratedNumeric) + curveGapResidual, -2, 20);
    const outputNumeric = calibrateAzusaOutputNumeric(preOutputNumeric);
    const postCurveGapResidual = computePostOutputCurveGapResidualCorrection(
        outputNumeric,
        blendDetails,
        { anchorImbalance, chordRate, jackQ95 },
        primaryNumeric,
        sunnyNumeric,
        danielNumeric,
    );
    const finalNumeric = clamp(Number(outputNumeric) + postCurveGapResidual, -2, 20);
    const estDiff = numericToRcLabel(finalNumeric);

    const result = {
        star: Number((3.4 + 0.38 * finalNumeric).toFixed(4)),
        lnRatio,
        columnCount,
        estDiff,
        numericDifficulty: Number(finalNumeric.toFixed(2)),
        numericDifficultyHint: "azusa-rc-v1",
        graph: withGraph ? (sunnyResult?.graph || null) : null,
        rawNumericDifficulty: Number(primaryNumeric.toFixed(4)),
        debug: {
            primaryNumeric: Number(primaryNumeric.toFixed(4)),
            blendNumeric: Number.isFinite(numericDifficulty) ? Number(numericDifficulty.toFixed(4)) : null,
            danielNumeric: Number.isFinite(danielNumeric) ? Number(danielNumeric.toFixed(4)) : null,
            sunnyNumeric: Number.isFinite(sunnyNumeric) ? Number(sunnyNumeric.toFixed(4)) : null,
            notes: taps.length,
            calibratedNumeric: Number.isFinite(calibratedNumeric) ? Number(calibratedNumeric.toFixed(4)) : null,
            curveStats: {
                anchorImbalance: Number.isFinite(anchorImbalance) ? Number(anchorImbalance.toFixed(4)) : null,
                chordRate: Number.isFinite(chordRate) ? Number(chordRate.toFixed(4)) : null,
                jackQ95: Number.isFinite(jackQ95) ? Number(jackQ95.toFixed(4)) : null,
            },
            curveGapResidual: Number.isFinite(curveGapResidual) ? Number(curveGapResidual.toFixed(4)) : null,
            outputNumeric: Number.isFinite(outputNumeric) ? Number(outputNumeric.toFixed(4)) : null,
            postCurveGapResidual: Number.isFinite(postCurveGapResidual) ? Number(postCurveGapResidual.toFixed(4)) : null,
            finalNumeric: Number.isFinite(finalNumeric) ? Number(finalNumeric.toFixed(4)) : null,
            blend: {
                lowGateSource: Number.isFinite(blendDetails.lowGateSource) ? blendDetails.lowGateSource.toFixed(4) : null,
                lowGate: Number.isFinite(blendDetails.lowGate) ? blendDetails.lowGate.toFixed(4) : null,
                highGate: Number.isFinite(blendDetails.highGate) ? blendDetails.highGate.toFixed(4) : null,
                lowBase: Number.isFinite(blendDetails.lowBase) ? blendDetails.lowBase.toFixed(4) : null,
                highBase: Number.isFinite(blendDetails.highBase) ? blendDetails.highBase.toFixed(4) : null,
            },
        },
    };

    return result;
}
