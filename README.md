# WindDesk — GB Wind Generation Forecast Analysis & Market Intelligence

> **Live Application Demo:** [https://winddesk-demo.vercel.app](https://winddesk-demo.vercel.app) *(Replace with your deployed Vercel/Render URL)*  
> **API Documentation:** [https://winddesk-api.onrender.com/docs](https://winddesk-api.onrender.com/docs) *(Swagger UI)*

---

## Overview

WindDesk is an energy market intelligence dashboard built to evaluate Great Britain’s national wind generation day-ahead forecasts against actual metered generation. It integrates data from the Elexon BMRS API (FUELHH and WINDFOR streams) for January 2026, enabling power traders, risk analysts, and grid dispatchers to quantify forecast accuracy, monitor lead-time convergence, and calculate financial imbalance (cashout) risk.

---

## File and Directory Structure

```text
blyaoi/
├── backend/
│   ├── app/
│   │   ├── __init__.py           # Package marker
│   │   └── main.py               # FastAPI application with CORS, Elexon endpoints,
│   │                             # simulation fallback, error metrics, and cutoff comparison
│   ├── .dockerignore             # Excludes .venv, __pycache__, and test caches
│   ├── Dockerfile                # Python 3.12 slim container with dynamic $PORT support
│   └── requirements.txt          # Python dependencies (fastapi, uvicorn, httpx, etc.)
│
├── frontend/
│   ├── public/                   # Static public assets (favicons, icons)
│   ├── src/
│   │   ├── assets/               # Brand SVGs and images
│   │   ├── api.js                # Resilient API client with auto-discovery, reverse proxy
│   │   │                         # routing, health pinging, and offline client simulation
│   │   ├── App.jsx               # Main React dashboard: 5 workspace tabs, 4 chart modes,
│   │   │                         # presets, theme switcher, and export tools
│   │   ├── index.css             # Complete design system (light/dark themes, responsive layout)
│   │   └── main.jsx              # React 19 application entrypoint
│   ├── .dockerignore             # Excludes node_modules, dist, and local environment files
│   ├── Dockerfile                # Multi-stage build (Node 22 build -> Nginx Alpine production)
│   ├── nginx.conf                # Nginx configuration: SPA routing (try_files) + internal /api proxy
│   ├── package.json              # NPM dependencies (React 19, Recharts, Lucide React)
│   ├── vercel.json               # Vercel deployment routing configuration
│   └── vite.config.js            # Vite config with dev server port 5174 and reverse proxy
│
├── docker-compose.yml            # Multi-container orchestration (FastAPI + Nginx frontend)
├── .gitignore                    # Git exclusions
└── README.md                     # Project documentation, architecture, and run guide
```

---

## Key Features

- **5 Interactive Workspace Views**:
  - **Forecast Overview**: Executive KPI cards, system imbalance indicator, and interactive charts.
  - **Cutoff Horizons**: Multi-vintage overlay (06:00, 10:00, 14:00, 17:00 Gate Closure) analyzing error reduction over lead time.
  - **Residuals & Analytics**: Hourly error distributions, gross over/under-forecast volume splits, and ramp rate deviations.
  - **Market Imbalance & Cashout Simulator**: Interactive GB System Imbalance Price slider (£30–£220/MWh) calculating financial exposure (£ GBP).
  - **Hourly Intervals**: Sortable table with search, status tags, CSV export, and JSON export.
- **4 Chart Display Modes**: Dual Lines, Hourly Error Delta Bars (color-coded), Uncertainty Area, and Ramp Rate comparison.
- **Resilient Fallback Mode**: Automatically falls back to high-fidelity simulated GB benchmark data if the backend is offline or Elexon upstream is unreachable.
- **Trading Desk Aesthetics**: Dark/Light theme toggle with `localStorage` persistence, and 1-click presets for January 2026 weather events.

---

## How to Start the Application

### Method 1: Local Development (Recommended for Development)

#### 1. Start Backend (FastAPI)
```bash
cd backend

# Windows PowerShell:
.\.venv\Scripts\Activate.ps1
# Linux / macOS:
# source .venv/bin/activate

pip install -r requirements.txt
uvicorn app.main:app --reload --port 8001
```
- API Documentation: [http://localhost:8001/docs](http://localhost:8001/docs)
- Health Check: [http://localhost:8001/api/health](http://localhost:8001/api/health)

#### 2. Start Frontend (Vite + React)
Open a separate terminal:
```bash
cd frontend
npm install
npm run dev
```
Open **[http://localhost:5174](http://localhost:5174)** in your browser.

---

### Method 2: Docker Compose (All-in-One Deployment)

Runs both the backend and Nginx-hosted frontend inside isolated containers:

```bash
docker-compose up --build
```
- Dashboard: [http://localhost:5174](http://localhost:5174)
- Backend Docs: [http://localhost:8001/docs](http://localhost:8001/docs)

---

## Methodology & Elexon BMRS Datasets

- **Actual Metered Generation**: Elexon BMRS `FUELHH` dataset stream (`fuelType=WIND`). Half-hourly observations are aggregated to hourly averages for alignment.
- **Wind Generation Forecasts**: Elexon BMRS `WINDFOR` dataset stream. For each delivery interval, the latest eligible forecast published at or before the selected cutoff time is chosen.
- **Forecast Accuracy Metrics**:
  - **MAE** (Mean Absolute Error): Average magnitude of forecast errors in MW.
  - **RMSE** (Root Mean Squared Error): Quadratic scoring penalizing larger deviations.
  - **Bias**: Mean signed error (`forecast - actual`). Positive = Over-forecasting (Short); Negative = Under-forecasting (Long).
  - **WAPE**: Weighted Absolute Percentage Error relative to total actual generation.
  - **Financial Imbalance Exposure**: Analytical estimate based on net MWh mismatch multiplied by the configured GB System Imbalance Price (£/MWh).
