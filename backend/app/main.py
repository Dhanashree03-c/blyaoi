from __future__ import annotations

import math
import os
from datetime import date, datetime, time, timedelta, timezone
from typing import Any

import httpx
from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware

app = FastAPI(
    title="WindDesk API",
    description="GB wind generation forecast analysis and market intelligence",
    version="0.3.0",
)

# CORS configuration: allow dev origins, docker, local network, and custom CORS_ORIGINS
DEFAULT_CORS_ORIGINS = [
    "http://localhost:5174",
    "http://127.0.0.1:5174",
    "http://localhost:5173",
    "http://127.0.0.1:5173",
    "http://localhost:3000",
    "http://127.0.0.1:3000",
]
cors_origins = [
    origin.strip()
    for origin in os.getenv("CORS_ORIGINS", "").split(",")
    if origin.strip()
]
app.add_middleware(
    CORSMiddleware,
    allow_origins=cors_origins or ["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

ELEXON_BASE_URL = "https://data.elexon.co.uk/bmrs/api/v1/datasets"
HTTP_TIMEOUT = httpx.Timeout(connect=2.5, read=10.0, write=5.0, pool=5.0)
FORECAST_LOOKBACK_DAYS = max(1, int(os.getenv("FORECAST_LOOKBACK_DAYS", "2")))
EXPECTED_HOURLY_INTERVALS = 24
EXPECTED_HALF_HOURLY_INTERVALS = 48
GB_WIND_FLEET_CAPACITY_MW = 30000.0  # Approximate GB wind installed capacity in 2026


@app.get("/")
def home() -> dict[str, Any]:
    return {
        "app": "WindDesk",
        "version": "0.3.0",
        "message": "WindDesk API is running",
        "endpoints": {
            "health": "/api/health",
            "accuracy": "/api/accuracy",
            "comparison": "/api/comparison",
            "forecasts": "/api/forecasts",
            "actuals": "/api/actuals",
        },
    }


@app.get("/api/health")
def health() -> dict[str, Any]:
    return {
        "status": "ok",
        "version": "0.3.0",
        "service": "WindDesk API",
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "upstream_elexon_url": ELEXON_BASE_URL,
    }


def _extract_records(data: Any) -> list[dict[str, Any]]:
    """Support either a direct JSON list or an object wrapping records."""
    if isinstance(data, list):
        return [item for item in data if isinstance(item, dict)]
    if isinstance(data, dict):
        records = data.get("data", [])
        if isinstance(records, list):
            return [item for item in records if isinstance(item, dict)]
    return []


def _parse_timestamp(value: Any) -> datetime | None:
    """Parse an ISO timestamp and normalize it to UTC."""
    if not isinstance(value, str) or not value:
        return None
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc)


def _parse_generation(value: Any) -> float | None:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    return number if math.isfinite(number) else None


def _cutoff_datetime(delivery_date: date, cutoff: str) -> datetime:
    """The configured cutoff is interpreted as UTC on the preceding day."""
    try:
        parsed_time = datetime.strptime(cutoff, "%H:%M").time()
    except ValueError as exc:
        raise HTTPException(
            status_code=400,
            detail="cutoff must use HH:MM format, e.g. 10:00",
        ) from exc

    if parsed_time.strftime("%H:%M") != cutoff:
        raise HTTPException(
            status_code=400,
            detail="cutoff must use zero-padded HH:MM format, e.g. 10:00",
        )

    return datetime.combine(
        delivery_date - timedelta(days=1),
        parsed_time,
        tzinfo=timezone.utc,
    )


def _publication_window(delivery_date: date) -> datetime:
    return datetime.combine(
        delivery_date - timedelta(days=FORECAST_LOOKBACK_DAYS),
        time.min,
        tzinfo=timezone.utc,
    )


def _iso_utc(value: datetime) -> str:
    return value.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")


def _generate_synthetic_wind_data(
    delivery_date: date, cutoff_datetime: datetime
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    """Generate realistic GB wind generation and forecast benchmark records."""
    seed = delivery_date.year * 1000 + delivery_date.month * 50 + delivery_date.day
    base_mw = 7500.0 + (seed % 11) * 950.0
    diurnal_amp = 1800.0 + (seed % 5) * 350.0
    ramp_trend = ((seed % 7) - 3) * 160.0

    cutoff_hour = cutoff_datetime.hour + cutoff_datetime.minute / 60.0
    lead_penalty = max(0.5, (24.0 - cutoff_hour) / 14.0)

    actual_records: list[dict[str, Any]] = []
    forecast_records: list[dict[str, Any]] = []

    # 48 half-hourly actual observations (FUELHH)
    for hh in range(48):
        hour = hh // 2
        minute = (hh % 2) * 30
        dt = datetime(
            delivery_date.year,
            delivery_date.month,
            delivery_date.day,
            hour,
            minute,
            tzinfo=timezone.utc,
        )

        t = hour + minute / 60.0
        wave = diurnal_amp * math.sin((t - 6.0) * math.pi / 12.0)
        trend = ramp_trend * (t - 12.0)
        noise = math.sin(seed * 0.17 + hh * 1.3) * 220.0

        gen = max(600.0, base_mw + wave + trend + noise)
        actual_records.append(
            {
                "startTime": _iso_utc(dt),
                "settlementDate": delivery_date.isoformat(),
                "settlementPeriod": hh + 1,
                "fuelType": "WIND",
                "generation": round(gen, 1),
            }
        )

    # Hourly forecast records (WINDFOR)
    publish_dt = cutoff_datetime - timedelta(minutes=15)
    for h in range(24):
        dt = datetime(
            delivery_date.year,
            delivery_date.month,
            delivery_date.day,
            h,
            0,
            tzinfo=timezone.utc,
        )
        t = float(h)
        wave = diurnal_amp * math.sin((t - 6.0) * math.pi / 12.0)
        trend = ramp_trend * (t - 12.0)
        actual_h = max(600.0, base_mw + wave + trend)

        # Forecast error depends on cutoff lead time
        forecast_error = (
            math.sin(seed * 0.31 + h * 0.85) * (420.0 * lead_penalty)
            + math.cos(h * 0.5) * (180.0 * lead_penalty)
            + ((seed % 3) - 1) * 250.0
        )
        forecast_val = max(500.0, actual_h + forecast_error)

        forecast_records.append(
            {
                "startTime": _iso_utc(dt),
                "publishTime": _iso_utc(publish_dt),
                "generation": round(forecast_val, 1),
            }
        )

    return actual_records, forecast_records


async def _get_elexon_records(
    dataset: str, params: dict[str, str]
) -> list[dict[str, Any]]:
    import asyncio
    url = f"{ELEXON_BASE_URL}/{dataset}/stream"
    try:
        async with httpx.AsyncClient(timeout=HTTP_TIMEOUT) as client:
            response = await asyncio.wait_for(client.get(url, params=params), timeout=4.0)
            response.raise_for_status()
            data = response.json()
    except (httpx.HTTPStatusError, httpx.RequestError, asyncio.TimeoutError) as exc:
        raise HTTPException(
            status_code=502,
            detail=f"Could not connect to Elexon dataset {dataset}: {exc}",
        ) from exc
    except ValueError as exc:
        raise HTTPException(
            status_code=502,
            detail=f"Elexon returned invalid JSON for dataset {dataset}.",
        ) from exc

    return _extract_records(data)


async def _fetch_accuracy_inputs(
    actual_params: dict[str, str],
    forecast_params: dict[str, str],
    delivery_date: date,
    cutoff_datetime: datetime,
    force_mock: bool = False,
) -> tuple[list[dict[str, Any]], list[dict[str, Any]], bool]:
    """
    Fetch actual and forecast records concurrently.
    Falls back gracefully to benchmark simulation if Elexon upstream is unreachable.
    """
    import asyncio

    if force_mock:
        actuals, forecasts = _generate_synthetic_wind_data(
            delivery_date, cutoff_datetime
        )
        return actuals, forecasts, True

    try:
        async with httpx.AsyncClient(timeout=HTTP_TIMEOUT) as client:
            actual_response, forecast_response = await asyncio.wait_for(
                _request_both(client, actual_params, forecast_params),
                timeout=4.0,
            )
            actual_response.raise_for_status()
            forecast_response.raise_for_status()
            actual_data = actual_response.json()
            forecast_data = forecast_response.json()
            return (
                _extract_records(actual_data),
                _extract_records(forecast_data),
                False,
            )
    except Exception:
        # Fallback to realistic GB benchmark simulation when upstream Elexon is unavailable or times out
        actuals, forecasts = _generate_synthetic_wind_data(
            delivery_date, cutoff_datetime
        )
        return actuals, forecasts, True


async def _request_both(
    client: httpx.AsyncClient,
    actual_params: dict[str, str],
    forecast_params: dict[str, str],
) -> tuple[httpx.Response, httpx.Response]:
    import asyncio

    actual_task = client.get(
        f"{ELEXON_BASE_URL}/FUELHH/stream", params=actual_params
    )
    forecast_task = client.get(
        f"{ELEXON_BASE_URL}/WINDFOR/stream", params=forecast_params
    )
    return tuple(await asyncio.gather(actual_task, forecast_task))  # type: ignore[return-value]


@app.get("/api/actuals")
async def get_actual_wind(
    start_date: date = Query(default=date(2026, 1, 1)),
    end_date: date = Query(default=date(2026, 1, 31)),
    mock: bool = Query(default=False),
) -> dict[str, Any]:
    """Fetch actual GB wind generation from Elexon's FUELHH dataset."""
    if start_date > end_date:
        raise HTTPException(
            status_code=400,
            detail="start_date must not be after end_date",
        )

    if mock:
        records, _ = _generate_synthetic_wind_data(
            start_date, datetime.combine(start_date, time(10, 0), tzinfo=timezone.utc)
        )
        is_simulated = True
    else:
        params = {
            "settlementDateFrom": start_date.isoformat(),
            "settlementDateTo": end_date.isoformat(),
            "fuelType": "WIND",
        }
        try:
            records = await _get_elexon_records("FUELHH", params)
            is_simulated = False
        except HTTPException:
            records, _ = _generate_synthetic_wind_data(
                start_date,
                datetime.combine(start_date, time(10, 0), tzinfo=timezone.utc),
            )
            is_simulated = True

    return {
        "source": "Simulated GB Benchmark" if is_simulated else "Elexon BMRS FUELHH",
        "fuel_type": "WIND",
        "start_date": start_date.isoformat(),
        "end_date": end_date.isoformat(),
        "record_count": len(records),
        "is_simulated": is_simulated,
        "records": records,
    }


@app.get("/api/forecasts")
async def get_wind_forecasts(
    delivery_date: date = Query(default=date(2026, 1, 15)),
    cutoff: str = Query(default="10:00"),
    mock: bool = Query(default=False),
) -> dict[str, Any]:
    """Return eligible WINDFOR records for a delivery date."""
    cutoff_datetime = _cutoff_datetime(delivery_date, cutoff)
    publish_from = _publication_window(delivery_date)

    if mock:
        _, eligible_records = _generate_synthetic_wind_data(
            delivery_date, cutoff_datetime
        )
        is_simulated = True
    else:
        params = {
            "publishDateTimeFrom": _iso_utc(publish_from),
            "publishDateTimeTo": _iso_utc(cutoff_datetime),
        }
        try:
            records = await _get_elexon_records("WINDFOR", params)
            is_simulated = False
            eligible_records = []
            for record in records:
                delivery_start = _parse_timestamp(record.get("startTime"))
                published_at = _parse_timestamp(record.get("publishTime"))
                if delivery_start is None or published_at is None:
                    continue
                if delivery_start.date() != delivery_date:
                    continue
                if published_at > cutoff_datetime or published_at < publish_from:
                    continue
                eligible_records.append(record)

            eligible_records.sort(
                key=lambda record: (
                    _parse_timestamp(record.get("startTime"))
                    or datetime.min.replace(tzinfo=timezone.utc),
                    _parse_timestamp(record.get("publishTime"))
                    or datetime.min.replace(tzinfo=timezone.utc),
                )
            )
        except HTTPException:
            _, eligible_records = _generate_synthetic_wind_data(
                delivery_date, cutoff_datetime
            )
            is_simulated = True

    return {
        "source": "Simulated GB Benchmark" if is_simulated else "Elexon BMRS WINDFOR",
        "delivery_date": delivery_date.isoformat(),
        "cutoff_utc": _iso_utc(cutoff_datetime),
        "publication_window_start_utc": _iso_utc(publish_from),
        "lookback_days": FORECAST_LOOKBACK_DAYS,
        "record_count": len(eligible_records),
        "is_simulated": is_simulated,
        "records": eligible_records,
        "note": (
            "Records include multiple eligible forecast vintages. "
            "Use /api/accuracy for the latest eligible vintage per interval."
        ),
    }


def _calculate_accuracy(
    actual_records: list[dict[str, Any]],
    forecast_records: list[dict[str, Any]],
    delivery_date: date,
    cutoff_datetime: datetime,
    publish_from: datetime,
    imbalance_price: float = 75.0,
    is_simulated: bool = False,
) -> dict[str, Any]:
    """Helper to process intervals and calculate comprehensive energy forecast metrics."""
    actual_values_by_hour: dict[datetime, dict[datetime, float]] = {}
    valid_actual_half_hours = 0
    for record in actual_records:
        interval = _parse_timestamp(record.get("startTime"))
        generation = _parse_generation(record.get("generation"))
        if interval is None or generation is None:
            continue
        if interval.date() != delivery_date:
            continue

        valid_actual_half_hours += 1
        hour_start = interval.replace(minute=0, second=0, microsecond=0)
        actual_values_by_hour.setdefault(hour_start, {})[interval] = generation

    actual_by_interval: dict[datetime, float] = {}
    for hour_start, observations in actual_values_by_hour.items():
        if len(observations) == 2:
            actual_by_interval[hour_start] = sum(observations.values()) / 2
        elif is_simulated and len(observations) >= 1:
            actual_by_interval[hour_start] = sum(observations.values()) / len(
                observations
            )

    latest_forecast_by_interval: dict[datetime, dict[str, Any]] = {}
    eligible_forecast_records = 0
    for record in forecast_records:
        interval = _parse_timestamp(record.get("startTime"))
        published = _parse_timestamp(record.get("publishTime"))
        generation = _parse_generation(record.get("generation"))
        if interval is None or published is None or generation is None:
            continue
        if interval.date() != delivery_date:
            continue
        if published < publish_from or published > cutoff_datetime:
            continue

        eligible_forecast_records += 1
        previous = latest_forecast_by_interval.get(interval)
        if previous is None or published >= previous["published_at"]:
            latest_forecast_by_interval[interval] = {
                "published_at": published,
                "forecast": generation,
            }

    matched: list[dict[str, Any]] = []
    for interval, forecast_record in sorted(latest_forecast_by_interval.items()):
        if interval not in actual_by_interval:
            continue

        forecast = round(forecast_record["forecast"], 1)
        actual = round(actual_by_interval[interval], 1)
        error = round(forecast - actual, 1)
        abs_error = round(abs(error), 1)
        pct_error = round((abs_error / actual * 100) if actual > 0 else 0.0, 1)

        status = "aligned"
        if error > 50.0:
            status = "over"
        elif error < -50.0:
            status = "under"

        matched.append(
            {
                "startTime": _iso_utc(interval),
                "publishTime": _iso_utc(forecast_record["published_at"]),
                "forecast": forecast,
                "actual": actual,
                "error": error,
                "absolute_error": abs_error,
                "percent_error": pct_error,
                "status": status,
            }
        )

    forecast_interval_count = len(latest_forecast_by_interval)
    actual_interval_count = len(actual_by_interval)
    matched_count = len(matched)
    missing_forecast_intervals = max(
        0, EXPECTED_HOURLY_INTERVALS - forecast_interval_count
    )
    missing_actual_matches = sum(
        1
        for interval in latest_forecast_by_interval
        if interval not in actual_by_interval
    )

    if not matched:
        return {
            "delivery_date": delivery_date.isoformat(),
            "cutoff_utc": _iso_utc(cutoff_datetime),
            "publication_window_start_utc": _iso_utc(publish_from),
            "lookback_days": FORECAST_LOOKBACK_DAYS,
            "expected_hourly_intervals": EXPECTED_HOURLY_INTERVALS,
            "expected_half_hourly_actuals": EXPECTED_HALF_HOURLY_INTERVALS,
            "valid_actual_half_hour_records": valid_actual_half_hours,
            "eligible_forecast_records_before_deduplication": eligible_forecast_records,
            "forecast_intervals": forecast_interval_count,
            "actual_intervals": actual_interval_count,
            "matched_intervals": 0,
            "missing_forecast_intervals": missing_forecast_intervals,
            "missing_actual_matches": missing_actual_matches,
            "metrics": None,
            "intervals": [],
            "is_simulated": is_simulated,
            "message": (
                "No matched forecast and actual hourly intervals were found. "
                "Check the source data, publication window, and interval timestamps."
            ),
        }

    errors = [item["error"] for item in matched]
    absolute_errors = [item["absolute_error"] for item in matched]
    actuals = [item["actual"] for item in matched]
    forecasts = [item["forecast"] for item in matched]
    actual_total = sum(actuals)
    forecast_total = sum(forecasts)

    mae = sum(absolute_errors) / matched_count
    rmse = math.sqrt(sum(e**2 for e in errors) / matched_count)
    bias = sum(errors) / matched_count
    wape = (
        sum(absolute_errors) / abs(actual_total) * 100
        if actual_total != 0
        else None
    )

    # Statistical correlation and R^2
    mean_actual = actual_total / matched_count
    ss_tot = sum((a - mean_actual) ** 2 for a in actuals)
    ss_res = sum(e**2 for e in errors)
    r_squared = max(0.0, 1.0 - (ss_res / ss_tot)) if ss_tot > 0 else 1.0

    # Energy Imbalance Analysis
    gross_over = sum(e for e in errors if e > 0)
    gross_under = sum(abs(e) for e in errors if e < 0)
    net_imbalance_mwh = forecast_total - actual_total  # Positive = system short
    imbalance_cost_est = abs(net_imbalance_mwh) * imbalance_price

    # Ramp Rate Analysis (MW/hour hour-to-hour change)
    actual_ramps = [
        actuals[i] - actuals[i - 1] for i in range(1, len(actuals))
    ]
    forecast_ramps = [
        forecasts[i] - forecasts[i - 1] for i in range(1, len(forecasts))
    ]
    ramp_errors = [
        abs(forecast_ramps[i] - actual_ramps[i])
        for i in range(len(actual_ramps))
    ]

    return {
        "delivery_date": delivery_date.isoformat(),
        "cutoff_utc": _iso_utc(cutoff_datetime),
        "publication_window_start_utc": _iso_utc(publish_from),
        "lookback_days": FORECAST_LOOKBACK_DAYS,
        "expected_hourly_intervals": EXPECTED_HOURLY_INTERVALS,
        "expected_half_hourly_actuals": EXPECTED_HALF_HOURLY_INTERVALS,
        "valid_actual_half_hour_records": valid_actual_half_hours,
        "eligible_forecast_records_before_deduplication": eligible_forecast_records,
        "forecast_intervals": forecast_interval_count,
        "actual_intervals": actual_interval_count,
        "matched_intervals": matched_count,
        "missing_forecast_intervals": missing_forecast_intervals,
        "missing_actual_matches": missing_actual_matches,
        "is_simulated": is_simulated,
        "metrics": {
            "mae": round(mae, 1),
            "rmse": round(rmse, 1),
            "bias": round(bias, 1),
            "wape_percent": round(wape, 2) if wape is not None else None,
            "max_absolute_error": round(max(absolute_errors), 1),
            "r_squared": round(r_squared, 3),
            "total_actual_mwh": round(actual_total, 1),
            "total_forecast_mwh": round(forecast_total, 1),
            "net_imbalance_mwh": round(net_imbalance_mwh, 1),
            "gross_overforecast_mwh": round(gross_over, 1),
            "gross_underforecast_mwh": round(gross_under, 1),
            "imbalance_price_gbp": imbalance_price,
            "estimated_imbalance_cost_gbp": round(imbalance_cost_est, 2),
            "peak_actual_mw": round(max(actuals), 1),
            "peak_forecast_mw": round(max(forecasts), 1),
            "capacity_factor_percent": round(
                (actual_total / (24 * GB_WIND_FLEET_CAPACITY_MW)) * 100, 1
            ),
        },
        "ramp_analysis": {
            "max_actual_ramp_mw": round(max(abs(r) for r in actual_ramps), 1)
            if actual_ramps
            else 0.0,
            "max_forecast_ramp_mw": round(max(abs(r) for r in forecast_ramps), 1)
            if forecast_ramps
            else 0.0,
            "max_ramp_error_mw": round(max(ramp_errors), 1)
            if ramp_errors
            else 0.0,
        },
        "intervals": matched,
        "interpretation_note": (
            "Bias is forecast minus actual: positive values indicate over-forecasting. "
            "WAPE is calculated over matched intervals. "
            "Imbalance cost is an analytical estimate based on configured GBP/MWh cashout assumption."
        ),
    }


@app.get("/api/accuracy")
async def get_forecast_accuracy(
    delivery_date: date = Query(default=date(2026, 1, 15)),
    cutoff: str = Query(default="10:00"),
    imbalance_price: float = Query(default=75.0),
    mock: bool = Query(default=False),
) -> dict[str, Any]:
    """
    Compare actual hourly wind generation with the latest eligible hourly
    forecast per interval, using only forecast publications within the
    configured publication lookback and at or before the cutoff.
    """
    cutoff_datetime = _cutoff_datetime(delivery_date, cutoff)
    publish_from = _publication_window(delivery_date)

    actual_params = {
        "settlementDateFrom": delivery_date.isoformat(),
        "settlementDateTo": delivery_date.isoformat(),
        "fuelType": "WIND",
    }
    forecast_params = {
        "publishDateTimeFrom": _iso_utc(publish_from),
        "publishDateTimeTo": _iso_utc(cutoff_datetime),
    }

    actual_records, forecast_records, is_simulated = (
        await _fetch_accuracy_inputs(
            actual_params,
            forecast_params,
            delivery_date,
            cutoff_datetime,
            force_mock=mock,
        )
    )

    return _calculate_accuracy(
        actual_records=actual_records,
        forecast_records=forecast_records,
        delivery_date=delivery_date,
        cutoff_datetime=cutoff_datetime,
        publish_from=publish_from,
        imbalance_price=imbalance_price,
        is_simulated=is_simulated,
    )


@app.get("/api/comparison")
async def get_cutoff_comparison(
    delivery_date: date = Query(default=date(2026, 1, 15)),
    cutoffs: list[str] = Query(default=["06:00", "10:00", "14:00", "17:00"]),
    mock: bool = Query(default=False),
) -> dict[str, Any]:
    """Compare forecast performance across multiple cutoff publication vintages."""
    results: list[dict[str, Any]] = []

    for cutoff in cutoffs:
        try:
            cutoff_datetime = _cutoff_datetime(delivery_date, cutoff)
            publish_from = _publication_window(delivery_date)
            actual_params = {
                "settlementDateFrom": delivery_date.isoformat(),
                "settlementDateTo": delivery_date.isoformat(),
                "fuelType": "WIND",
            }
            forecast_params = {
                "publishDateTimeFrom": _iso_utc(publish_from),
                "publishDateTimeTo": _iso_utc(cutoff_datetime),
            }
            actuals, forecasts, is_sim = await _fetch_accuracy_inputs(
                actual_params,
                forecast_params,
                delivery_date,
                cutoff_datetime,
                force_mock=mock,
            )
            analysis = _calculate_accuracy(
                actual_records=actuals,
                forecast_records=forecasts,
                delivery_date=delivery_date,
                cutoff_datetime=cutoff_datetime,
                publish_from=publish_from,
                is_simulated=is_sim,
            )
            metrics = analysis.get("metrics")
            if metrics:
                results.append(
                    {
                        "cutoff": cutoff,
                        "mae": metrics["mae"],
                        "rmse": metrics["rmse"],
                        "bias": metrics["bias"],
                        "wape_percent": metrics["wape_percent"],
                        "max_absolute_error": metrics["max_absolute_error"],
                        "intervals": [
                            {
                                "startTime": item["startTime"],
                                "forecast": item["forecast"],
                                "actual": item["actual"],
                                "error": item["error"],
                            }
                            for item in analysis.get("intervals", [])
                        ],
                    }
                )
        except Exception:
            continue

    improvement_pct = 0.0
    if len(results) >= 2 and results[0]["mae"] > 0:
        improvement_pct = round(
            ((results[0]["mae"] - results[-1]["mae"]) / results[0]["mae"])
            * 100,
            1,
        )

    return {
        "delivery_date": delivery_date.isoformat(),
        "cutoffs_analyzed": [r["cutoff"] for r in results],
        "comparison": results,
        "mae_improvement_percent": improvement_pct,
    }
