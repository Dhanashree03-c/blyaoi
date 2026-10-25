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
    description="GB wind generation forecast analysis",
    version="0.2.0",
)

# Set CORS_ORIGINS on the hosting platform to a comma-separated list of
# frontend origins, e.g. https://your-app.vercel.app
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
    allow_origins=cors_origins or DEFAULT_CORS_ORIGINS,
    allow_credentials=False,
    allow_methods=["GET"],
    allow_headers=["*"],
)

ELEXON_BASE_URL = "https://data.elexon.co.uk/bmrs/api/v1/datasets"
HTTP_TIMEOUT_SECONDS = 60.0
FORECAST_LOOKBACK_DAYS = max(1, int(os.getenv("FORECAST_LOOKBACK_DAYS", "2")))
EXPECTED_HOURLY_INTERVALS = 24
EXPECTED_HALF_HOURLY_INTERVALS = 48


@app.get("/")
def home() -> dict[str, str]:
    return {
        "app": "WindDesk",
        "message": "WindDesk API is running",
    }


@app.get("/api/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


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
        # Treat naive source timestamps as UTC; source data should ideally
        # include an explicit timezone.
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

    # strptime can accept some non-zero-padded forms; enforce HH:MM strictly.
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
    # Keep the existing two-day lookback so the request remains reasonably
    # small. The response exposes this window: older vintages are not searched.
    return datetime.combine(
        delivery_date - timedelta(days=FORECAST_LOOKBACK_DAYS),
        time.min,
        tzinfo=timezone.utc,
    )


async def _get_elexon_records(
    dataset: str, params: dict[str, str]
) -> list[dict[str, Any]]:
    url = f"{ELEXON_BASE_URL}/{dataset}/stream"
    try:
        async with httpx.AsyncClient(timeout=HTTP_TIMEOUT_SECONDS) as client:
            response = await client.get(url, params=params)
            response.raise_for_status()
            data = response.json()
    except httpx.HTTPStatusError as exc:
        raise HTTPException(
            status_code=502,
            detail=(
                f"Elexon returned HTTP {exc.response.status_code} "
                f"for dataset {dataset}."
            ),
        ) from exc
    except httpx.RequestError as exc:
        raise HTTPException(
            status_code=502,
            detail=f"Could not connect to Elexon dataset {dataset}.",
        ) from exc
    except ValueError as exc:
        raise HTTPException(
            status_code=502,
            detail=f"Elexon returned invalid JSON for dataset {dataset}.",
        ) from exc

    return _extract_records(data)


def _iso_utc(value: datetime) -> str:
    return value.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")


@app.get("/api/actuals")
async def get_actual_wind(
    start_date: date = Query(default=date(2026, 1, 1)),
    end_date: date = Query(default=date(2026, 1, 31)),
) -> dict[str, Any]:
    """Fetch actual GB wind generation from Elexon's FUELHH dataset."""
    if start_date > end_date:
        raise HTTPException(
            status_code=400,
            detail="start_date must not be after end_date",
        )

    params = {
        "settlementDateFrom": start_date.isoformat(),
        "settlementDateTo": end_date.isoformat(),
        "fuelType": "WIND",
    }
    records = await _get_elexon_records("FUELHH", params)

    return {
        "source": "Elexon BMRS FUELHH",
        "fuel_type": "WIND",
        "start_date": start_date.isoformat(),
        "end_date": end_date.isoformat(),
        "record_count": len(records),
        "records": records,
    }


@app.get("/api/forecasts")
async def get_wind_forecasts(
    delivery_date: date = Query(default=date(2026, 1, 15)),
    cutoff: str = Query(default="10:00"),
) -> dict[str, Any]:
    """
    Return eligible WINDFOR records for a delivery date.

    The cutoff is interpreted as UTC on the day before delivery. The 10:00
    default is a configurable assumption, not a verified market deadline.
    This endpoint returns eligible vintages; it does not collapse them to one
    record per delivery interval.
    """
    cutoff_datetime = _cutoff_datetime(delivery_date, cutoff)
    publish_from = _publication_window(delivery_date)
    params = {
        "publishDateTimeFrom": _iso_utc(publish_from),
        "publishDateTimeTo": _iso_utc(cutoff_datetime),
    }
    records = await _get_elexon_records("WINDFOR", params)

    eligible_records: list[dict[str, Any]] = []
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
            _parse_timestamp(record.get("startTime")) or datetime.min.replace(tzinfo=timezone.utc),
            _parse_timestamp(record.get("publishTime")) or datetime.min.replace(tzinfo=timezone.utc),
        )
    )

    return {
        "source": "Elexon BMRS WINDFOR",
        "delivery_date": delivery_date.isoformat(),
        "cutoff_utc": _iso_utc(cutoff_datetime),
        "publication_window_start_utc": _iso_utc(publish_from),
        "lookback_days": FORECAST_LOOKBACK_DAYS,
        "record_count": len(eligible_records),
        "records": eligible_records,
        "note": (
            "Records include multiple eligible forecast vintages. "
            "Use /api/accuracy for the latest eligible vintage per interval."
        ),
    }


@app.get("/api/accuracy")
async def get_forecast_accuracy(
    delivery_date: date = Query(default=date(2026, 1, 15)),
    cutoff: str = Query(default="10:00"),
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

    # Fetch both datasets using the same HTTP/error-handling path.
    actual_records, forecast_records = await _fetch_accuracy_inputs(
        actual_params, forecast_params
    )

    # FUELHH contains half-hourly actual observations. WINDFOR is treated as
    # hourly for this dashboard, so average the two half-hour values in each
    # UTC hour. Do not silently use a partial hour if one half-hour is absent.
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
        # Require both distinct half-hour observations for a full hourly value.
        if len(observations) == 2:
            actual_by_interval[hour_start] = sum(observations.values()) / 2

    # Select exactly one eligible forecast vintage per delivery interval:
    # the record with the greatest publishTime that is <= cutoff_datetime.
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
        if previous is None or published > previous["published_at"]:
            latest_forecast_by_interval[interval] = {
                "published_at": published,
                "forecast": generation,
            }

    matched: list[dict[str, Any]] = []
    for interval, forecast_record in sorted(latest_forecast_by_interval.items()):
        if interval not in actual_by_interval:
            continue

        forecast = forecast_record["forecast"]
        actual = actual_by_interval[interval]
        error = forecast - actual
        matched.append(
            {
                "startTime": _iso_utc(interval),
                "publishTime": _iso_utc(forecast_record["published_at"]),
                "forecast": forecast,
                "actual": actual,
                "error": error,
                "absolute_error": abs(error),
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
            "message": (
                "No matched forecast and actual hourly intervals were found. "
                "Check the source data, publication window, and interval timestamps."
            ),
        }

    errors = [item["error"] for item in matched]
    absolute_errors = [abs(error) for error in errors]
    actual_total = sum(item["actual"] for item in matched)

    mae = sum(absolute_errors) / matched_count
    rmse = math.sqrt(sum(error**2 for error in errors) / matched_count)
    bias = sum(errors) / matched_count
    wape = (
        sum(absolute_errors) / abs(actual_total) * 100
        if actual_total != 0
        else None
    )

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
        "metrics": {
            "mae": round(mae, 2),
            "rmse": round(rmse, 2),
            "bias": round(bias, 2),
            "wape_percent": round(wape, 2) if wape is not None else None,
        },
        "intervals": matched,
        "interpretation_note": (
            "Bias is forecast minus actual: positive values indicate "
            "over-forecasting. WAPE is calculated over matched intervals only. "
            "Wind forecast error alone is not total electricity procurement need."
        ),
    }


async def _fetch_accuracy_inputs(
    actual_params: dict[str, str],
    forecast_params: dict[str, str],
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    """Fetch actual and forecast records concurrently."""
    async with httpx.AsyncClient(timeout=HTTP_TIMEOUT_SECONDS) as client:
        try:
            actual_response, forecast_response = await _request_both(
                client, actual_params, forecast_params
            )
            actual_response.raise_for_status()
            forecast_response.raise_for_status()
            actual_data = actual_response.json()
            forecast_data = forecast_response.json()
        except httpx.HTTPStatusError as exc:
            raise HTTPException(
                status_code=502,
                detail=(
                    "Elexon returned an error. "
                    f"Upstream status: {exc.response.status_code}"
                ),
            ) from exc
        except httpx.RequestError as exc:
            raise HTTPException(
                status_code=502,
                detail="Could not retrieve data from Elexon.",
            ) from exc
        except ValueError as exc:
            raise HTTPException(
                status_code=502,
                detail="Elexon returned invalid JSON.",
            ) from exc

    return _extract_records(actual_data), _extract_records(forecast_data)


async def _request_both(
    client: httpx.AsyncClient,
    actual_params: dict[str, str],
    forecast_params: dict[str, str],
) -> tuple[httpx.Response, httpx.Response]:
    """Issue the two requests concurrently to reduce endpoint latency."""
    import asyncio

    actual_task = client.get(
        f"{ELEXON_BASE_URL}/FUELHH/stream", params=actual_params
    )
    forecast_task = client.get(
        f"{ELEXON_BASE_URL}/WINDFOR/stream", params=forecast_params
    )
    return tuple(await asyncio.gather(actual_task, forecast_task))  # type: ignore[return-value]
