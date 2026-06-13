import { OsuFileParser } from "../parser/osuFileParser.js";
import { runAzusaEstimatorFromText } from "./azusaEstimator.js";
import { runDanielEstimatorFromText } from "./danielEstimator.js";
import { runMixedEstimatorFromText } from "./mixedEstimator.js";
import { evaluateRoxyMetaModel, ROXY_META_FEATURE_NAMES } from "./roxyMetaModel.generated.js";
import { numericToRcLabel, rcLabelToNumeric } from "./rcDifficultyFormat.js";
import { runSunnyEstimatorFromText } from "./sunnyEstimator.js";

const ROXY_CONFIG = Object.freeze({
    rcLnRatioLimit: 0.18,
    minNotes: 80,
    rowToleranceMs: 2,
    entropyWindowMs: 750,
    npsWindowsMs: Object.freeze([250, 500, 1000, 4000]),
    sectionMs: 400,
    sectionDecay: 0.9,
    correctionClamp: 1.25,
    graphSmoothingTauMs: 650,
    graphRawBlend: 0.12,
    rawMap: Object.freeze({
        p02: 3.9947,
        p98: 7.5454,
    }),
    streamWeights: Object.freeze({
        speed: 0.22,
        handStream: 0.18,
        jack: 0.16,
        chordjack: 0.16,
        tech: 0.12,
        stamina: 0.11,
        course: 0.05,
    }),
    streams: Object.freeze({
        speed: Object.freeze({ burstTau: 220, staminaTau: 1600, burstMix: 0.78 }),
        handStream: Object.freeze({ burstTau: 260, staminaTau: 2200, burstMix: 0.80 }),
        jack: Object.freeze({ burstTau: 300, staminaTau: 1800, burstMix: 0.88 }),
        chordjack: Object.freeze({ burstTau: 260, staminaTau: 2400, burstMix: 0.82 }),
        tech: Object.freeze({ burstTau: 450, staminaTau: 3200, burstMix: 0.70 }),
        stamina: Object.freeze({ burstTau: 1200, staminaTau: 10000, burstMix: 0.58 }),
        course: Object.freeze({ burstTau: 30000, staminaTau: 120000, burstMix: 0.35 }),
    }),
    isotonicKnots: Object.freeze([
        [-2.6250, 2.4444],
        [-2.5000, 2.9000],
        [-2.1782, 3.2000],
        [-1.6429, 3.4667],
        [-0.8081, 4.9333],
        [-0.5781, 5.0000],
        [-0.3751, 5.1250],
        [0.0878, 5.7000],
        [0.5414, 7.3500],
        [0.7248, 9.6000],
        [1.2435, 9.7625],
        [2.2100, 9.8379],
        [3.3439, 10.3810],
        [4.1521, 10.8619],
        [4.6770, 12.2111],
        [7.5944, 12.8954],
        [10.3796, 12.9333],
        [10.7539, 13.1211],
        [11.2944, 13.1733],
        [12.4106, 13.4225],
        [13.3667, 13.7143],
        [14.0177, 14.0761],
        [15.2659, 14.1489],
        [16.4144, 14.3000],
        [16.9566, 14.3174],
        [17.5080, 14.6000],
        [17.9004, 14.8917],
        [18.1870, 15.0000],
        [18.5160, 15.0636],
        [19.5870, 15.2889],
        [20.2551, 15.6111],
        [21.0298, 16.0000],
        [21.3373, 16.5833],
    ]),
});

const STREAM_NAMES = Object.freeze(Object.keys(ROXY_CONFIG.streamWeights));
const STREAM_INPUT_BY_NAME = Object.freeze({
    speed: "speedIn",
    handStream: "handIn",
    jack: "jackIn",
    chordjack: "chordjackIn",
    tech: "techIn",
    stamina: "staminaIn",
    course: "courseIn",
});

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
    if (!Number.isFinite(a) || !Number.isFinite(b) || Math.abs(b) < 1e-9) return fallback;
    return a / b;
}

function fmt4(value) {
    return Number.isFinite(value) ? Number(value.toFixed(4)) : null;
}

function fmtDebugValue(value) {
    if (typeof value === "boolean" || value == null) return value;
    return fmt4(value);
}

function gate(value, min, max) {
    return clamp(safeDiv(value - min, max - min, 0), 0, 1);
}

function inverseGate(value, min, max) {
    return clamp(safeDiv(max - value, max - min, 0), 0, 1);
}

function strainRate(dt, base, offset, power) {
    const effective = Math.max(16, Number(dt) + offset);
    const value = Math.pow(base / effective, power);
    return Number.isFinite(value) ? Math.min(8, value) : 0;
}

function decayState(state, input, dt, tau) {
    const delta = Number.isFinite(dt) && dt > 0 ? dt : 0;
    const decay = Math.exp(-delta / tau);
    return state * decay + input;
}

function piecewiseLinear(x, knots) {
    const value = Number(x);
    if (!Number.isFinite(value) || !Array.isArray(knots) || knots.length === 0) return value;
    if (value <= knots[0][0]) return knots[0][1];
    const last = knots.length - 1;
    if (value >= knots[last][0]) return knots[last][1];

    for (let i = 0; i < last; i += 1) {
        const [x0, y0] = knots[i];
        const [x1, y1] = knots[i + 1];
        if (value >= x0 && value <= x1) {
            return y0 + safeDiv((value - x0) * (y1 - y0), x1 - x0, 0);
        }
    }

    return value;
}

function linearMap(value, x0, x1, y0, y1) {
    return y0 + safeDiv((value - x0) * (y1 - y0), x1 - x0, 0);
}

function quantileFromSorted(sortedValues, q) {
    if (!sortedValues.length) return 0;
    const t = clamp(Number(q), 0, 1) * (sortedValues.length - 1);
    const left = Math.floor(t);
    const right = Math.min(sortedValues.length - 1, left + 1);
    const w = t - left;
    return sortedValues[left] * (1 - w) + sortedValues[right] * w;
}

function quantile(values, q) {
    const sorted = values.filter((item) => Number.isFinite(item)).sort((a, b) => a - b);
    return quantileFromSorted(sorted, q);
}

function powerMean(values, p) {
    if (!values.length) return 0;
    let acc = 0;
    for (const value of values) {
        acc += Math.pow(Math.max(0, value), p);
    }
    return Math.pow(acc / values.length, 1 / p);
}

function topTailMean(sortedValues, ratio) {
    if (!sortedValues.length) return 0;
    const count = Math.max(1, Math.ceil(sortedValues.length * ratio));
    let sum = 0;
    for (let i = sortedValues.length - count; i < sortedValues.length; i += 1) {
        sum += sortedValues[i];
    }
    return sum / count;
}

function bitCount4(mask) {
    let value = mask & 15;
    value = value - ((value >> 1) & 5);
    value = (value & 3) + ((value >> 2) & 3);
    return value;
}

function entropyFromCounts(counts, total, normalizer) {
    if (!Number.isFinite(total) || total <= 0) return 0;
    let entropy = 0;
    for (let i = 0; i < counts.length; i += 1) {
        const count = counts[i];
        if (count <= 0) continue;
        const p = count / total;
        entropy -= p * Math.log2(p);
    }
    return clamp(entropy / normalizer, 0, 1);
}

function normalizeCvtFlag(cvtFlag) {
    const normalized = String(cvtFlag || "").trim().toUpperCase();
    if (normalized === "HO" || normalized === "IN") return normalized;
    return null;
}

function applyConversionFlag(parser, cvtFlag) {
    const normalized = normalizeCvtFlag(cvtFlag);
    if (normalized === "HO") {
        parser.modHO();
    } else if (normalized === "IN") {
        parser.modIN();
    }
}

function buildTapRows(parsed, speedRate, toleranceMs) {
    const taps = [];
    const columns = Array.isArray(parsed.columns) ? parsed.columns : [];
    const starts = Array.isArray(parsed.noteStarts) ? parsed.noteStarts : [];
    const types = Array.isArray(parsed.noteTypes) ? parsed.noteTypes : [];

    for (let i = 0; i < columns.length; i += 1) {
        const rawType = Number(types[i]) || 0;
        if ((rawType & 128) !== 0) continue;

        const column = Number(columns[i]);
        const start = Number(starts[i]);
        if (!Number.isFinite(column) || column < 0 || column > 3 || !Number.isFinite(start)) {
            continue;
        }

        taps.push({
            t: start / speedRate,
            c: column,
        });
    }

    taps.sort((a, b) => {
        if (a.t !== b.t) return a.t - b.t;
        return a.c - b.c;
    });

    const rows = [];
    for (let i = 0; i < taps.length;) {
        const startTime = taps[i].t;
        let j = i;
        let mask = 0;
        let rowSize = 0;

        while (j < taps.length && Math.abs(taps[j].t - startTime) <= toleranceMs) {
            const bit = 1 << taps[j].c;
            if ((mask & bit) === 0) {
                rowSize += 1;
            }
            mask |= bit;
            j += 1;
        }

        const leftMask = mask & 0b0011;
        const rightMask = mask & 0b1100;
        rows.push({
            t: startTime,
            mask,
            rowSize,
            leftCount: bitCount4(leftMask),
            rightCount: bitCount4(rightMask),
            handMask: [leftMask, rightMask],
        });
        i = j;
    }

    return { taps, rows };
}

function computeActivityStats(rows, tapCount) {
    if (rows.length < 2) {
        return {
            inactiveMs: 0,
            breakCount: 0,
            activeDurationSec: 1,
            breakDensity: 0,
            avgNps: tapCount,
        };
    }

    let inactiveMs = 0;
    let breakCount = 0;
    for (let i = 1; i < rows.length; i += 1) {
        const gap = rows[i].t - rows[i - 1].t;
        if (gap > 1000) {
            inactiveMs += gap - 1000;
            breakCount += 1;
        }
    }

    const durationMs = Math.max(1, rows[rows.length - 1].t - rows[0].t - inactiveMs);
    const activeDurationSec = durationMs / 1000;
    return {
        inactiveMs,
        breakCount,
        activeDurationSec,
        breakDensity: breakCount / Math.max(activeDurationSec / 60, 1),
        avgNps: tapCount / Math.max(activeDurationSec, 1),
    };
}

function computeNpsRows(rows, tapTimes) {
    const windows = ROXY_CONFIG.npsWindowsMs;
    const starts = new Array(windows.length).fill(0);
    let end = 0;

    for (const row of rows) {
        while (end < tapTimes.length && tapTimes[end] <= row.t + 1e-9) {
            end += 1;
        }

        row.nps = {};
        for (let w = 0; w < windows.length; w += 1) {
            const windowMs = windows[w];
            const minTime = row.t - windowMs;
            while (starts[w] < tapTimes.length && tapTimes[starts[w]] <= minTime) {
                starts[w] += 1;
            }
            row.nps[windowMs] = (end - starts[w]) / (windowMs / 1000);
        }
    }
}

function summarizeStream(values) {
    const sorted = values.filter((value) => Number.isFinite(value)).sort((a, b) => a - b);
    if (!sorted.length) {
        return {
            q50: 0,
            q75: 0,
            q90: 0,
            q97: 0,
            tailMean: 0,
            powerMean: 0,
            aggregate: 0,
        };
    }

    const q50 = quantileFromSorted(sorted, 0.50);
    const q75 = quantileFromSorted(sorted, 0.75);
    const q90 = quantileFromSorted(sorted, 0.90);
    const q97 = quantileFromSorted(sorted, 0.97);
    const tailMean = topTailMean(sorted, 0.04);
    const pm = powerMean(sorted, 2.4);
    const aggregate = (0.30 * q97)
        + (0.22 * q90)
        + (0.18 * tailMean)
        + (0.15 * q75)
        + (0.10 * pm)
        + (0.05 * q50);

    return {
        q50,
        q75,
        q90,
        q97,
        tailMean,
        powerMean: pm,
        aggregate,
    };
}

function computeSectionAggregate(rows, localRaw) {
    if (!rows.length || !localRaw.length) return 0;

    const firstTime = rows[0].t;
    const sectionMax = [];
    for (let i = 0; i < rows.length; i += 1) {
        const section = Math.max(0, Math.floor((rows[i].t - firstTime) / ROXY_CONFIG.sectionMs));
        sectionMax[section] = Math.max(sectionMax[section] || 0, localRaw[i] || 0);
    }

    const values = sectionMax.filter((value) => Number.isFinite(value) && value > 0).sort((a, b) => b - a);
    if (!values.length) return 0;

    let weight = 1;
    let total = 0;
    let weightTotal = 0;
    for (const value of values) {
        total += value * weight;
        weightTotal += weight;
        weight *= ROXY_CONFIG.sectionDecay;
    }

    return safeDiv(total, weightTotal, 0);
}

function median3(a, b, c) {
    return Math.max(Math.min(a, b), Math.min(Math.max(a, b), c));
}

function smoothGraphSeries(graph) {
    const times = Array.isArray(graph?.times) ? graph.times : [];
    const values = Array.isArray(graph?.values) ? graph.values : [];
    const length = Math.min(times.length, values.length);
    if (length < 3) {
        return {
            times: times.slice(0, length),
            values: values.slice(0, length),
        };
    }

    const cleanedTimes = new Array(length);
    const cleanedValues = new Array(length);
    for (let i = 0; i < length; i += 1) {
        const previousTime = i > 0 ? cleanedTimes[i - 1] : 0;
        const rawTime = Number(times[i]);
        cleanedTimes[i] = Number.isFinite(rawTime) && (i === 0 || rawTime >= previousTime)
            ? rawTime
            : previousTime;

        const rawValue = Number(values[i]);
        cleanedValues[i] = Number.isFinite(rawValue) ? Math.max(0, rawValue) : 0;
    }

    const robustValues = new Array(length);
    robustValues[0] = cleanedValues[0];
    robustValues[length - 1] = cleanedValues[length - 1];
    for (let i = 1; i < length - 1; i += 1) {
        robustValues[i] = median3(cleanedValues[i - 1], cleanedValues[i], cleanedValues[i + 1]);
    }

    const tau = ROXY_CONFIG.graphSmoothingTauMs;
    const forward = new Array(length);
    forward[0] = robustValues[0];
    for (let i = 1; i < length; i += 1) {
        const dt = Math.max(1, cleanedTimes[i] - cleanedTimes[i - 1]);
        const alpha = 1 - Math.exp(-dt / tau);
        forward[i] = forward[i - 1] + alpha * (robustValues[i] - forward[i - 1]);
    }

    const backward = new Array(length);
    backward[length - 1] = robustValues[length - 1];
    for (let i = length - 2; i >= 0; i -= 1) {
        const dt = Math.max(1, cleanedTimes[i + 1] - cleanedTimes[i]);
        const alpha = 1 - Math.exp(-dt / tau);
        backward[i] = backward[i + 1] + alpha * (robustValues[i] - backward[i + 1]);
    }

    const rawBlend = ROXY_CONFIG.graphRawBlend;
    const smoothBlend = 1 - rawBlend;
    const smoothedValues = new Array(length);
    for (let i = 0; i < length; i += 1) {
        const smoothed = (forward[i] + backward[i]) / 2;
        smoothedValues[i] = (rawBlend * cleanedValues[i]) + (smoothBlend * smoothed);
    }

    return {
        times: cleanedTimes,
        values: smoothedValues,
    };
}

function computeRoxyCurve(rows, taps, activity) {
    const streams = {};
    const states = {};
    for (const name of STREAM_NAMES) {
        streams[name] = [];
        states[name] = { burst: 0, stamina: 0 };
    }

    const lastColumnTime = new Array(4).fill(Number.NaN);
    const lastHandTime = new Array(2).fill(Number.NaN);
    const prevHandMask = new Array(2).fill(0);
    const handStamina = new Array(2).fill(0);
    const columnCounts = new Array(4).fill(0);
    const dtSameValues = [];
    const dtHandValues = [];
    const localRaw = [];
    const graphTimes = [];
    const graphValues = [];

    const maskCounts = new Int32Array(16);
    const transitionCounts = new Int32Array(256);
    const entropyQueue = [];
    let entropyBack = 0;
    let maskTotal = 0;
    let transitionTotal = 0;

    let prevRowTime = rows.length ? rows[0].t - 1000 : 0;
    let prevDtRow = 1000;
    let prevMask = 0;
    let leftLoad = 0;
    let rightLoad = 0;
    let chordRows = 0;
    let threeRows = 0;
    let overlapSum = 0;
    let rotationSum = 0;
    let eligibleHandEvents = 0;
    let anchorRows = 0;

    for (let i = 0; i < rows.length; i += 1) {
        const row = rows[i];
        const dtRow = i > 0 ? Math.max(1, row.t - prevRowTime) : 1000;
        row.dtRow = dtRow;

        const leftMask = row.handMask[0];
        const rightMask = row.handMask[1];
        const handMasks = [leftMask, rightMask];
        const dtHand = [Number.NaN, Number.NaN];
        const rotation = [0, 0];
        let overlapEvents = 0;

        for (let h = 0; h < 2; h += 1) {
            if (handMasks[h] === 0) continue;
            if (Number.isFinite(lastHandTime[h])) {
                dtHand[h] = Math.max(1, row.t - lastHandTime[h]);
                dtHandValues.push(dtHand[h]);
                eligibleHandEvents += 1;
                if ((handMasks[h] & prevHandMask[h]) === 0 && prevHandMask[h] !== 0) {
                    rotation[h] = 1;
                    rotationSum += 1;
                }
                if ((handMasks[h] & prevHandMask[h]) !== 0) {
                    overlapEvents += 1;
                }
            }
        }

        const sameHandOverlap = overlapEvents / 2;
        overlapSum += sameHandOverlap;

        const dtSame = new Array(4).fill(Number.NaN);
        let jackMax = 0;
        let anchorRow = 0;
        for (let c = 0; c < 4; c += 1) {
            if ((row.mask & (1 << c)) === 0) continue;
            columnCounts[c] += 1;
            if (Number.isFinite(lastColumnTime[c])) {
                dtSame[c] = Math.max(1, row.t - lastColumnTime[c]);
                dtSameValues.push(dtSame[c]);
                if (dtSame[c] <= 220) anchorRow = 1;
                jackMax = Math.max(jackMax, strainRate(dtSame[c], 185, 35, 1.18));
            }
        }
        if (anchorRow) anchorRows += 1;

        leftLoad += row.leftCount;
        rightLoad += row.rightCount;
        if (row.rowSize >= 2) chordRows += 1;
        if (row.rowSize >= 3) threeRows += 1;

        maskCounts[row.mask] += 1;
        maskTotal += 1;
        let transitionCode = -1;
        if (i > 0) {
            transitionCode = (prevMask << 4) | row.mask;
            transitionCounts[transitionCode] += 1;
            transitionTotal += 1;
        }
        entropyQueue.push({ t: row.t, mask: row.mask, transitionCode });
        while (entropyBack < entropyQueue.length && entropyQueue[entropyBack].t < row.t - ROXY_CONFIG.entropyWindowMs) {
            const old = entropyQueue[entropyBack];
            maskCounts[old.mask] -= 1;
            maskTotal -= 1;
            if (old.transitionCode >= 0) {
                transitionCounts[old.transitionCode] -= 1;
                transitionTotal -= 1;
            }
            entropyBack += 1;
        }

        const entropy750 = entropyFromCounts(maskCounts, maskTotal, 4);
        const transitionEntropy750 = entropyFromCounts(transitionCounts, transitionTotal, 8);
        const rowChord = (row.rowSize - 1) / 3;
        const sameHandChord = (Math.max(0, row.leftCount - 1) + Math.max(0, row.rightCount - 1)) / 2;

        const handRates = [];
        for (let h = 0; h < 2; h += 1) {
            if (handMasks[h] === 0) continue;
            const handDt = Number.isFinite(dtHand[h]) ? dtHand[h] : 1000;
            handRates.push(strainRate(handDt, 180, 40, 1.08));
            handStamina[h] = decayState(handStamina[h], strainRate(handDt, 180, 40, 1.08), handDt, 8000);
        }
        for (let h = 0; h < 2; h += 1) {
            if (handMasks[h] !== 0) continue;
            handStamina[h] = decayState(handStamina[h], 0, dtRow, 8000);
        }

        const handMax = handRates.length ? Math.max(...handRates) : 0;
        const handMean = handRates.length ? handRates.reduce((sum, value) => sum + value, 0) / handRates.length : 0;
        const speedIn = (0.55 * strainRate(dtRow, 155, 30, 1.06))
            + (0.30 * handMax)
            + (0.15 * handMean);
        const jackIn = jackMax * (1 + 0.20 * rowChord + 0.15 * anchorRow);
        let handIn = 0;
        for (let h = 0; h < 2; h += 1) {
            if (handMasks[h] === 0) continue;
            const handDt = Number.isFinite(dtHand[h]) ? dtHand[h] : 1000;
            handIn = Math.max(
                handIn,
                (0.70 * strainRate(handDt, 180, 38, 1.10))
                    + (0.30 * rotation[h] * strainRate(handDt, 205, 45, 1.05)),
            );
        }

        const body = Math.max(0, row.rowSize - 2) * strainRate(dtRow, 150, 80, 0.85);
        const chordIn = rowChord * (1 + 0.18 * speedIn) + 0.22 * sameHandChord + body;
        const chordjackIn = rowChord * ((0.55 * jackIn) + (0.30 * sameHandOverlap) + (0.15 * handIn));
        const rhythmChaos = Math.min(2, Math.abs(Math.log2((dtRow + 24) / (prevDtRow + 24)))) / 2;
        const techIn = (0.32 * rhythmChaos)
            + (0.24 * entropy750)
            + (0.24 * transitionEntropy750)
            + (0.20 * (row.mask !== prevMask ? 1 : 0));
        const maxHandStamina = Math.max(handStamina[0], handStamina[1]);
        const staminaIn = (0.40 * Math.log1p(row.nps[1000] || 0) / Math.log(24))
            + (0.35 * Math.log1p(row.nps[4000] || 0) / Math.log(24))
            + (0.25 * maxHandStamina);
        const courseIn = staminaIn
            * gate(activity.activeDurationSec, 90, 300)
            * (1 - 0.25 * gate(activity.breakDensity, 0.006, 0.018));

        const inputs = {
            speedIn,
            handIn,
            jackIn,
            chordjackIn,
            techIn,
            staminaIn,
            courseIn,
        };

        for (const name of STREAM_NAMES) {
            const streamConfig = ROXY_CONFIG.streams[name];
            const input = inputs[STREAM_INPUT_BY_NAME[name]] || 0;
            const state = states[name];
            state.burst = decayState(state.burst, input, dtRow, streamConfig.burstTau);
            state.stamina = decayState(state.stamina, input, dtRow, streamConfig.staminaTau);
            const value = streamConfig.burstMix * state.burst
                + (1 - streamConfig.burstMix) * state.stamina;
            streams[name].push(value);
        }

        let raw = 0;
        for (const name of STREAM_NAMES) {
            raw += ROXY_CONFIG.streamWeights[name] * streams[name][streams[name].length - 1];
        }
        localRaw.push(raw);
        graphTimes.push(row.t);
        graphValues.push(raw);

        row.metrics = {
            rowChord,
            sameHandOverlap,
            rotation,
            entropy750,
            transitionEntropy750,
            anchorRow,
            localRaw: raw,
        };

        for (let c = 0; c < 4; c += 1) {
            if ((row.mask & (1 << c)) !== 0) {
                lastColumnTime[c] = row.t;
            }
        }
        for (let h = 0; h < 2; h += 1) {
            if (handMasks[h] !== 0) {
                lastHandTime[h] = row.t;
                prevHandMask[h] = handMasks[h];
            }
        }

        prevRowTime = row.t;
        prevDtRow = dtRow;
        prevMask = row.mask;
    }

    const streamSummaries = {};
    let weightedAgg = 0;
    for (const name of STREAM_NAMES) {
        const summary = summarizeStream(streams[name]);
        streamSummaries[name] = summary;
        weightedAgg += ROXY_CONFIG.streamWeights[name] * summary.aggregate;
    }

    const sectionAgg = computeSectionAggregate(rows, localRaw);
    const q97Local = quantile(localRaw, 0.97);
    const q75Local = quantile(localRaw, 0.75);
    const peakToSustainGap = clamp(safeDiv(q97Local - q75Local, Math.max(q97Local, 1e-6), 0), 0, 1);
    const finiteSameCount = dtSameValues.length;
    const fastSameCount = dtSameValues.filter((value) => value <= 120).length;
    const maxColumnCount = Math.max(...columnCounts);
    const minColumnCount = Math.min(...columnCounts);

    const stats = {
        ...activity,
        chordRate: chordRows / Math.max(rows.length, 1),
        threeRate: threeRows / Math.max(rows.length, 1),
        overlapRate: overlapSum / Math.max(rows.length, 1),
        rotationRate: rotationSum / Math.max(eligibleHandEvents, 1),
        sameHandQ10: quantile(dtHandValues, 0.10),
        fastJackRate: fastSameCount / Math.max(finiteSameCount, 1),
        anchorRate: anchorRows / Math.max(rows.length, 1),
        anchorImbalance: (maxColumnCount - minColumnCount) / Math.max(taps.length, 1),
        leftLoad,
        rightLoad,
        handBias: Math.abs(leftLoad - rightLoad) / Math.max(leftLoad, rightLoad, 1e-6),
        peakToSustainGap,
        columnCounts,
        rows: rows.length,
        taps: taps.length,
    };

    return {
        streams,
        streamSummaries,
        weightedAgg,
        sectionAgg,
        localRaw,
        graph: {
            times: graphTimes,
            values: graphValues,
        },
        stats,
    };
}

function computeCorrections(stats) {
    const lowCj = 0.75
        * gate(stats.chordRate, 0.48, 0.68)
        * gate(stats.overlapRate, 0.75, 1.25)
        * (1 - gate(stats.avgNps, 19, 23))
        * (1 - gate(stats.anchorImbalance, 0.06, 0.12));
    const highStream = 0.65
        * gate(stats.rotationRate, 0.68, 0.86)
        * inverseGate(stats.sameHandQ10, 100, 130)
        * (1 - gate(stats.chordRate, 0.25, 0.42))
        * (1 - gate(stats.overlapRate, 0.65, 0.95));
    const highCjDamp = -0.55
        * gate(stats.chordRate, 0.78, 0.90)
        * gate(stats.threeRate, 0.18, 0.38)
        * (1 - gate(stats.fastJackRate, 0.55, 0.75));
    const courseBreakDamp = -0.70
        * gate(stats.activeDurationSec, 240, 480)
        * gate(stats.breakDensity, 0.006, 0.018)
        * gate(stats.peakToSustainGap, 0.35, 0.75)
        * inverseGate(stats.avgNps, 12, 18);
    const courseSustainLift = 0.30
        * gate(stats.activeDurationSec, 240, 600)
        * inverseGate(stats.breakDensity, 0.004, 0.012)
        * inverseGate(stats.peakToSustainGap, 0.15, 0.45)
        * gate(stats.avgNps, 15, 21);
    const denseJsLift = 0.35
        * gate(stats.chordRate, 0.35, 0.52)
        * gate(stats.rotationRate, 0.62, 0.80)
        * inverseGate(stats.sameHandQ10, 90, 125);
    const denseJsDamp = -0.25
        * gate(stats.chordRate, 0.58, 0.75)
        * inverseGate(stats.rotationRate, 0.45, 0.62);
    const anchorLift = 0.30
        * gate(stats.anchorRate, 0.18, 0.38)
        * gate(stats.fastJackRate, 0.25, 0.55)
        * (1 - gate(stats.chordRate, 0.65, 0.85));
    const handBiasLift = 0.25
        * gate(stats.handBias, 0.25, 0.55)
        * gate(stats.avgNps, 12, 20);
    const rawSum = lowCj
        + highStream
        + highCjDamp
        + courseBreakDamp
        + courseSustainLift
        + denseJsLift
        + denseJsDamp
        + anchorLift
        + handBiasLift;
    const total = clamp(rawSum, -ROXY_CONFIG.correctionClamp, ROXY_CONFIG.correctionClamp);

    return {
        lowCj,
        highStream,
        highCjDamp,
        courseBreakDamp,
        courseSustainLift,
        denseJsLift,
        denseJsDamp,
        anchorLift,
        handBiasLift,
        rawSum,
        total,
    };
}

function computeRoxyNumeric(curve) {
    const rawAgg = (0.80 * curve.weightedAgg) + (0.20 * curve.sectionAgg);
    const logRaw = Math.log1p(Math.max(0, rawAgg));
    const preNumeric = clamp(
        linearMap(logRaw, ROXY_CONFIG.rawMap.p02, ROXY_CONFIG.rawMap.p98, -2, 20),
        -2.5,
        21,
    );
    const corrections = computeCorrections(curve.stats);
    const rawNumeric = preNumeric + corrections.total;
    const numeric = clamp(piecewiseLinear(rawNumeric, ROXY_CONFIG.isotonicKnots), -2, 20);

    return {
        rawAgg,
        logRaw,
        preNumeric,
        corrections,
        rawNumeric,
        numeric,
    };
}

const ROXY_META_ALGOS = Object.freeze(["Azusa", "Sunny", "Daniel", "Mixed", "Companella", "Roxy"]);

function toFeatureNumber(value) {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : 0;
}

function roundedFeature(value) {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? Number(numeric.toFixed(4)) : 0;
}

function resultNumeric(result) {
    const rawNumeric = result?.numericDifficulty;
    if (rawNumeric !== null && rawNumeric !== undefined && rawNumeric !== "") {
        const numeric = Number(rawNumeric);
        if (Number.isFinite(numeric)) return numeric;
    }
    return rcLabelToNumeric(result?.estDiff);
}

function safeReference(run) {
    try {
        const result = run();
        return resultNumeric(result) == null ? null : result;
    } catch {
        return null;
    }
}

function buildReferencePredictions(osuText, options, structuralNumeric) {
    const referenceOptions = {
        ...options,
        withGraph: false,
    };

    const sunnyResult = safeReference(() => runSunnyEstimatorFromText(osuText, referenceOptions));
    const azusaResult = safeReference(() => runAzusaEstimatorFromText(osuText, {
        ...referenceOptions,
        precomputedSunnyResult: sunnyResult,
    }));
    const danielResult = safeReference(() => runDanielEstimatorFromText(osuText, referenceOptions));
    const mixedResult = safeReference(() => runMixedEstimatorFromText(osuText, {
        ...referenceOptions,
        precomputedSunnyResult: sunnyResult,
    }));

    return {
        Azusa: resultNumeric(azusaResult),
        Sunny: resultNumeric(sunnyResult),
        Daniel: resultNumeric(danielResult),
        Mixed: resultNumeric(mixedResult),
        Companella: resultNumeric(sunnyResult),
        Roxy: Number.isFinite(structuralNumeric) ? structuralNumeric : null,
    };
}

function addMetaFeature(map, name, value) {
    map[name] = toFeatureNumber(value);
}

function buildRoxyMetaFeatures(referencePredictions, numericDetails, curve, structuralNumeric) {
    const map = Object.create(null);
    const finitePredictions = [];

    for (const algo of ROXY_META_ALGOS) {
        const value = referencePredictions[algo];
        const hasValue = Number.isFinite(value);
        addMetaFeature(map, `pred_${algo}`, hasValue ? value : 0);
        addMetaFeature(map, `has_${algo}`, hasValue ? 1 : 0);
        if (hasValue) finitePredictions.push(value);
    }

    if (finitePredictions.length === 0) {
        finitePredictions.push(0);
    }
    finitePredictions.sort((a, b) => a - b);
    const predMin = finitePredictions[0];
    const predMax = finitePredictions[finitePredictions.length - 1];
    const predMean = finitePredictions.reduce((sum, value) => sum + value, 0) / finitePredictions.length;
    const predMedian = finitePredictions[Math.floor(finitePredictions.length / 2)];
    addMetaFeature(map, "pred_min", predMin);
    addMetaFeature(map, "pred_max", predMax);
    addMetaFeature(map, "pred_mean", predMean);
    addMetaFeature(map, "pred_median", predMedian);
    addMetaFeature(map, "pred_range", predMax - predMin);

    const pairs = [
        ["Azusa", "Daniel"],
        ["Azusa", "Sunny"],
        ["Azusa", "Mixed"],
        ["Azusa", "Roxy"],
        ["Daniel", "Sunny"],
        ["Daniel", "Mixed"],
        ["Mixed", "Roxy"],
        ["Sunny", "Roxy"],
    ];
    for (const [left, right] of pairs) {
        const diff = toFeatureNumber(referencePredictions[left]) - toFeatureNumber(referencePredictions[right]);
        addMetaFeature(map, `diff_${left}_${right}`, diff);
        addMetaFeature(map, `absdiff_${left}_${right}`, Math.abs(diff));
    }

    addMetaFeature(map, "roxy_logRaw", roundedFeature(numericDetails.logRaw));
    addMetaFeature(map, "roxy_rawAgg", roundedFeature(numericDetails.rawAgg));
    addMetaFeature(map, "roxy_preNumeric", roundedFeature(numericDetails.preNumeric));
    addMetaFeature(map, "roxy_rawNumeric", roundedFeature(numericDetails.rawNumeric));
    addMetaFeature(map, "roxy_finalNumeric", roundedFeature(structuralNumeric));

    for (const name of [
        "lowCj",
        "highStream",
        "highCjDamp",
        "courseBreakDamp",
        "courseSustainLift",
        "denseJsLift",
        "denseJsDamp",
        "anchorLift",
        "handBiasLift",
        "total",
    ]) {
        addMetaFeature(map, `corr_${name}`, roundedFeature(numericDetails.corrections[name]));
    }

    for (const stream of ["speed", "handStream", "jack", "chordjack", "tech", "stamina", "course"]) {
        const summary = curve.streamSummaries[stream] || {};
        for (const key of ["aggregate", "q97", "q90", "q75", "q50", "tailMean", "powerMean"]) {
            addMetaFeature(map, `${stream}_${key}`, roundedFeature(summary[key]));
        }
    }

    const stats = curve.stats || {};
    for (const name of [
        "activeDurationSec",
        "breakCount",
        "breakDensity",
        "avgNps",
        "chordRate",
        "threeRate",
        "overlapRate",
        "rotationRate",
        "sameHandQ10",
        "fastJackRate",
        "anchorRate",
        "anchorImbalance",
        "handBias",
        "peakToSustainGap",
        "rows",
        "taps",
    ]) {
        addMetaFeature(map, `stat_${name}`, roundedFeature(stats[name]));
    }

    const avgNps = toFeatureNumber(stats.avgNps);
    const activeDuration = toFeatureNumber(stats.activeDurationSec);
    const chordRate = toFeatureNumber(stats.chordRate);
    const fastJackRate = toFeatureNumber(stats.fastJackRate);
    const overlapRate = toFeatureNumber(stats.overlapRate);
    const rotationRate = toFeatureNumber(stats.rotationRate);
    const sameHandQ10 = toFeatureNumber(stats.sameHandQ10);
    const breakDensity = toFeatureNumber(stats.breakDensity);
    const peakGap = toFeatureNumber(stats.peakToSustainGap);
    addMetaFeature(map, "logAvgNps", Math.log1p(Math.max(0, avgNps)));
    addMetaFeature(map, "logDuration", Math.log1p(Math.max(0, activeDuration)));
    addMetaFeature(map, "chordFast", chordRate * fastJackRate);
    addMetaFeature(map, "chordOverlap", chordRate * overlapRate);
    addMetaFeature(map, "rotationInvQ10", rotationRate / (sameHandQ10 + 1));
    addMetaFeature(map, "breakPeak", breakDensity * peakGap);

    return ROXY_META_FEATURE_NAMES.map((name) => toFeatureNumber(map[name]));
}

function computeRoxyMetaNumeric(osuText, options, numericDetails, curve, structuralNumeric) {
    const referencePredictions = buildReferencePredictions(osuText, options, structuralNumeric);
    const features = buildRoxyMetaFeatures(referencePredictions, numericDetails, curve, structuralNumeric);
    const metaNumeric = evaluateRoxyMetaModel(features);

    return {
        metaNumeric,
        referencePredictions,
    };
}

function maxFinite(values) {
    let best = Number.NEGATIVE_INFINITY;
    for (const value of values) {
        const numeric = Number(value);
        if (Number.isFinite(numeric)) {
            best = Math.max(best, numeric);
        }
    }
    return best === Number.NEGATIVE_INFINITY ? null : best;
}

function computeExtremeStructuralFloor(speedRate, numericDetails) {
    const logRaw = Number(numericDetails?.logRaw);
    if (!Number.isFinite(logRaw)) return null;

    const rateGain = Math.log2(Math.max(1, speedRate));
    const overflow = Math.max(0, logRaw - ROXY_CONFIG.rawMap.p98);
    if (overflow <= 0 && rateGain <= 0) return null;

    return clamp(16.0 + (2.35 * overflow) + (0.45 * rateGain), -2, 20);
}

function computeSpeedRateLift(speedRate, baselineNumeric, curve) {
    const rateGain = Math.log2(Math.max(1, speedRate));
    if (rateGain <= 0 || !Number.isFinite(baselineNumeric)) return 0;

    const stats = curve?.stats || {};
    const baselineGate = gate(baselineNumeric, 10, 18);
    const densityGate = gate(toFeatureNumber(stats.avgNps), 22, 50);
    const handIntervalGate = inverseGate(toFeatureNumber(stats.sameHandQ10), 25, 80);
    const chordGate = gate(toFeatureNumber(stats.chordRate), 0.25, 0.55);
    const gainPerDoubling = 1.00
        + (1.10 * baselineGate)
        + (0.45 * densityGate)
        + (0.35 * handIntervalGate)
        + (0.20 * chordGate);

    return rateGain * gainPerDoubling;
}

function applySpeedRateGuard(osuText, options, speedRate, unguardedNumeric, numericDetails, curve, referencePredictions) {
    const result = {
        applied: false,
        speedRate,
        unguardedNumeric,
        finalFloor: null,
        baselineNumeric: null,
        baselineFloor: null,
        referenceFloor: null,
        extremeStructuralFloor: null,
    };

    if (options?._skipRoxySpeedRateGuard === true || speedRate <= 1.000001 || !Number.isFinite(unguardedNumeric)) {
        return {
            numeric: unguardedNumeric,
            debug: result,
        };
    }

    const rateGain = Math.log2(Math.max(1, speedRate));
    const finiteReferenceMax = maxFinite(Object.values(referencePredictions || {}));
    if (finiteReferenceMax != null) {
        result.referenceFloor = finiteReferenceMax + (0.25 * rateGain * gate(finiteReferenceMax, 12, 18));
    }
    result.extremeStructuralFloor = computeExtremeStructuralFloor(speedRate, numericDetails);

    try {
        const baselineResult = runRoxyEstimatorFromText(osuText, {
            ...options,
            speedRate: 1.0,
            withGraph: false,
            _skipRoxySpeedRateGuard: true,
        });
        const baselineNumeric = Number(baselineResult?.numericDifficulty);
        if (Number.isFinite(baselineNumeric)) {
            result.baselineNumeric = baselineNumeric;
            result.baselineFloor = baselineNumeric + computeSpeedRateLift(speedRate, baselineNumeric, curve);
        }
    } catch {
        result.baselineNumeric = null;
        result.baselineFloor = null;
    }

    const floor = maxFinite([
        result.baselineFloor,
        result.extremeStructuralFloor,
    ]);
    result.finalFloor = floor;

    if (floor == null) {
        return {
            numeric: unguardedNumeric,
            debug: result,
        };
    }

    result.applied = true;
    return {
        numeric: clamp(floor, -2, 20),
        debug: result,
    };
}

export function runRoxyEstimatorFromText(osuText, options = {}) {
    try {
        if (typeof osuText !== "string" || osuText.trim().length === 0) {
            return buildErrorResult("EmptyInput", "Beatmap text is empty");
        }

        const speedRate = Number(options.speedRate ?? 1.0);
        if (!Number.isFinite(speedRate) || speedRate <= 0) {
            return buildErrorResult("InvalidSpeedRate", "Invalid speed rate");
        }

        const parser = new OsuFileParser(osuText);
        parser.process();
        applyConversionFlag(parser, options.cvtFlag);
        const parsed = parser.getParsedData();

        const lnRatio = Number(parsed.lnRatio) || 0;
        const columnCount = Number(parsed.columnCount) || 0;

        if (parsed.status === "Fail") {
            return buildErrorResult("ParseFailed", "Beatmap parse failed", { lnRatio, columnCount });
        }
        if (parsed.status === "NotMania") {
            return buildErrorResult("NotMania", "Beatmap mode is not mania", { lnRatio, columnCount });
        }
        if (columnCount !== 4) {
            return buildErrorResult("UnsupportedKeys", "Roxy only supports 4K", { lnRatio, columnCount });
        }
        if (lnRatio > ROXY_CONFIG.rcLnRatioLimit) {
            return buildErrorResult(
                "UnsupportedLN",
                `Roxy RC scope rejects LN ratio ${(lnRatio * 100).toFixed(1)}%`,
                { lnRatio, columnCount },
            );
        }

        const { taps, rows } = buildTapRows(parsed, speedRate, ROXY_CONFIG.rowToleranceMs);
        if (taps.length < ROXY_CONFIG.minNotes || rows.length < 2) {
            return buildErrorResult("TooFewNotes", "Not enough RC tap notes", { lnRatio, columnCount });
        }

        const tapTimes = taps.map((tap) => tap.t);
        computeNpsRows(rows, tapTimes);
        const activity = computeActivityStats(rows, taps.length);
        const curve = computeRoxyCurve(rows, taps, activity);
        const numericDetails = computeRoxyNumeric(curve);
        const structuralNumeric = Number(numericDetails.numeric.toFixed(2));
        const metaDetails = computeRoxyMetaNumeric(osuText, options, numericDetails, curve, structuralNumeric);
        const metaNumeric = Number(metaDetails.metaNumeric);
        const unguardedNumeric = Number.isFinite(metaNumeric) ? metaNumeric : structuralNumeric;
        const guarded = applySpeedRateGuard(
            osuText,
            options,
            speedRate,
            unguardedNumeric,
            numericDetails,
            curve,
            metaDetails.referencePredictions,
        );
        const finalNumeric = Number(guarded.numeric.toFixed(2));
        const estDiff = numericToRcLabel(finalNumeric);

        return {
            star: Number((3.4 + 0.38 * finalNumeric).toFixed(4)),
            lnRatio,
            columnCount,
            estDiff,
            numericDifficulty: finalNumeric,
            numericDifficultyHint: "roxy-meta-gbdt-v2",
            graph: options.withGraph === true ? smoothGraphSeries(curve.graph) : null,
            rawNumericDifficulty: Number(numericDetails.rawNumeric.toFixed(4)),
            debug: {
                notes: taps.length,
                rows: rows.length,
                rawAgg: fmt4(numericDetails.rawAgg),
                logRaw: fmt4(numericDetails.logRaw),
                preNumeric: fmt4(numericDetails.preNumeric),
                rawNumeric: fmt4(numericDetails.rawNumeric),
                structuralNumeric: fmt4(structuralNumeric),
                metaNumeric: fmt4(metaNumeric),
                unguardedNumeric: fmt4(unguardedNumeric),
                finalNumeric: fmt4(finalNumeric),
                speedRateGuard: Object.fromEntries(Object.entries(guarded.debug).map(([key, value]) => [key, fmtDebugValue(value)])),
                meta: {
                    featureCount: ROXY_META_FEATURE_NAMES.length,
                    references: Object.fromEntries(Object.entries(metaDetails.referencePredictions).map(([key, value]) => [key, fmt4(value)])),
                },
                stats: Object.fromEntries(Object.entries(curve.stats).map(([key, value]) => (
                    [key, Array.isArray(value) ? value : fmt4(value)]
                ))),
                corrections: Object.fromEntries(Object.entries(numericDetails.corrections).map(([key, value]) => [key, fmt4(value)])),
                streams: Object.fromEntries(Object.entries(curve.streamSummaries).map(([key, value]) => [
                    key,
                    Object.fromEntries(Object.entries(value).map(([innerKey, innerValue]) => [innerKey, fmt4(innerValue)])),
                ])),
            },
        };
    } catch (error) {
        return buildErrorResult("RoxyError", error?.message || "Roxy estimator failed");
    }
}
