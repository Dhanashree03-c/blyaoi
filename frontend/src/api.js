// api.js - Robust client with auto-discovery, proxy support, and client-side demo simulation fallback

const DEFAULT_API_BASE = import.meta.env.VITE_API_URL || "";

// Generate realistic GB wind simulation data in the browser if backend is offline or in Demo Mode
export function generateClientSimulation(deliveryDateStr, cutoffStr, imbalancePrice = 75.0) {
  const [year, month, day] = deliveryDateStr.split("-").map(Number);
  const seed = year * 1000 + month * 50 + day;
  const baseMw = 7500.0 + (seed % 11) * 950.0;
  const diurnalAmp = 1800.0 + (seed % 5) * 350.0;
  const rampTrend = ((seed % 7) - 3) * 160.0;

  const [cutoffH, cutoffM] = cutoffStr.split(":").map(Number);
  const cutoffHour = cutoffH + cutoffM / 60.0;
  const leadPenalty = Math.max(0.5, (24.0 - cutoffHour) / 14.0);

  const matched = [];
  const actuals = [];
  const forecasts = [];

  for (let h = 0; h < 24; h++) {
    const t = h;
    const wave = diurnalAmp * Math.sin(((t - 6.0) * Math.PI) / 12.0);
    const trend = rampTrend * (t - 12.0);
    const noise = Math.sin(seed * 0.17 + h * 2.6) * 220.0;

    const actual = Math.max(600.0, Math.round((baseMw + wave + trend + noise) * 10) / 10);

    const forecastError =
      Math.sin(seed * 0.31 + h * 0.85) * (420.0 * leadPenalty) +
      Math.cos(h * 0.5) * (180.0 * leadPenalty) +
      ((seed % 3) - 1) * 250.0;

    const forecast = Math.max(500.0, Math.round((actual + forecastError) * 10) / 10);
    const error = Math.round((forecast - actual) * 10) / 10;
    const absError = Math.round(Math.abs(error) * 10) / 10;
    const pctError = actual > 0 ? Math.round((absError / actual) * 1000) / 10 : 0.0;

    let status = "aligned";
    if (error > 50.0) status = "over";
    else if (error < -50.0) status = "under";

    const hourStr = String(h).padStart(2, "0");
    const startTime = `${deliveryDateStr}T${hourStr}:00:00Z`;
    const publishTime = `${deliveryDateStr}T${cutoffStr}:00Z`;

    actuals.push(actual);
    forecasts.push(forecast);

    matched.push({
      startTime,
      publishTime,
      forecast,
      actual,
      error,
      absolute_error: absError,
      percent_error: pctError,
      status,
    });
  }

  const errors = matched.map((m) => m.error);
  const absoluteErrors = matched.map((m) => m.absolute_error);
  const actualTotal = actuals.reduce((a, b) => a + b, 0);
  const forecastTotal = forecasts.reduce((a, b) => a + b, 0);
  const matchedCount = matched.length;

  const mae = Math.round((absoluteErrors.reduce((a, b) => a + b, 0) / matchedCount) * 10) / 10;
  const rmse =
    Math.round(
      Math.sqrt(errors.reduce((sum, e) => sum + e * e, 0) / matchedCount) * 10
    ) / 10;
  const bias = Math.round((errors.reduce((a, b) => a + b, 0) / matchedCount) * 10) / 10;
  const wape =
    actualTotal !== 0
      ? Math.round((absoluteErrors.reduce((a, b) => a + b, 0) / Math.abs(actualTotal)) * 10000) /
        100
      : null;

  const meanActual = actualTotal / matchedCount;
  const ssTot = actuals.reduce((sum, a) => sum + (a - meanActual) ** 2, 0);
  const ssRes = errors.reduce((sum, e) => sum + e * e, 0);
  const rSquared = ssTot > 0 ? Math.max(0, Math.round((1.0 - ssRes / ssTot) * 1000) / 1000) : 1.0;

  const grossOver = errors.filter((e) => e > 0).reduce((a, b) => a + b, 0);
  const grossUnder = errors.filter((e) => e < 0).reduce((sum, e) => sum + Math.abs(e), 0);
  const netImbalanceMwh = Math.round((forecastTotal - actualTotal) * 10) / 10;
  const imbalanceCostEst = Math.round(Math.abs(netImbalanceMwh) * imbalancePrice * 100) / 100;

  const actualRamps = [];
  const forecastRamps = [];
  const rampErrors = [];
  for (let i = 1; i < actuals.length; i++) {
    const aRamp = actuals[i] - actuals[i - 1];
    const fRamp = forecasts[i] - forecasts[i - 1];
    actualRamps.push(Math.abs(aRamp));
    forecastRamps.push(Math.abs(fRamp));
    rampErrors.push(Math.abs(fRamp - aRamp));
  }

  return {
    delivery_date: deliveryDateStr,
    cutoff_utc: `${deliveryDateStr}T${cutoffStr}:00Z`,
    matched_intervals: matchedCount,
    forecast_intervals: 24,
    actual_intervals: 24,
    missing_forecast_intervals: 0,
    missing_actual_matches: 0,
    is_simulated: true,
    is_client_fallback: true,
    metrics: {
      mae,
      rmse,
      bias,
      wape_percent: wape,
      max_absolute_error: Math.max(...absoluteErrors),
      r_squared: rSquared,
      total_actual_mwh: Math.round(actualTotal * 10) / 10,
      total_forecast_mwh: Math.round(forecastTotal * 10) / 10,
      net_imbalance_mwh: netImbalanceMwh,
      gross_overforecast_mwh: Math.round(grossOver * 10) / 10,
      gross_underforecast_mwh: Math.round(grossUnder * 10) / 10,
      imbalance_price_gbp: imbalancePrice,
      estimated_imbalance_cost_gbp: imbalanceCostEst,
      peak_actual_mw: Math.max(...actuals),
      peak_forecast_mw: Math.max(...forecasts),
      capacity_factor_percent: Math.round((actualTotal / (24 * 30000)) * 1000) / 10,
    },
    ramp_analysis: {
      max_actual_ramp_mw: Math.round(Math.max(...actualRamps) * 10) / 10,
      max_forecast_ramp_mw: Math.round(Math.max(...forecastRamps) * 10) / 10,
      max_ramp_error_mw: Math.round(Math.max(...rampErrors) * 10) / 10,
    },
    intervals: matched,
    interpretation_note:
      "Simulated GB Benchmark data. Positive bias indicates over-forecasting. Imbalance cost is an analytical estimate based on configured GBP/MWh cashout assumption.",
  };
}

// Ping health check to test backend
export async function pingBackend(baseUrl = DEFAULT_API_BASE) {
  const start = performance.now();
  const url = baseUrl ? `${baseUrl.replace(/\/$/, "")}/api/health` : "/api/health";
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 2500);
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timeoutId);
    const latency = Math.round(performance.now() - start);
    if (res.ok) {
      const data = await res.json();
      return { ok: true, latency, data, url };
    }
    return { ok: false, error: `HTTP ${res.status}` };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

// Resilient accuracy fetcher
export async function fetchAccuracyData({
  deliveryDate,
  cutoff,
  imbalancePrice = 75.0,
  forceDemo = false,
  customBaseUrl = null,
}) {
  if (forceDemo) {
    return generateClientSimulation(deliveryDate, cutoff, imbalancePrice);
  }

  const params = new URLSearchParams({
    delivery_date: deliveryDate,
    cutoff,
    imbalance_price: String(imbalancePrice),
  });

  const candidates = [];
  if (customBaseUrl) {
    candidates.push(`${customBaseUrl.replace(/\/$/, "")}/api/accuracy?${params}`);
  } else if (DEFAULT_API_BASE) {
    candidates.push(`${DEFAULT_API_BASE.replace(/\/$/, "")}/api/accuracy?${params}`);
  } else {
    // Relative path (Vite proxy dev / production proxy)
    candidates.push(`/api/accuracy?${params}`);
    // Direct fallbacks in case proxy isn't used
    candidates.push(`http://127.0.0.1:8001/api/accuracy?${params}`);
    candidates.push(`http://127.0.0.1:8000/api/accuracy?${params}`);
    candidates.push(`http://localhost:8001/api/accuracy?${params}`);
  }

  let lastError = null;

  for (const url of candidates) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 4000);
      const res = await fetch(url, { signal: controller.signal });
      clearTimeout(timeoutId);

      if (res.ok) {
        const data = await res.json();
        if (data && data.metrics && data.intervals?.length) {
          return data;
        }
      }
    } catch (err) {
      lastError = err;
    }
  }

  // If backend was unreachable, gracefully fall back to client simulation
  console.warn("Backend unavailable, using simulated GB benchmark dataset:", lastError?.message);
  const fallbackData = generateClientSimulation(deliveryDate, cutoff, imbalancePrice);
  fallbackData.backend_offline = true;
  return fallbackData;
}

// Resilient Cutoff Comparison fetcher
export async function fetchComparisonData({
  deliveryDate,
  cutoffs = ["06:00", "10:00", "14:00", "17:00"],
  forceDemo = false,
  customBaseUrl = null,
}) {
  if (forceDemo) {
    return generateClientComparison(deliveryDate, cutoffs);
  }

  const params = new URLSearchParams({ delivery_date: deliveryDate });
  cutoffs.forEach((c) => params.append("cutoffs", c));

  const candidates = [];
  if (customBaseUrl) {
    candidates.push(`${customBaseUrl.replace(/\/$/, "")}/api/comparison?${params}`);
  } else if (DEFAULT_API_BASE) {
    candidates.push(`${DEFAULT_API_BASE.replace(/\/$/, "")}/api/comparison?${params}`);
  } else {
    candidates.push(`/api/comparison?${params}`);
    candidates.push(`http://127.0.0.1:8001/api/comparison?${params}`);
    candidates.push(`http://127.0.0.1:8000/api/comparison?${params}`);
  }

  for (const url of candidates) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 4500);
      const res = await fetch(url, { signal: controller.signal });
      clearTimeout(timeoutId);

      if (res.ok) {
        const data = await res.json();
        if (data?.comparison?.length) {
          return data;
        }
      }
    } catch {
      // Continue to next candidate
    }
  }

  return generateClientComparison(deliveryDate, cutoffs);
}

function generateClientComparison(deliveryDate, cutoffs) {
  const comparison = cutoffs.map((cutoff) => {
    const sim = generateClientSimulation(deliveryDate, cutoff);
    return {
      cutoff,
      mae: sim.metrics.mae,
      rmse: sim.metrics.rmse,
      bias: sim.metrics.bias,
      wape_percent: sim.metrics.wape_percent,
      max_absolute_error: sim.metrics.max_absolute_error,
      intervals: sim.intervals.map((i) => ({
        startTime: i.startTime,
        forecast: i.forecast,
        actual: i.actual,
        error: i.error,
      })),
    };
  });

  const firstMae = comparison[0]?.mae || 0;
  const lastMae = comparison[comparison.length - 1]?.mae || 0;
  const improvement = firstMae > 0 ? Math.round(((firstMae - lastMae) / firstMae) * 1000) / 10 : 0;

  return {
    delivery_date: deliveryDate,
    cutoffs_analyzed: cutoffs,
    comparison,
    mae_improvement_percent: improvement,
    is_simulated: true,
  };
}
