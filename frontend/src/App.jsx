
import { useEffect, useState } from "react";
import {
  Activity,
  AlertCircle,
  ArrowDownRight,
  ArrowUpRight,
  CalendarDays,
  CheckCircle2,
  RefreshCw,
  Wind,
  Zap,
} from "lucide-react";
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import "./index.css";

const API_URL =
  import.meta.env.VITE_API_URL || "http://127.0.0.1:8001";

function formatNumber(value, digits = 1) {
  if (value == null || !Number.isFinite(Number(value))) return "—";

  return Number(value).toLocaleString("en-GB", {
    maximumFractionDigits: digits,
    minimumFractionDigits: digits,
  });
}

function MetricCard({ label, value, suffix, description, icon: Icon }) {
  return (
    <article className="metric-card">
      <div className="metric-top">
        <span>{label}</span>
        <span className="metric-icon"><Icon size={19} /></span>
      </div>
      <div className="metric-value">
        {value}
        {suffix && <span className="metric-suffix">{suffix}</span>}
      </div>
      <p>{description}</p>
    </article>
  );
}

export default function App() {
  const [deliveryDate, setDeliveryDate] = useState("2026-01-15");
  const [cutoff, setCutoff] = useState("10:00");
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function loadData() {
    setLoading(true);
    setError("");

    try {
      const params = new URLSearchParams({
        delivery_date: deliveryDate,
        cutoff,
      });

      const response = await fetch(
        `${API_URL}/api/accuracy?${params.toString()}`
      );

      if (!response.ok) {
        throw new Error(`Backend request failed (${response.status})`);
      }

      const result = await response.json();

      if (!result.metrics || !result.intervals?.length) {
        throw new Error(
          result.message || "No matched forecast data is available."
        );
      }

      setData(result);
    } catch (err) {
      setData(null);
      setError(
        `${err.message}. Check that your FastAPI backend is running.`
      );
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadData();
  }, []);

  const intervals = data?.intervals ?? [];
  const metrics = data?.metrics;

  const chartData = intervals.map((item) => ({
    time: new Date(item.startTime).toLocaleTimeString("en-GB", {
      hour: "2-digit",
      minute: "2-digit",
      timeZone: "UTC",
    }),
    forecast: item.forecast,
    actual: item.actual,
    error: item.error,
  }));

  const meanForecast = intervals.length
    ? intervals.reduce((sum, item) => sum + item.forecast, 0) /
      intervals.length
    : null;

  const meanActual = intervals.length
    ? intervals.reduce((sum, item) => sum + item.actual, 0) /
      intervals.length
    : null;

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <a className="brand" href="#overview">
          <span className="brand-mark"><Wind size={23} /></span>
          <span>wind<span className="brand-light">desk</span></span>
        </a>

        <p className="nav-heading">WORKSPACE</p>
        <a className="nav-link active" href="#overview">
          <Activity size={18} /> Forecast overview
        </a>
        <a className="nav-link" href="#accuracy">
          <Zap size={18} /> Accuracy analysis
        </a>
        <a className="nav-link" href="#intervals">
          <CalendarDays size={18} /> Hourly intervals
        </a>

        <div className="sidebar-bottom">
          <span className="status-dot" />
          <span>Live API connection</span>
          <small>Local environment</small>
        </div>
      </aside>

      <section className="main-content" id="overview">
        <header className="topbar">
          <div>
            <p className="eyebrow">GB ELECTRICITY · WIND GENERATION</p>
            <h1>Forecast intelligence</h1>
            <p className="subtitle">
              Evaluate day-ahead wind forecasts against observed generation.
            </p>
          </div>
          <div className="source-pill">
            <span className="status-dot" /> Elexon BMRS
          </div>
        </header>

        <section className="filter-panel">
          <div className="field">
            <label htmlFor="delivery-date">Delivery date</label>
            <input
              id="delivery-date"
              type="date"
              min="2026-01-01"
              max="2026-01-31"
              value={deliveryDate}
              onChange={(event) => setDeliveryDate(event.target.value)}
            />
          </div>

          <div className="field">
            <label htmlFor="cutoff">Forecast cutoff (UTC)</label>
            <input
              id="cutoff"
              type="time"
              value={cutoff}
              onChange={(event) => setCutoff(event.target.value)}
            />
          </div>

          <button
            className="primary-button"
            onClick={loadData}
            disabled={loading}
          >
            <RefreshCw size={16} className={loading ? "spin" : ""} />
            {loading ? "Loading..." : "Run analysis"}
          </button>
        </section>

        {error && (
          <div className="error-panel">
            <AlertCircle size={19} />
            <span>{error}</span>
          </div>
        )}

        {loading && !data && (
          <div className="loading-panel">Loading forecast analysis…</div>
        )}

        {data && metrics && (
          <>
            <section className="section-heading">
              <div>
                <h2>Day-ahead performance</h2>
                <p>
                  Delivery on {data.delivery_date} · Cutoff{" "}
                  {cutoff} UTC on the previous day
                </p>
              </div>
              <span className="coverage-pill">
                <CheckCircle2 size={15} />
                {data.matched_intervals} matched intervals
              </span>
            </section>

            <section className="metric-grid" id="accuracy">
              <MetricCard
                label="Mean absolute error"
                value={formatNumber(metrics.mae)}
                description="Average absolute forecast error"
                icon={Activity}
              />
              <MetricCard
                label="RMSE"
                value={formatNumber(metrics.rmse)}
                description="Penalizes larger errors"
                icon={Zap}
              />
              <MetricCard
                label="Forecast bias"
                value={`${metrics.bias > 0 ? "+" : ""}${formatNumber(metrics.bias)}`}
                description={
                  metrics.bias > 0
                    ? "Average overforecast"
                    : metrics.bias < 0
                    ? "Average underforecast"
                    : "No average directional bias"
                }
                icon={metrics.bias >= 0 ? ArrowUpRight : ArrowDownRight}
              />
              <MetricCard
                label="WAPE"
                value={formatNumber(metrics.wape_percent)}
                suffix="%"
                description="Absolute error relative to actual generation"
                icon={Wind}
              />
            </section>

            <section className="summary-strip">
              <div>
                <span>Forecast intervals</span>
                <strong>{data.forecast_intervals}</strong>
              </div>
              <div>
                <span>Actual hourly buckets</span>
                <strong>{data.actual_intervals}</strong>
              </div>
              <div>
                <span>Matched intervals</span>
                <strong>{data.matched_intervals}</strong>
              </div>
              <div>
                <span>Missing forecasts</span>
                <strong>{data.missing_forecast_intervals}</strong>
              </div>
            </section>

            <section className="panel chart-panel">
              <div className="panel-header">
                <div>
                  <h2>Forecast vs actual generation</h2>
                  <p>Hourly delivery intervals · timestamps in UTC</p>
                </div>
                <span className="unit-label">API-reported units</span>
              </div>

              <div className="chart-wrap">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart
                    data={chartData}
                    margin={{ top: 12, right: 15, left: 5, bottom: 5 }}
                  >
                    <CartesianGrid
                      stroke="#e9edf3"
                      strokeDasharray="4 4"
                      vertical={false}
                    />
                    <XAxis
                      dataKey="time"
                      tick={{ fill: "#778197", fontSize: 11 }}
                      tickLine={false}
                      axisLine={false}
                      interval={3}
                    />
                    <YAxis
                      tick={{ fill: "#778197", fontSize: 11 }}
                      tickLine={false}
                      axisLine={false}
                      width={58}
                      tickFormatter={(value) =>
                        `${(value / 1000).toFixed(0)}k`
                      }
                      domain={["auto", "auto"]}
                    />
                    <Tooltip
                      contentStyle={{
                        borderRadius: 12,
                        border: "1px solid #e6eaf0",
                        fontSize: 12,
                      }}
                      formatter={(value, name) => [
                        formatNumber(value),
                        name === "forecast" ? "Forecast" : "Actual",
                      ]}
                      labelFormatter={(label) => `${label} UTC`}
                    />
                    <Legend
                      verticalAlign="top"
                      align="right"
                      iconType="circle"
                      wrapperStyle={{ fontSize: 12, paddingBottom: 16 }}
                      formatter={(value) =>
                        value === "forecast" ? "Forecast" : "Actual"
                      }
                    />
                    <Line
                      type="monotone"
                      dataKey="forecast"
                      stroke="#5478f5"
                      strokeWidth={2.5}
                      dot={false}
                      activeDot={{ r: 5 }}
                    />
                    <Line
                      type="monotone"
                      dataKey="actual"
                      stroke="#16a085"
                      strokeWidth={2.5}
                      dot={false}
                      activeDot={{ r: 5 }}
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>

              <div className="chart-insight">
                <div>
                  <span>Mean forecast</span>
                  <strong>{formatNumber(meanForecast)}</strong>
                </div>
                <div>
                  <span>Mean actual</span>
                  <strong>{formatNumber(meanActual)}</strong>
                </div>
                <div>
                  <span>Mean difference</span>
                  <strong className={metrics.bias >= 0 ? "positive" : "negative"}>
                    {metrics.bias > 0 ? "+" : ""}
                    {formatNumber(metrics.bias)}
                  </strong>
                </div>
              </div>
            </section>

            <section className="panel table-panel" id="intervals">
              <div className="panel-header">
                <div>
                  <h2>Hourly interval details</h2>
                  <p>
                    Selected forecast publication and corresponding actual
                    generation
                  </p>
                </div>
                <span className="table-count">{intervals.length} rows</span>
              </div>

              <div className="table-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>Delivery (UTC)</th>
                      <th>Published (UTC)</th>
                      <th>Forecast</th>
                      <th>Actual</th>
                      <th>Error</th>
                      <th>Absolute error</th>
                    </tr>
                  </thead>
                  <tbody>
                    {intervals.map((item) => (
                      <tr key={item.startTime}>
                        <td className="time-cell">
                          {new Date(item.startTime).toLocaleTimeString(
                            "en-GB",
                            {
                              hour: "2-digit",
                              minute: "2-digit",
                              timeZone: "UTC",
                            }
                          )}
                        </td>
                        <td>
                          {new Date(item.publishTime).toLocaleString(
                            "en-GB",
                            {
                              day: "2-digit",
                              month: "short",
                              hour: "2-digit",
                              minute: "2-digit",
                              timeZone: "UTC",
                            }
                          )}
                        </td>
                        <td>{formatNumber(item.forecast)}</td>
                        <td>{formatNumber(item.actual)}</td>
                        <td
                          className={
                            item.error > 0
                              ? "positive"
                              : item.error < 0
                              ? "negative"
                              : ""
                          }
                        >
                          {item.error > 0 ? "+" : ""}
                          {formatNumber(item.error)}
                        </td>
                        <td>{formatNumber(item.absolute_error)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>

            <footer className="footnote">
              <AlertCircle size={16} />
              <p>
                The cutoff is currently a configurable assumption, not a
                verified market deadline. Accuracy is calculated only on
                matched intervals. Forecast error alone does not determine
                the utility's total procurement requirement.
              </p>
            </footer>
          </>
        )}
      </section>
    </main>
  );
}
