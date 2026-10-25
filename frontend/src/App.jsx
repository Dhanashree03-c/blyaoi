import { useEffect, useState, useMemo, useCallback } from "react";
import {
  Activity,
  AlertCircle,
  ArrowDownRight,
  ArrowUpRight,
  BarChart3,
  CalendarDays,
  Check,
  Copy,
  Download,
  Flame,
  HelpCircle,
  Layers,
  Moon,
  PieChart,
  RefreshCw,
  Search,
  Settings,
  Sun,
  TrendingDown,
  TrendingUp,
  Wind,
  Zap,
} from "lucide-react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import "./index.css";
import {
  fetchAccuracyData,
  fetchComparisonData,
  pingBackend,
} from "./api";

function formatNumber(value, digits = 1) {
  if (value == null || !Number.isFinite(Number(value))) return "—";
  return Number(value).toLocaleString("en-GB", {
    maximumFractionDigits: digits,
    minimumFractionDigits: digits,
  });
}

function MetricCard({ label, value, suffix, description, icon: Icon, badge, badgeColor }) {
  return (
    <article className="metric-card">
      <div className="metric-top">
        <span>{label}</span>
        <span className="metric-icon">
          <Icon size={18} />
        </span>
      </div>
      <div className="metric-value">
        {value}
        {suffix && <span className="metric-suffix">{suffix}</span>}
      </div>
      <p>{description}</p>
      {badge && <span className={`metric-badge ${badgeColor || "blue"}`}>{badge}</span>}
    </article>
  );
}

const DATE_PRESETS = [
  { label: "Jan 15 (Mid-Month Benchmark)", date: "2026-01-15" },
  { label: "Jan 21 (Storm Isha - High Wind)", date: "2026-01-21" },
  { label: "Jan 08 (Calm Dunkelflaute)", date: "2026-01-08" },
  { label: "Jan 28 (Cold Front Ramp)", date: "2026-01-28" },
];

const CUTOFF_PRESETS = [
  { label: "06:00 (D-2 Evening)", time: "06:00" },
  { label: "10:00 (Day-Ahead Standard)", time: "10:00" },
  { label: "14:00 (Afternoon Update)", time: "14:00" },
  { label: "17:00 (Gate Closure)", time: "17:00" },
];

export default function App() {
  const [activeTab, setActiveTab] = useState("overview");
  const [deliveryDate, setDeliveryDate] = useState("2026-01-15");
  const [cutoff, setCutoff] = useState("10:00");
  const [imbalancePrice, setImbalancePrice] = useState(75.0);
  const [chartMode, setChartMode] = useState("lines"); // 'lines' | 'delta' | 'area' | 'ramps'

  // Data states
  const [data, setData] = useState(null);
  const [comparisonData, setComparisonData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  // Backend connection & modes
  const [forceDemo, setForceDemo] = useState(false);
  const [customApiUrl, setCustomApiUrl] = useState("");
  const [backendStatus, setBackendStatus] = useState({ checked: false, online: false, latency: 0 });
  const [showSettingsModal, setShowSettingsModal] = useState(false);
  const [copiedCode, setCopiedCode] = useState(false);
  const [copiedTable, setCopiedTable] = useState(false);

  // Table filters & sorting
  const [tableFilter, setTableFilter] = useState("all"); // 'all' | 'over' | 'under' | 'high_error'
  const [searchQuery, setSearchQuery] = useState("");
  const [sortField, setSortField] = useState("startTime");
  const [sortAsc, setSortAsc] = useState(true);

  // Dark mode
  const [darkMode, setDarkMode] = useState(() => {
    return localStorage.getItem("winddesk-theme") === "dark";
  });

  useEffect(() => {
    if (darkMode) {
      document.body.classList.add("dark-mode");
      localStorage.setItem("winddesk-theme", "dark");
    } else {
      document.body.classList.remove("dark-mode");
      localStorage.setItem("winddesk-theme", "light");
    }
  }, [darkMode]);

  // Check backend health periodically
  const checkHealth = useCallback(async () => {
    const res = await pingBackend(customApiUrl);
    setBackendStatus({
      checked: true,
      online: res.ok,
      latency: res.latency || 0,
      url: res.url,
    });
  }, [customApiUrl]);

  useEffect(() => {
    let ignore = false;
    const timer = setTimeout(() => {
      if (!ignore) {
        checkHealth();
      }
    }, 0);
    return () => {
      ignore = true;
      clearTimeout(timer);
    };
  }, [checkHealth]);

  // Main data loader
  const loadData = useCallback(async () => {
    setLoading(true);
    setError("");

    try {
      const result = await fetchAccuracyData({
        deliveryDate,
        cutoff,
        imbalancePrice,
        forceDemo,
        customBaseUrl: customApiUrl || null,
      });

      if (!result || !result.metrics || !result.intervals?.length) {
        throw new Error(result?.message || "No matched wind forecast data found.");
      }

      setData(result);

      // Load comparison data concurrently
      fetchComparisonData({
        deliveryDate,
        cutoffs: ["06:00", "10:00", "14:00", "17:00"],
        forceDemo,
        customBaseUrl: customApiUrl || null,
      }).then((compRes) => {
        if (compRes?.comparison) {
          setComparisonData(compRes);
        }
      });
    } catch (err) {
      setError(`${err.message}. Backend might be offline. Try switching to Demo Mode or starting FastAPI.`);
    } finally {
      setLoading(false);
    }
  }, [deliveryDate, cutoff, imbalancePrice, forceDemo, customApiUrl]);

  // Initial load
  useEffect(() => {
    let ignore = false;
    const timer = setTimeout(() => {
      if (!ignore) {
        loadData();
      }
    }, 0);
    return () => {
      ignore = true;
      clearTimeout(timer);
    };
  }, [loadData]);

  const intervals = useMemo(() => data?.intervals ?? [], [data]);
  const metrics = data?.metrics;

  // Prepared chart data
  const chartData = useMemo(() => {
    return intervals.map((item, idx) => {
      const timeStr = new Date(item.startTime).toLocaleTimeString("en-GB", {
        hour: "2-digit",
        minute: "2-digit",
        timeZone: "UTC",
      });

      const prevActual = idx > 0 ? intervals[idx - 1].actual : item.actual;
      const prevForecast = idx > 0 ? intervals[idx - 1].forecast : item.forecast;

      return {
        time: timeStr,
        forecast: item.forecast,
        actual: item.actual,
        error: item.error,
        absError: item.absolute_error,
        actualRamp: idx > 0 ? Math.round((item.actual - prevActual) * 10) / 10 : 0,
        forecastRamp: idx > 0 ? Math.round((item.forecast - prevForecast) * 10) / 10 : 0,
        raw: item,
      };
    });
  }, [intervals]);

  // Prepared comparison chart data (multi-vintage curves)
  const comparisonChartData = useMemo(() => {
    if (!comparisonData?.comparison?.length) return [];
    const vintages = comparisonData.comparison;

    // Collect hours
    const rows = [];
    for (let h = 0; h < 24; h++) {
      const hourStr = `${String(h).padStart(2, "0")}:00`;
      const row = { time: hourStr };

      vintages.forEach((v) => {
        const match = v.intervals[h];
        if (match) {
          row[`cutoff_${v.cutoff}`] = match.forecast;
          if (row.actual == null) {
            row.actual = match.actual;
          }
        }
      });
      rows.push(row);
    }
    return rows;
  }, [comparisonData]);

  // Filtered and sorted intervals for Table
  const filteredIntervals = useMemo(() => {
    let result = [...intervals];

    if (tableFilter === "over") {
      result = result.filter((i) => i.error > 50);
    } else if (tableFilter === "under") {
      result = result.filter((i) => i.error < -50);
    } else if (tableFilter === "high_error") {
      result = result.filter((i) => i.absolute_error >= 750);
    }

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      result = result.filter(
        (i) =>
          i.startTime.toLowerCase().includes(q) ||
          String(i.forecast).includes(q) ||
          String(i.actual).includes(q)
      );
    }

    result.sort((a, b) => {
      let valA = a[sortField];
      let valB = b[sortField];
      if (typeof valA === "string") {
        return sortAsc ? valA.localeCompare(valB) : valB.localeCompare(valA);
      }
      return sortAsc ? valA - valB : valB - valA;
    });

    return result;
  }, [intervals, tableFilter, searchQuery, sortField, sortAsc]);

  const toggleSort = (field) => {
    if (sortField === field) {
      setSortAsc(!sortAsc);
    } else {
      setSortField(field);
      setSortAsc(true);
    }
  };

  // Export CSV
  const exportToCSV = () => {
    if (!intervals.length) return;
    const headers = ["Delivery_UTC", "Published_UTC", "Forecast_MW", "Actual_MW", "Error_MW", "Abs_Error_MW", "Pct_Error"];
    const rows = intervals.map((i) => [
      i.startTime,
      i.publishTime,
      i.forecast,
      i.actual,
      i.error,
      i.absolute_error,
      i.percent_error,
    ]);
    const csvContent = "data:text/csv;charset=utf-8," + [headers.join(","), ...rows.map((r) => r.join(","))].join("\n");
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", `WindDesk_Analysis_${deliveryDate}_Cutoff_${cutoff.replace(":", "")}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // Export JSON
  const exportToJSON = () => {
    if (!data) return;
    const jsonStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(data, null, 2));
    const link = document.createElement("a");
    link.setAttribute("href", jsonStr);
    link.setAttribute("download", `WindDesk_${deliveryDate}.json`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // Copy table text to clipboard
  const copyTableToClipboard = () => {
    if (!intervals.length) return;
    const text = intervals
      .map(
        (i) =>
          `${i.startTime.slice(11, 16)} UTC | Forecast: ${i.forecast} MW | Actual: ${i.actual} MW | Error: ${i.error} MW`
      )
      .join("\n");
    navigator.clipboard.writeText(text).then(() => {
      setCopiedTable(true);
      setTimeout(() => setCopiedTable(false), 2000);
    });
  };

  // Copy CLI command
  const copyCliCommand = () => {
    navigator.clipboard
      .writeText("cd backend && .\\venv\\Scripts\\uvicorn app.main:app --reload --port 8001")
      .then(() => {
        setCopiedCode(true);
        setTimeout(() => setCopiedCode(false), 2000);
      });
  };

  return (
    <div className="app-shell">
      {/* Sidebar Navigation */}
      <aside className="sidebar">
        <a className="brand" href="#overview" onClick={() => setActiveTab("overview")}>
          <span className="brand-mark">
            <Wind size={22} color="white" />
          </span>
          <span>
            wind<span className="brand-light">desk</span>
          </span>
        </a>

        <p className="nav-heading">WORKSPACE</p>
        <nav>
          <button
            className={`nav-link ${activeTab === "overview" ? "active" : ""}`}
            onClick={() => setActiveTab("overview")}
          >
            <Activity size={17} /> Forecast Overview
          </button>
          <button
            className={`nav-link ${activeTab === "comparison" ? "active" : ""}`}
            onClick={() => setActiveTab("comparison")}
          >
            <Layers size={17} /> Cutoff Horizons
            <span className="nav-badge">4 Vintages</span>
          </button>
          <button
            className={`nav-link ${activeTab === "residuals" ? "active" : ""}`}
            onClick={() => setActiveTab("residuals")}
          >
            <BarChart3 size={17} /> Error Residuals
          </button>
          <button
            className={`nav-link ${activeTab === "imbalance" ? "active" : ""}`}
            onClick={() => setActiveTab("imbalance")}
          >
            <Zap size={17} /> Imbalance Exposure
          </button>
          <button
            className={`nav-link ${activeTab === "intervals" ? "active" : ""}`}
            onClick={() => setActiveTab("intervals")}
          >
            <CalendarDays size={17} /> Hourly Intervals
            <span className="nav-badge">{intervals.length}</span>
          </button>
        </nav>

        <div className="sidebar-bottom">
          <div className="status-header">
            <span
              className={`status-dot ${
                forceDemo ? "simulated" : backendStatus.online ? "online" : "offline"
              }`}
            />
            <span>
              {forceDemo
                ? "Simulated Benchmark"
                : backendStatus.online
                ? `API Connected (${backendStatus.latency}ms)`
                : "Backend Offline"}
            </span>
          </div>
          <small>
            {forceDemo
              ? "Running client demo mode"
              : backendStatus.online
              ? "Elexon BMRS Live Connection"
              : "Click Settings to connect"}
          </small>
          <button className="settings-link-btn" onClick={() => setShowSettingsModal(true)}>
            <Settings size={13} /> Connection & Settings
          </button>
        </div>
      </aside>

      {/* Main Content Area */}
      <main className="main-content">
        {/* Topbar */}
        <header className="topbar">
          <div>
            <p className="eyebrow">GB NATIONAL GRID · WIND DISPATCH INTELLIGENCE</p>
            <h1>Forecast Intelligence & Market Imbalance</h1>
            <p className="subtitle">
              Evaluate day-ahead wind power forecasts against metered actual generation from Elexon BMRS.
            </p>
          </div>

          <div className="topbar-actions">
            <button
              className="status-badge"
              onClick={() => setShowSettingsModal(true)}
              title="Click to configure backend or troubleshoot"
            >
              <span
                className={`status-dot ${
                  forceDemo ? "simulated" : backendStatus.online ? "online" : "offline"
                }`}
              />
              <span>
                {forceDemo
                  ? "Demo Mode (Simulated)"
                  : backendStatus.online
                  ? "Live API (8001)"
                  : "Connect Backend"}
              </span>
            </button>

            <button
              className="icon-btn"
              onClick={() => setDarkMode(!darkMode)}
              title={darkMode ? "Switch to Light Mode" : "Switch to Dark Mode"}
            >
              {darkMode ? <Sun size={17} /> : <Moon size={17} />}
            </button>

            <button
              className="icon-btn"
              onClick={() => setShowSettingsModal(true)}
              title="Settings & Help"
            >
              <Settings size={17} />
            </button>
          </div>
        </header>

        {/* Global Filter Bar */}
        <section className="control-bar">
          <div className="filter-row">
            <div className="field">
              <label htmlFor="delivery-date">Delivery Date</label>
              <input
                id="delivery-date"
                type="date"
                min="2026-01-01"
                max="2026-01-31"
                value={deliveryDate}
                onChange={(e) => setDeliveryDate(e.target.value)}
              />
            </div>

            <div className="field">
              <label htmlFor="cutoff">Forecast Cutoff (UTC)</label>
              <input
                id="cutoff"
                type="time"
                value={cutoff}
                onChange={(e) => setCutoff(e.target.value)}
              />
            </div>

            <button className="primary-button" onClick={loadData} disabled={loading}>
              <RefreshCw size={15} className={loading ? "spin" : ""} />
              {loading ? "Calculating..." : "Run Analysis"}
            </button>

            <button
              className="secondary-button"
              onClick={() => {
                setForceDemo(!forceDemo);
              }}
              title="Toggle between Live FastAPI connection and Instant Demo Simulation"
            >
              {forceDemo ? <Zap size={15} /> : <Activity size={15} />}
              {forceDemo ? "Switch to Live API" : "Use Demo Mode"}
            </button>
          </div>

          {/* Quick Date Presets */}
          <div className="presets-strip">
            <span className="preset-label">Date Presets:</span>
            {DATE_PRESETS.map((p) => (
              <button
                key={p.date}
                className={`chip-btn ${deliveryDate === p.date ? "active" : ""}`}
                onClick={() => setDeliveryDate(p.date)}
              >
                {p.label}
              </button>
            ))}
          </div>

          {/* Quick Cutoff Presets */}
          <div className="presets-strip">
            <span className="preset-label">Cutoff Assumptions:</span>
            {CUTOFF_PRESETS.map((p) => (
              <button
                key={p.time}
                className={`chip-btn ${cutoff === p.time ? "active" : ""}`}
                onClick={() => setCutoff(p.time)}
              >
                {p.label}
              </button>
            ))}
          </div>
        </section>

        {/* Error / Backend notification */}
        {error && (
          <div className="notification-banner danger">
            <div className="banner-left">
              <AlertCircle size={18} />
              <span>{error}</span>
            </div>
            <button
              className="banner-action-btn"
              onClick={() => {
                setForceDemo(true);
                setError("");
              }}
            >
              Switch to Offline Demo
            </button>
          </div>
        )}

        {data?.backend_offline && (
          <div className="notification-banner warning">
            <div className="banner-left">
              <AlertCircle size={18} />
              <span>
                <strong>Viewing High-Fidelity Simulated Data:</strong> FastAPI backend was unreachable at port 8001.
              </span>
            </div>
            <button className="banner-action-btn" onClick={() => setShowSettingsModal(true)}>
              Start Backend Guide
            </button>
          </div>
        )}

        {/* =========================================================================
            TAB 1: FORECAST OVERVIEW
        ========================================================================= */}
        {activeTab === "overview" && data && metrics && (
          <>
            {/* System Imbalance Alert Header */}
            <div
              className={`notification-banner ${
                metrics.bias > 300
                  ? "warning"
                  : metrics.bias < -300
                  ? "info"
                  : "info"
              }`}
            >
              <div className="banner-left">
                {metrics.bias > 0 ? (
                  <TrendingUp size={18} />
                ) : (
                  <TrendingDown size={18} />
                )}
                <span>
                  <strong>Trading Desk Imbalance Summary:</strong> Delivery on{" "}
                  <strong>{data.delivery_date}</strong> with cutoff{" "}
                  <strong>{cutoff} UTC</strong>.{" "}
                  {metrics.bias > 0
                    ? `Over-forecasting bias detected (+${formatNumber(metrics.bias)} MW avg). Portfolio was short generation by ${formatNumber(metrics.net_imbalance_mwh)} MWh with estimated imbalance cashout exposure of £${formatNumber(metrics.estimated_imbalance_cost_gbp, 0)}.`
                    : `Under-forecasting bias detected (${formatNumber(metrics.bias)} MW avg). Portfolio generated +${formatNumber(Math.abs(metrics.net_imbalance_mwh))} MWh surplus into the GB grid system.`}
                </span>
              </div>
            </div>

            {/* 6 Key Performance Metric Cards */}
            <section className="metric-grid six-cols">
              <MetricCard
                label="Mean Abs Error (MAE)"
                value={formatNumber(metrics.mae)}
                suffix="MW"
                description="Average absolute generation miss"
                icon={Activity}
                badge={metrics.mae < 600 ? "Optimal" : metrics.mae < 1000 ? "Moderate" : "Elevated Risk"}
                badgeColor={metrics.mae < 600 ? "green" : metrics.mae < 1000 ? "amber" : "blue"}
              />
              <MetricCard
                label="RMSE"
                value={formatNumber(metrics.rmse)}
                suffix="MW"
                description="Quadratic penalty for extreme swings"
                icon={Zap}
              />
              <MetricCard
                label="Forecast Bias"
                value={`${metrics.bias > 0 ? "+" : ""}${formatNumber(metrics.bias)}`}
                suffix="MW"
                description={metrics.bias > 0 ? "Net over-forecast (short)" : "Net under-forecast (long)"}
                icon={metrics.bias >= 0 ? ArrowUpRight : ArrowDownRight}
                badge={metrics.bias > 0 ? "System Short" : "System Long"}
                badgeColor={metrics.bias > 0 ? "amber" : "green"}
              />
              <MetricCard
                label="WAPE Error"
                value={formatNumber(metrics.wape_percent)}
                suffix="%"
                description="Volume-weighted percentage error"
                icon={PieChart}
              />
              <MetricCard
                label="Total Energy (MWh)"
                value={formatNumber(metrics.total_actual_mwh, 0)}
                suffix="MWh"
                description={`Forecasted: ${formatNumber(metrics.total_forecast_mwh, 0)} MWh`}
                icon={Flame}
              />
              <MetricCard
                label="Capacity Factor"
                value={formatNumber(metrics.capacity_factor_percent)}
                suffix="%"
                description="Fleet utilization (~30 GW fleet)"
                icon={Wind}
                badge={metrics.capacity_factor_percent > 45 ? "High Wind" : "Light Wind"}
                badgeColor={metrics.capacity_factor_percent > 45 ? "green" : "blue"}
              />
            </section>

            {/* Main Interactive Chart Panel */}
            <section className="panel">
              <div className="panel-header">
                <div>
                  <h2>Hourly Wind Generation & Uncertainty Profile</h2>
                  <p>All delivery intervals in UTC · Elexon FUELHH actuals vs WINDFOR latest vintage</p>
                </div>

                <div className="chart-mode-toggles">
                  <button
                    className={`chart-mode-btn ${chartMode === "lines" ? "active" : ""}`}
                    onClick={() => setChartMode("lines")}
                  >
                    Dual Lines
                  </button>
                  <button
                    className={`chart-mode-btn ${chartMode === "delta" ? "active" : ""}`}
                    onClick={() => setChartMode("delta")}
                  >
                    Error Delta (MW)
                  </button>
                  <button
                    className={`chart-mode-btn ${chartMode === "area" ? "active" : ""}`}
                    onClick={() => setChartMode("area")}
                  >
                    Uncertainty Area
                  </button>
                  <button
                    className={`chart-mode-btn ${chartMode === "ramps" ? "active" : ""}`}
                    onClick={() => setChartMode("ramps")}
                  >
                    Ramp Rates
                  </button>
                </div>
              </div>

              <div className="chart-wrap">
                <ResponsiveContainer width="100%" height="100%">
                  {chartMode === "lines" ? (
                    <LineChart data={chartData} margin={{ top: 12, right: 20, left: 10, bottom: 5 }}>
                      <CartesianGrid stroke={darkMode ? "#1e293b" : "#e9edf3"} strokeDasharray="3 3" vertical={false} />
                      <XAxis dataKey="time" tick={{ fill: "#64748b", fontSize: 11 }} tickLine={false} axisLine={false} />
                      <YAxis
                        tick={{ fill: "#64748b", fontSize: 11 }}
                        tickLine={false}
                        axisLine={false}
                        tickFormatter={(v) => `${(v / 1000).toFixed(0)}k MW`}
                        domain={["auto", "auto"]}
                      />
                      <Tooltip
                        contentStyle={{
                          backgroundColor: darkMode ? "#101827" : "#ffffff",
                          borderColor: darkMode ? "#1e293b" : "#e2e8f0",
                          borderRadius: 10,
                          fontSize: 12,
                          color: darkMode ? "#f1f5f9" : "#0f172a",
                        }}
                        formatter={(val, name) => [
                          `${formatNumber(val)} MW`,
                          name === "forecast" ? "Forecast (Cutoff Vintage)" : "Metered Actual",
                        ]}
                        labelFormatter={(lbl) => `${lbl} UTC`}
                      />
                      <Legend verticalAlign="top" align="right" wrapperStyle={{ fontSize: 12, paddingBottom: 16 }} />
                      <Line
                        type="monotone"
                        dataKey="forecast"
                        name="Forecast (Cutoff)"
                        stroke="#3b82f6"
                        strokeWidth={2.8}
                        dot={false}
                        activeDot={{ r: 6 }}
                      />
                      <Line
                        type="monotone"
                        dataKey="actual"
                        name="Metered Actual"
                        stroke="#10b981"
                        strokeWidth={2.8}
                        dot={false}
                        activeDot={{ r: 6 }}
                      />
                    </LineChart>
                  ) : chartMode === "delta" ? (
                    <BarChart data={chartData} margin={{ top: 12, right: 20, left: 10, bottom: 5 }}>
                      <CartesianGrid stroke={darkMode ? "#1e293b" : "#e9edf3"} strokeDasharray="3 3" vertical={false} />
                      <XAxis dataKey="time" tick={{ fill: "#64748b", fontSize: 11 }} tickLine={false} axisLine={false} />
                      <YAxis
                        tick={{ fill: "#64748b", fontSize: 11 }}
                        tickLine={false}
                        axisLine={false}
                        tickFormatter={(v) => `${v > 0 ? "+" : ""}${v} MW`}
                      />
                      <ReferenceLine y={0} stroke={darkMode ? "#475569" : "#94a3b8"} />
                      <Tooltip
                        contentStyle={{
                          backgroundColor: darkMode ? "#101827" : "#ffffff",
                          borderColor: darkMode ? "#1e293b" : "#e2e8f0",
                          borderRadius: 10,
                          fontSize: 12,
                        }}
                        formatter={(val) => [
                          `${val > 0 ? "+" : ""}${formatNumber(val)} MW`,
                          val > 0 ? "Over-forecast (Short)" : "Under-forecast (Long)",
                        ]}
                      />
                      <Bar dataKey="error" radius={[4, 4, 0, 0]}>
                        {chartData.map((entry, index) => (
                          <Cell
                            key={`cell-${index}`}
                            fill={entry.error > 0 ? "#ef4444" : "#10b981"}
                          />
                        ))}
                      </Bar>
                    </BarChart>
                  ) : chartMode === "area" ? (
                    <AreaChart data={chartData} margin={{ top: 12, right: 20, left: 10, bottom: 5 }}>
                      <CartesianGrid stroke={darkMode ? "#1e293b" : "#e9edf3"} strokeDasharray="3 3" vertical={false} />
                      <XAxis dataKey="time" tick={{ fill: "#64748b", fontSize: 11 }} tickLine={false} />
                      <YAxis tick={{ fill: "#64748b", fontSize: 11 }} tickLine={false} tickFormatter={(v) => `${v} MW`} />
                      <Tooltip
                        contentStyle={{
                          backgroundColor: darkMode ? "#101827" : "#ffffff",
                          borderColor: darkMode ? "#1e293b" : "#e2e8f0",
                          borderRadius: 10,
                        }}
                        formatter={(val) => [`${formatNumber(val)} MW`, "Absolute Error"]}
                      />
                      <Area
                        type="monotone"
                        dataKey="absError"
                        name="Absolute Error (MW)"
                        stroke="#f59e0b"
                        fill="#f59e0b"
                        fillOpacity={0.25}
                      />
                    </AreaChart>
                  ) : (
                    <LineChart data={chartData} margin={{ top: 12, right: 20, left: 10, bottom: 5 }}>
                      <CartesianGrid stroke={darkMode ? "#1e293b" : "#e9edf3"} strokeDasharray="3 3" vertical={false} />
                      <XAxis dataKey="time" tick={{ fill: "#64748b", fontSize: 11 }} tickLine={false} />
                      <YAxis tick={{ fill: "#64748b", fontSize: 11 }} tickLine={false} tickFormatter={(v) => `${v} MW/h`} />
                      <ReferenceLine y={0} stroke="#94a3b8" />
                      <Tooltip
                        contentStyle={{
                          backgroundColor: darkMode ? "#101827" : "#ffffff",
                          borderColor: darkMode ? "#1e293b" : "#e2e8f0",
                          borderRadius: 10,
                        }}
                      />
                      <Legend verticalAlign="top" align="right" />
                      <Line type="monotone" dataKey="forecastRamp" name="Forecast Ramp (MW/h)" stroke="#3b82f6" strokeWidth={2} dot={false} />
                      <Line type="monotone" dataKey="actualRamp" name="Actual Ramp (MW/h)" stroke="#10b981" strokeWidth={2} dot={false} />
                    </LineChart>
                  )}
                </ResponsiveContainer>
              </div>

              {/* Chart Insights Strip */}
              <div className="chart-insight">
                <div>
                  <span>Peak Actual Wind</span>
                  <strong>{formatNumber(metrics.peak_actual_mw)} MW</strong>
                </div>
                <div>
                  <span>Max Absolute Error</span>
                  <strong>{formatNumber(metrics.max_absolute_error)} MW</strong>
                </div>
                <div>
                  <span>Max Hourly Ramp</span>
                  <strong>{formatNumber(data.ramp_analysis?.max_actual_ramp_mw)} MW/h</strong>
                </div>
                <div>
                  <span>Model Fit (R²)</span>
                  <strong>{metrics.r_squared}</strong>
                </div>
              </div>
            </section>
          </>
        )}

        {/* =========================================================================
            TAB 2: CUTOFF HORIZONS (LEAD-TIME COMPARISON)
        ========================================================================= */}
        {activeTab === "comparison" && comparisonData && (
          <section className="panel">
            <div className="panel-header">
              <div>
                <h2>Forecast Horizon Sensitivity & Convergence Analysis</h2>
                <p>
                  Track how Great Britain wind forecasts converge toward metered delivery as publication cutoff advances from D-2 to Gate Closure (17:00).
                </p>
              </div>
              {comparisonData.mae_improvement_percent > 0 && (
                <span className="coverage-pill" style={{ background: "var(--success-bg)", color: "var(--success-text)", padding: "6px 12px", borderRadius: 20, fontSize: 12, fontWeight: 700 }}>
                  <TrendingDown size={14} style={{ display: "inline", marginRight: 4 }} />
                  {comparisonData.mae_improvement_percent}% Error Reduction to Gate Closure
                </span>
              )}
            </div>

            {/* Comparison Cards Grid */}
            <div className="comparison-card-grid">
              {comparisonData.comparison.map((c) => (
                <div key={c.cutoff} className="comparison-card">
                  <h3>Cutoff {c.cutoff} UTC</h3>
                  <div>
                    <span style={{ fontSize: 11, color: "var(--text-muted)" }}>MAE: </span>
                    <strong style={{ fontSize: 18, color: "var(--text-main)" }}>{formatNumber(c.mae)} MW</strong>
                  </div>
                  <div>
                    <span style={{ fontSize: 11, color: "var(--text-muted)" }}>WAPE: </span>
                    <strong>{formatNumber(c.wape_percent)}%</strong>
                  </div>
                  <div>
                    <span style={{ fontSize: 11, color: "var(--text-muted)" }}>Bias: </span>
                    <strong className={c.bias >= 0 ? "negative" : "positive"}>
                      {c.bias > 0 ? "+" : ""}{formatNumber(c.bias)} MW
                    </strong>
                  </div>
                </div>
              ))}
            </div>

            {/* Multi-vintage Overlay Line Chart */}
            <div className="chart-wrap" style={{ height: 420 }}>
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={comparisonChartData} margin={{ top: 12, right: 20, left: 10, bottom: 5 }}>
                  <CartesianGrid stroke={darkMode ? "#1e293b" : "#e9edf3"} strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="time" tick={{ fill: "#64748b", fontSize: 11 }} />
                  <YAxis tick={{ fill: "#64748b", fontSize: 11 }} tickFormatter={(v) => `${(v / 1000).toFixed(0)}k MW`} />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: darkMode ? "#101827" : "#ffffff",
                      borderColor: darkMode ? "#1e293b" : "#e2e8f0",
                      borderRadius: 10,
                      fontSize: 12,
                    }}
                  />
                  <Legend verticalAlign="top" align="right" />
                  <Line type="monotone" dataKey="actual" name="Actual Generation" stroke="#10b981" strokeWidth={3.5} dot={false} />
                  <Line type="monotone" dataKey="cutoff_06:00" name="06:00 Cutoff (D-2)" stroke="#94a3b8" strokeDasharray="5 5" strokeWidth={1.8} dot={false} />
                  <Line type="monotone" dataKey="cutoff_10:00" name="10:00 Cutoff (D-1 Day-Ahead)" stroke="#3b82f6" strokeWidth={2.2} dot={false} />
                  <Line type="monotone" dataKey="cutoff_14:00" name="14:00 Cutoff (Afternoon)" stroke="#8b5cf6" strokeWidth={2.2} dot={false} />
                  <Line type="monotone" dataKey="cutoff_17:00" name="17:00 Cutoff (Gate Closure)" stroke="#f59e0b" strokeWidth={2.5} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </section>
        )}

        {/* =========================================================================
            TAB 3: RESIDUALS & DISTRIBUTION
        ========================================================================= */}
        {activeTab === "residuals" && data && metrics && (
          <section className="panel">
            <div className="panel-header">
              <div>
                <h2>Forecast Residuals & Uncertainty Distribution</h2>
                <p>Examine directional bias, residual clustering, and error accumulation over the delivery period.</p>
              </div>
            </div>

            <div className="chart-wrap" style={{ height: 350 }}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chartData} margin={{ top: 12, right: 20, left: 10, bottom: 5 }}>
                  <CartesianGrid stroke={darkMode ? "#1e293b" : "#e9edf3"} strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="time" tick={{ fill: "#64748b", fontSize: 11 }} />
                  <YAxis tick={{ fill: "#64748b", fontSize: 11 }} tickFormatter={(v) => `${v} MW`} />
                  <ReferenceLine y={0} stroke="#94a3b8" />
                  <ReferenceLine y={metrics.bias} stroke="#f59e0b" strokeDasharray="4 4" label={{ value: `Mean Bias (${metrics.bias} MW)`, fill: "#f59e0b", fontSize: 11 }} />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: darkMode ? "#101827" : "#ffffff",
                      borderColor: darkMode ? "#1e293b" : "#e2e8f0",
                      borderRadius: 10,
                    }}
                    formatter={(v) => [`${formatNumber(v)} MW`, "Residual"]}
                  />
                  <Bar dataKey="error">
                    {chartData.map((entry, index) => (
                      <Cell key={`res-${index}`} fill={entry.error > 0 ? "#ef4444" : "#10b981"} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>

            <div className="summary-strip" style={{ marginTop: 24 }}>
              <div>
                <span>Gross Over-Forecast Volume</span>
                <strong className="negative">+{formatNumber(metrics.gross_overforecast_mwh)} MWh</strong>
              </div>
              <div>
                <span>Gross Under-Forecast Volume</span>
                <strong className="positive">-{formatNumber(metrics.gross_underforecast_mwh)} MWh</strong>
              </div>
              <div>
                <span>Net Energy Imbalance</span>
                <strong>{formatNumber(metrics.net_imbalance_mwh)} MWh</strong>
              </div>
              <div>
                <span>Max Ramp Prediction Error</span>
                <strong>{formatNumber(data.ramp_analysis?.max_ramp_error_mw)} MW/h</strong>
              </div>
            </div>
          </section>
        )}

        {/* =========================================================================
            TAB 4: MARKET IMBALANCE & FINANCIAL EXPOSURE
        ========================================================================= */}
        {activeTab === "imbalance" && data && metrics && (
          <section className="panel">
            <div className="panel-header">
              <div>
                <h2>Elexon Cashout & Financial Imbalance Calculator</h2>
                <p>Simulate portfolio exposure to GB System Buy/Sell Prices (Cashout) based on wind forecast error.</p>
              </div>
            </div>

            <div className="imbalance-grid">
              <div className="imbalance-slider-box">
                <h3>Cashout Price Assumption</h3>
                <p style={{ fontSize: 12.5, color: "var(--text-muted)", margin: "4px 0 16px" }}>
                  The GB System Imbalance Price varies each half-hour settlement period based on balancing market actions.
                </p>

                <div className="slider-group">
                  <label>
                    <span>Average Cashout Price:</span>
                    <strong style={{ fontFamily: "var(--font-mono)", color: "var(--primary)" }}>£{imbalancePrice.toFixed(0)} / MWh</strong>
                  </label>
                  <input
                    type="range"
                    min="30"
                    max="220"
                    step="5"
                    value={imbalancePrice}
                    onChange={(e) => setImbalancePrice(Number(e.target.value))}
                    className="slider-input"
                  />
                </div>

                <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
                  {[50, 75, 110, 160].map((price) => (
                    <button
                      key={price}
                      className={`chip-btn ${imbalancePrice === price ? "active" : ""}`}
                      onClick={() => setImbalancePrice(price)}
                    >
                      £{price}/MWh
                    </button>
                  ))}
                </div>
              </div>

              <div className="imbalance-breakdown">
                <div className="imbalance-row">
                  <span>Gross Energy Imbalance Exposure</span>
                  <strong>{formatNumber(Math.abs(metrics.net_imbalance_mwh))} MWh</strong>
                </div>
                <div className="imbalance-row">
                  <span>Portfolio Imbalance Direction</span>
                  <strong className={metrics.net_imbalance_mwh > 0 ? "negative" : "positive"}>
                    {metrics.net_imbalance_mwh > 0 ? "Short Generation (Deficit)" : "Long Generation (Surplus)"}
                  </strong>
                </div>
                <div className="imbalance-row" style={{ background: "var(--primary-light)", borderColor: "var(--primary)" }}>
                  <span style={{ fontWeight: 600 }}>Estimated Imbalance Cashout Value</span>
                  <strong style={{ fontSize: 19, color: "var(--primary)" }}>
                    £{formatNumber(Math.abs(metrics.net_imbalance_mwh) * imbalancePrice, 2)}
                  </strong>
                </div>
              </div>
            </div>

            <div className="footnote" style={{ marginTop: 24 }}>
              <HelpCircle size={17} />
              <p>
                <strong>Methodology:</strong> Imbalance exposure is calculated as the net MWh difference between day-ahead forecast scheduling and actual delivered generation. In the GB market, being short generation during high system demand can incur punitive System Buy Prices.
              </p>
            </div>
          </section>
        )}

        {/* =========================================================================
            TAB 5: HOURLY INTERVALS & DATA EXPORT
        ========================================================================= */}
        {activeTab === "intervals" && data && (
          <section className="panel">
            <div className="panel-header">
              <div>
                <h2>Hourly Settlement Interval Registry</h2>
                <p>Complete 24-hour delivery record with matched forecast vintages and errors.</p>
              </div>

              <div className="table-actions">
                <button className="action-btn" onClick={exportToCSV}>
                  <Download size={14} /> Export CSV
                </button>
                <button className="action-btn" onClick={exportToJSON}>
                  <Download size={14} /> Export JSON
                </button>
                <button className="action-btn" onClick={copyTableToClipboard}>
                  {copiedTable ? <Check size={14} color="#10b981" /> : <Copy size={14} />}
                  {copiedTable ? "Copied!" : "Copy Table"}
                </button>
              </div>
            </div>

            {/* Table Search & Filters */}
            <div className="table-controls">
              <div className="filter-pills">
                <button
                  className={`filter-pill ${tableFilter === "all" ? "active" : ""}`}
                  onClick={() => setTableFilter("all")}
                >
                  All ({intervals.length})
                </button>
                <button
                  className={`filter-pill ${tableFilter === "over" ? "active" : ""}`}
                  onClick={() => setTableFilter("over")}
                >
                  Over-forecasts
                </button>
                <button
                  className={`filter-pill ${tableFilter === "under" ? "active" : ""}`}
                  onClick={() => setTableFilter("under")}
                >
                  Under-forecasts
                </button>
                <button
                  className={`filter-pill ${tableFilter === "high_error" ? "active" : ""}`}
                  onClick={() => setTableFilter("high_error")}
                >
                  High Deviation (&gt;750 MW)
                </button>
              </div>

              <div style={{ position: "relative" }}>
                <input
                  type="text"
                  placeholder="Search time or MW..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  style={{
                    height: 34,
                    padding: "0 10px 0 32px",
                    borderRadius: 6,
                    border: "1px solid var(--border-color)",
                    background: "var(--bg-surface-alt)",
                    color: "var(--text-main)",
                    fontSize: 12.5,
                  }}
                />
                <Search size={14} style={{ position: "absolute", left: 10, top: 10, color: "var(--text-muted)" }} />
              </div>
            </div>

            {/* Scrollable Table */}
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th onClick={() => toggleSort("startTime")}>Delivery (UTC) {sortField === "startTime" && (sortAsc ? "↑" : "↓")}</th>
                    <th onClick={() => toggleSort("publishTime")}>Published Cutoff {sortField === "publishTime" && (sortAsc ? "↑" : "↓")}</th>
                    <th onClick={() => toggleSort("forecast")}>Forecast (MW) {sortField === "forecast" && (sortAsc ? "↑" : "↓")}</th>
                    <th onClick={() => toggleSort("actual")}>Actual (MW) {sortField === "actual" && (sortAsc ? "↑" : "↓")}</th>
                    <th onClick={() => toggleSort("error")}>Error (MW) {sortField === "error" && (sortAsc ? "↑" : "↓")}</th>
                    <th onClick={() => toggleSort("absolute_error")}>Abs Error {sortField === "absolute_error" && (sortAsc ? "↑" : "↓")}</th>
                    <th onClick={() => toggleSort("percent_error")}>% Error {sortField === "percent_error" && (sortAsc ? "↑" : "↓")}</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredIntervals.map((item) => (
                    <tr key={item.startTime}>
                      <td className="time-cell">
                        {new Date(item.startTime).toLocaleTimeString("en-GB", {
                          hour: "2-digit",
                          minute: "2-digit",
                          timeZone: "UTC",
                        })}
                      </td>
                      <td style={{ fontSize: 12, color: "var(--text-muted)" }}>
                        {new Date(item.publishTime).toLocaleString("en-GB", {
                          day: "2-digit",
                          month: "short",
                          hour: "2-digit",
                          minute: "2-digit",
                          timeZone: "UTC",
                        })}
                      </td>
                      <td>{formatNumber(item.forecast)}</td>
                      <td>{formatNumber(item.actual)}</td>
                      <td className={item.error > 0 ? "negative" : item.error < 0 ? "positive" : ""}>
                        {item.error > 0 ? "+" : ""}
                        {formatNumber(item.error)}
                      </td>
                      <td>{formatNumber(item.absolute_error)}</td>
                      <td>{formatNumber(item.percent_error)}%</td>
                      <td>
                        <span className={`status-tag ${item.status}`}>
                          {item.status === "over" ? "Over (+)" : item.status === "under" ? "Under (-)" : "Aligned"}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}

        {/* Global Footnote */}
        <footer className="footnote">
          <AlertCircle size={16} />
          <p>
            Forecast data retrieved from Elexon BMRS WINDFOR and FUELHH streams. Cutoffs are configurable analytical assumptions. Forecast error alone does not determine total utility balancing actions; demand, interconnectors, storage, and thermal dispatch are also key factors.
          </p>
        </footer>
      </main>

      {/* =========================================================================
          SETTINGS & TROUBLESHOOTING MODAL
      ========================================================================= */}
      {showSettingsModal && (
        <div className="modal-overlay" onClick={() => setShowSettingsModal(false)}>
          <div className="modal-dialog" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2>Backend Connection & Settings</h2>
              <button className="close-btn" onClick={() => setShowSettingsModal(false)}>
                ✕
              </button>
            </div>

            <p style={{ fontSize: 13, color: "var(--text-secondary)", marginTop: 0 }}>
              WindDesk connects to a local or remote FastAPI backend. If the backend is not running, you can explore using built-in Simulation Demo Mode or launch the backend using the command below.
            </p>

            <div style={{ background: "var(--bg-surface-alt)", padding: "14px 18px", borderRadius: 10, margin: "16px 0", border: "1px solid var(--border-color)" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                <span style={{ fontSize: 12, fontWeight: 700 }}>Connection Status</span>
                <span className={`status-dot ${backendStatus.online ? "online" : "offline"}`} />
              </div>
              <div style={{ fontSize: 13, fontWeight: 600 }}>
                {backendStatus.online ? `Connected (${backendStatus.latency}ms latency)` : "FastAPI Backend is Offline"}
              </div>
            </div>

            <div className="field" style={{ marginBottom: 16 }}>
              <label>Custom Backend API URL</label>
              <div style={{ display: "flex", gap: 8 }}>
                <input
                  type="text"
                  placeholder="e.g. http://127.0.0.1:8001 or relative /api"
                  value={customApiUrl}
                  onChange={(e) => setCustomApiUrl(e.target.value)}
                  style={{ flex: 1 }}
                />
                <button className="secondary-button" onClick={checkHealth}>
                  Ping
                </button>
              </div>
            </div>

            <div style={{ marginTop: 20 }}>
              <span style={{ fontSize: 12, fontWeight: 700 }}>To run FastAPI backend locally:</span>
              <div className="code-box">
                <code>cd backend && .\venv\Scripts\uvicorn app.main:app --reload --port 8001</code>
                <button className="copy-mini-btn" onClick={copyCliCommand}>
                  {copiedCode ? "Copied!" : "Copy"}
                </button>
              </div>
            </div>

            <div style={{ display: "flex", gap: 10, marginTop: 24, justifyContent: "flex-end" }}>
              <button
                className="secondary-button"
                onClick={() => {
                  setForceDemo(!forceDemo);
                  setShowSettingsModal(false);
                  loadData();
                }}
              >
                {forceDemo ? "Switch to Live API" : "Toggle Demo Mode"}
              </button>
              <button
                className="primary-button"
                onClick={() => {
                  setShowSettingsModal(false);
                  loadData();
                }}
              >
                Apply & Reload
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
