import { calculate as calculateSunny } from "../rework/sunnyAlgorithm.js";
import { calculateLN } from "../rework/sunnyWindowAlgorithm.js"
import { estDiff2, normalizeReworkResult } from "./reworkEstimatorUtils.js";

function normalizeSunnyWindowResult(result) {
    if (result === -3) return {star: 0};
    else if (typeof result === "object" && result?.NoLN) return {star: 0, }
    return normalizeReworkResult(result);
}

export function runSunnyWindowEstimatorFromText(osuText, options = {}) {
    const speedRate = options.speedRate ?? 1.0;
    const odFlag = options.odFlag ?? null;
    const cvtFlag = options.cvtFlag ?? null;
    const withGraph = options.withGraph === true;

    const rawResult = calculateSunny(osuText, speedRate, odFlag, cvtFlag, { withGraph });
    const parsed = normalizeReworkResult(rawResult);

    const rawResultLN = calculateLN(osuText, speedRate, odFlag, cvtFlag, { withGraph });
    const parsedLN = normalizeSunnyWindowResult(rawResultLN);

    return {
        ...parsed,
        estDiff: estDiff2(parsed.star, parsedLN.star, parsed.columnCount),
        numericDifficulty: null,
        numericDifficultyHint: null,
    };
}
