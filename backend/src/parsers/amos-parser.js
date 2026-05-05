function parseAmosRows(text) {
  if (typeof text !== "string" || !text.trim()) {
    return [];
  }

  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"))
    .map((line) => {
      const fields = line.split(/\s+/);
      if (fields.length < 13) return null;

      const tm = fields[1];
      const rnRaw = Number(fields[12]);
      if (!/^\d{12}$/.test(tm) || !Number.isFinite(rnRaw)) {
        return null;
      }

      return { tm, rn_raw: rnRaw };
    })
    .filter(Boolean);
}

function parseTmToMs(tm) {
  if (!/^\d{12}$/.test(tm)) return NaN;
  const y = Number(tm.slice(0, 4));
  const m = Number(tm.slice(4, 6));
  const d = Number(tm.slice(6, 8));
  const hh = Number(tm.slice(8, 10));
  const mi = Number(tm.slice(10, 12));
  return Date.UTC(y, m - 1, d, hh - 9, mi, 0, 0);
}

function pickDailyRainfallAtTime(rows, targetTm, toleranceMinutes = 60) {
  if (!Array.isArray(rows) || rows.length === 0) {
    return null;
  }

  const sorted = rows.slice().sort((a, b) => a.tm.localeCompare(b.tm));
  const exact = sorted.find((row) => row.tm === targetTm);
  const candidate = exact || sorted.filter((row) => row.tm <= targetTm).slice(-1)[0] || sorted[sorted.length - 1];
  if (!candidate) {
    return null;
  }

  const targetMs = parseTmToMs(targetTm);
  const obsMs = parseTmToMs(candidate.tm);
  const diffMin = Number.isFinite(targetMs) && Number.isFinite(obsMs)
    ? Math.abs(targetMs - obsMs) / 60000
    : Infinity;
  const stale = !Number.isFinite(diffMin) || diffMin > toleranceMinutes;

  if (candidate.rn_raw === -99999 || stale) {
    return {
      mm: null,
      rn_raw: candidate.rn_raw,
      observed_tm_kst: candidate.tm,
      target_tm_kst: targetTm,
      stale
    };
  }

  return {
    mm: candidate.rn_raw / 10,
    rn_raw: candidate.rn_raw,
    observed_tm_kst: candidate.tm,
    target_tm_kst: targetTm,
    stale
  };
}

export { parseAmosRows, pickDailyRainfallAtTime }
export default { parseAmosRows, pickDailyRainfallAtTime }
