
from datetime import date, datetime, time, timedelta, timezone

import httpx
import math
from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware

app = FastAPI(
    title="WindDesk API",
    description="GB wind generation forecast analysis",
    version="0.1.0",
)

# Allow the local React frontend to call this backend.
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5174",
        "http://127.0.0.1:5173",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

ELEXON_BASE_URL = "https://data.elexon.co.uk/bmrs/api/v1/datasets"


@app.get("/")
def home():
    return {
        "app": "WindDesk",
        "message": "WindDesk API is running",
    }


@app.get("/api/health")
def health():
    return {"status": "ok"}


@app.get("/api/actuals")
async def get_actual_wind(
    start_date: date = Query(default=date(2026, 1, 1)),
    end_date: date = Query(default=date(2026, 1, 31)),
):
    """Fetch actual GB wind generation from Elexon."""

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

    url = f"{ELEXON_BASE_URL}/FUELHH/stream"

    try:
        async with httpx.AsyncClient(timeout=60.0) as client:
            response = await client.get(url, params=params)
            response.raise_for_status()
            data = response.json()

    except httpx.HTTPStatusError as exc:
        raise HTTPException(
            status_code=502,
            detail=(
                "Elexon rejected the request. "
                f"Upstream status: {exc.response.status_code}"
            ),
        ) from exc

    except httpx.RequestError as exc:
        raise HTTPException(
            status_code=502,
            detail="Could not connect to the Elexon API.",
        ) from exc

    except ValueError as exc:
        raise HTTPException(
            status_code=502,
            detail="Elexon returned invalid JSON.",
        ) from exc

    if isinstance(data, list):
        records = data
    elif isinstance(data, dict):
        # Some API responses may wrap records in an object.
        records = data.get("data", [])
    else:
        records = []

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
):
    """
    Retrieve wind forecasts published before the day-ahead cutoff
    for a selected delivery date.

    The 10:00 UTC cutoff is a configurable initial assumption.
    It must be verified against the relevant market timetable.
    """

    try:
        cutoff_time = datetime.strptime(cutoff, "%H:%M").time()
    except ValueError as exc:
        raise HTTPException(
            status_code=400,
            detail="cutoff must use HH:MM format, e.g. 10:00",
        ) from exc

    # Forecasts must be available before the delivery day.
    cutoff_datetime = datetime.combine(
        delivery_date - timedelta(days=1),
        cutoff_time,
        tzinfo=timezone.utc,
    )

    # Retrieve a window of forecast publications before the cutoff.
    publish_from = datetime.combine(
        delivery_date - timedelta(days=2),
        time.min,
        tzinfo=timezone.utc,
    )

    params = {
        "publishDateTimeFrom": publish_from.isoformat(
            timespec="seconds"
        ).replace("+00:00", "Z"),
        "publishDateTimeTo": cutoff_datetime.isoformat(
            timespec="seconds"
        ).replace("+00:00", "Z"),
    }

    url = f"{ELEXON_BASE_URL}/WINDFOR/stream"

    try:
        async with httpx.AsyncClient(timeout=60.0) as client:
            response = await client.get(url, params=params)
            response.raise_for_status()
            data = response.json()

    except httpx.HTTPStatusError as exc:
        raise HTTPException(
            status_code=502,
            detail=(
                "Elexon rejected the forecast request. "
                f"Upstream status: {exc.response.status_code}"
            ),
        ) from exc

    except httpx.RequestError as exc:
        raise HTTPException(
            status_code=502,
            detail="Could not connect to the Elexon forecast API.",
        ) from exc

    except ValueError as exc:
        raise HTTPException(
            status_code=502,
            detail="Elexon returned invalid forecast JSON.",
        ) from exc

    if isinstance(data, list):
        records = data
    elif isinstance(data, dict):
        records = data.get("data", [])
    else:
        records = []

    # Keep only forecasts for the requested delivery date
    # that were published no later than the cutoff.
    eligible_records = []

    for record in records:
        start_time = record.get("startTime")
        publish_time = record.get("publishTime")

        if not start_time or not publish_time:
            continue

        try:
            delivery_start = datetime.fromisoformat(
                start_time.replace("Z", "+00:00")
            )
            published_at = datetime.fromisoformat(
                publish_time.replace("Z", "+00:00")
            )
        except (ValueError, AttributeError):
            continue

        if delivery_start.date() != delivery_date:
            continue

        if published_at.tzinfo is None:
            published_at = published_at.replace(
                tzinfo=timezone.utc
            )

        if published_at <= cutoff_datetime:
            eligible_records.append(record)

    eligible_records.sort(
        key=lambda record: (
            record.get("startTime", ""),
            record.get("publishTime", ""),
        )
    )

    return {
        "source": "Elexon BMRS WINDFOR",
        "delivery_date": delivery_date.isoformat(),
        "cutoff_utc": cutoff_datetime.isoformat(),
        "publication_window_start_utc": publish_from.isoformat(),
        "record_count": len(eligible_records),
        "records": eligible_records,
    }

@app.get("/api/accuracy")
async def get_forecast_accuracy(
    delivery_date: date = Query(default=date(2026, 1, 15)),
    cutoff: str = Query(default="10:00"),
):
    """Compare the latest eligible forecasts with actual generation."""

    try:
        cutoff_time = datetime.strptime(cutoff, "%H:%M").time()
    except ValueError as exc:
        raise HTTPException(
            status_code=400,
            detail="cutoff must use HH:MM format, e.g. 10:00",
        ) from exc

    cutoff_datetime = datetime.combine(
        delivery_date - timedelta(days=1),
        cutoff_time,
        tzinfo=timezone.utc,
    )

    publish_from = datetime.combine(
        delivery_date - timedelta(days=2),
        time.min,
        tzinfo=timezone.utc,
    )

    actual_params = {
        "settlementDateFrom": delivery_date.isoformat(),
        "settlementDateTo": delivery_date.isoformat(),
        "fuelType": "WIND",
    }

    forecast_params = {
        "publishDateTimeFrom": publish_from.isoformat(
            timespec="seconds"
        ).replace("+00:00", "Z"),
        "publishDateTimeTo": cutoff_datetime.isoformat(
            timespec="seconds"
        ).replace("+00:00", "Z"),
    }

    try:
        async with httpx.AsyncClient(timeout=60.0) as client:
            actual_response = await client.get(
                f"{ELEXON_BASE_URL}/FUELHH/stream",
                params=actual_params,
            )
            actual_response.raise_for_status()

            forecast_response = await client.get(
                f"{ELEXON_BASE_URL}/WINDFOR/stream",
                params=forecast_params,
            )
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

    def extract_records(data):
        if isinstance(data, list):
            return data
        if isinstance(data, dict):
            return data.get("data", [])
        return []

    actual_records = extract_records(actual_data)
    forecast_records = extract_records(forecast_data)

    def parse_timestamp(value):
        if not value:
            return None

        try:
            parsed = datetime.fromisoformat(
                value.replace("Z", "+00:00")
            )

            if parsed.tzinfo is None:
                parsed = parsed.replace(tzinfo=timezone.utc)

            return parsed.astimezone(timezone.utc)

        except (ValueError, AttributeError):
            return None

    # Aggregate half-hourly actuals into hourly averages
    # to match the hourly WINDFOR forecast intervals.
    actual_values_by_hour = {}

    for record in actual_records:
        interval = parse_timestamp(record.get("startTime"))
        generation = record.get("generation")

        if interval is None or generation is None:
            continue

        if interval.date() != delivery_date:
            continue

        try:
            generation = float(generation)
        except (ValueError, TypeError):
            continue

        hour_start = interval.replace(
            minute=0,
            second=0,
            microsecond=0,
        )

        actual_values_by_hour.setdefault(
            hour_start, []
        ).append(generation)

    # Average the available half-hourly observations per hour.
    actual_by_interval = {
        hour: sum(values) / len(values)
        for hour, values in actual_values_by_hour.items()
        if values
    }

    # Select the latest forecast vintage available by the cutoff.
    latest_forecast_by_interval = {}

    for record in forecast_records:
        interval = parse_timestamp(record.get("startTime"))
        published = parse_timestamp(record.get("publishTime"))
        generation = record.get("generation")

        if interval is None or published is None:
            continue

        if interval.date() != delivery_date:
            continue

        if published > cutoff_datetime:
            continue

        if generation is None:
            continue

        try:
            generation = float(generation)
        except (ValueError, TypeError):
            continue

        previous = latest_forecast_by_interval.get(interval)

        if previous is None or published > previous["published_at"]:
            latest_forecast_by_interval[interval] = {
                "published_at": published,
                "forecast": generation,
            }

    # Match forecast and actual values for each interval.
    matched = []

    for interval, forecast_record in sorted(
        latest_forecast_by_interval.items()
    ):
        if interval not in actual_by_interval:
            continue

        forecast = forecast_record["forecast"]
        actual = actual_by_interval[interval]
        error = forecast - actual

        matched.append({
            "startTime": interval.isoformat().replace("+00:00", "Z"),
            "publishTime": forecast_record[
                "published_at"
            ].isoformat().replace("+00:00", "Z"),
            "forecast": forecast,
            "actual": actual,
            "error": error,
            "absolute_error": abs(error),
        })

    if not matched:
        return {
            "delivery_date": delivery_date.isoformat(),
            "cutoff_utc": cutoff_datetime.isoformat(),
            "message": (
                "No matched forecast and actual intervals were found. "
                "Check API coverage and the publication window."
            ),
            "forecast_intervals": len(latest_forecast_by_interval),
            "actual_intervals": len(actual_by_interval),
            "matched_intervals": 0,
            "metrics": None,
            "intervals": [],
        }

    errors = [item["error"] for item in matched]
    absolute_errors = [abs(error) for error in errors]
    actual_total = sum(item["actual"] for item in matched)

    mae = sum(absolute_errors) / len(matched)
    rmse = math.sqrt(
        sum(error ** 2 for error in errors) / len(matched)
    )
    bias = sum(errors) / len(matched)

    wape = (
        sum(absolute_errors) / abs(actual_total) * 100
        if actual_total != 0
        else None
    )

    return {
        "delivery_date": delivery_date.isoformat(),
        "cutoff_utc": cutoff_datetime.isoformat(),
        "forecast_intervals": len(latest_forecast_by_interval),
        "actual_intervals": len(actual_by_interval),
        "matched_intervals": len(matched),
        "missing_forecast_intervals": max(
            0, 24 - len(latest_forecast_by_interval)
        ),
        "missing_actual_matches": (
            len(latest_forecast_by_interval) - len(matched)
        ),
        "metrics": {
            "mae": round(mae, 2),
            "rmse": round(rmse, 2),
            "bias": round(bias, 2),
            "wape_percent": (
                round(wape, 2) if wape is not None else None
            ),
        },
        "intervals": matched,
    }

