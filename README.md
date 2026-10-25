# WindDesk — GB Wind Generation Forecast Analysis & Market Intelligence

## Overview

WindDesk is a professional data analysis and trading dispatch dashboard for exploring Great Britain’s national wind generation forecasts and comparing them with actual metered generation. It integrates data from the Elexon BMRS API (FUELHH and WINDFOR streams) for January 2026, offering energy market participants, utilities, and analysts deep visibility into day-ahead forecast accuracy and financial imbalance exposure.

## Key Features

- **Automated Upstream Connection & Proxy**: Seamless Vite proxy routing (`/api`) eliminating cross-origin (CORS) errors in local development and container deployments.
- **Resilient Fallback & Offline Simulation**: Automatically falls back to high-fidelity simulated GB benchmark data if the backend is offline or Elexon upstream is unreachable.
- **Comprehensive Accuracy Metrics**: Mean Absolute Error (MAE), Root Mean Squared Error (RMSE), Forecast Directional Bias, Weighted Absolute Percentage Error (WAPE), Model Fit ($R^2$), and Maximum Absolute Deviation.
- **Multi-Cutoff Horizon Analysis**: Compare 4 forecast publication vintages (06:00 D-2, 10:00 Day-Ahead, 14:00 Afternoon, 17:00 Gate Closure) to observe forecast convergence as delivery approaches.
- **Market Imbalance & Financial Exposure**: Calculate net MWh surplus/deficit, gross over/under-generation, and simulate GBP (£) cashout settlement risk with an interactive System Imbalance Price slider.
- **Interactive Multi-View Charts**:
  - Dual line profile (Forecast vs Actual with smooth curves)
  - Hourly error delta bar chart (positive/negative color coded)
  - Absolute error uncertainty area envelope
  - Hour-over-hour ramp rate comparison
- **Hourly Interval Registry & Export**:
  - Searchable and filterable 24-hour interval table (filter by Over-forecast, Under-forecast, or High Deviation)
  - One-click **Export to CSV** and **Export to JSON**
  - One-click copy table to clipboard
- **Trading Desk Aesthetics**: Dark/Light mode theme toggle, date presets (Storm Surge, Dunkelflaute, Cold Front), and connection diagnostic modal.

---

## Technology Stack

**Frontend**
- React 19
- Vite 6/8 with reverse proxy
- Recharts
- Lucide React

**Backend**
- Python 3.11+
- FastAPI & Starlette
- Uvicorn (ASGI)
- HTTPX async client
- Elexon BMRS API

**Containerization**
- Docker & Docker Compose

---

## Run Locally

### 1. Run Backend (FastAPI)

Open a terminal in the `backend` directory:

```bash
cd backend
# Activate virtual environment if available:
# Windows PowerShell:
.\.venv\Scripts\Activate.ps1

# Install requirements
pip install -r requirements.txt

# Start backend on port 8001
uvicorn app.main:app --reload --port 8001
```

- API Docs: [http://localhost:8001/docs](http://localhost:8001/docs)
- Health Check: [http://localhost:8001/api/health](http://localhost:8001/api/health)

### 2. Run Frontend (Vite)

Open a separate terminal in the `frontend` directory:

```bash
cd frontend
npm install
npm run dev
```

Open your browser at:
**[http://localhost:5174](http://localhost:5174)**

> **Note on Vite Proxy:** The Vite development server automatically proxies all `/api/*` requests directly to `http://127.0.0.1:8001`. You can configure a different backend via `VITE_API_URL` or directly in the UI via the topbar Connection Settings modal.

---

## Docker Compose

To run the entire stack (FastAPI backend + Nginx-hosted React frontend) via Docker:

```bash
docker-compose up --build
```

Dashboard will be accessible at `http://localhost:5174`.

---

## Data Sources

- **Actual Metered Generation**: Elexon BMRS `FUELHH` dataset stream (`fuelType=WIND`)
- **Wind Forecasts**: Elexon BMRS `WINDFOR` dataset stream
