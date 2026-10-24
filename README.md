# WindDesk — GB Wind Generation Forecast Analysis

## Overview

WindDesk is a data analysis dashboard for exploring Great Britain’s wind generation forecasts and comparing them with actual generation. It uses data from the Elexon BMRS API to help users examine forecast accuracy for January 2026.

The dashboard allows users to select a delivery date and forecast publication cutoff, inspect hourly forecast-versus-actual generation, and review forecast accuracy metrics.

## Features

- Retrieve actual wind generation data from the Elexon BMRS API.
- Retrieve wind generation forecasts using a selected publication cutoff.
- Select the latest eligible forecast for each delivery interval to avoid using information published after the cutoff.
- Compare hourly forecast and actual generation.
- Calculate Mean Absolute Error (MAE), Root Mean Squared Error (RMSE), forecast bias, and Weighted Absolute Percentage Error (WAPE).
- View interval-level results and missing-data counts.

## Technology Stack

**Frontend**
- React
- Vite
- Recharts
- Lucide React

**Backend**
- Python
- FastAPI
- Elexon BMRS API

**Containerization**
- Dockerfiles for frontend and backend
- Docker Compose configuration

## Project Structure

```text
WindDesk/
├── backend/
│   ├── app/
│   │   └── main.py
│   ├── requirements.txt
│   └── Dockerfile
├── frontend/
│   ├── src/
│   ├── package.json
│   ├── Dockerfile
│   └── .dockerignore
├── docker-compose.yml
├── .gitignore
└── README.md
```

## Run Locally

### Backend

Open a terminal in the `backend` directory, create and activate a Python virtual environment if needed, and install the dependencies:

```bash
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8001
```

API documentation:

http://localhost:8001/docs

Health check:

http://localhost:8001/api/health

### Frontend

Open a separate terminal in the `frontend` directory:

```bash
npm install
npm run dev -- --port 5174
```

Open the dashboard at:

http://localhost:5174

Configure `VITE_API_URL` to point to the backend API when running or deploying the frontend.

## Data Source

Elexon BMRS API:

- Actual generation: https://data.elexon.co.uk/bmrs/api/v1/datasets/FUELHH/stream
- Wind generation forecasts: https://data.elexon.co.uk/bmrs/api/v1/datasets/WINDFOR/stream

## Methodology and Limitations

Forecasts are selected according to the chosen publication cutoff. Forecast accuracy metrics are calculated only for matched forecast and actual intervals.

The cutoff is a configurable analytical assumption and should not be interpreted as a confirmed market procurement deadline without further validation. Wind forecast error alone does not determine a utility’s total electricity procurement requirement; demand, prices, other generation, imports, storage, and market arrangements also matter.

Generation units and interval aggregation should be interpreted according to the source dataset definitions.

## Deployment

Deployment URL: To be added.

## AI Tool Usage

AI tools were used to assist with development, debugging, implementation guidance, and documentation. The final code and analysis should be reviewed and validated by the project author.
