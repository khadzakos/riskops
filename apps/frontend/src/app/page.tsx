'use client';

import React, { useEffect, useState, useCallback } from 'react';
import { Topbar, PageHead, Pill, ErrorBanner, Skeleton } from '@/components/Shell';
import { LineChart, Sparkline, Donut, type LineSeries } from '@/components/Charts';
import {
  portfolioApi,
  inferenceApi,
  extractMetric,
  groupByMetric,
  type Portfolio,
  type Position,
  type RiskResult,
  type ModelHealthResponse,
} from '@/lib/api';

// ─── KPI Card ─────────────────────────────────────────────────────────────────

function KpiCard({
  label,
  value,
  sub,
  sparkValues,
  color = 'var(--primary)',
  loading,
}: {
  label: string;
  value: string | null;
  sub?: string;
  sparkValues?: number[];
  color?: string;
  loading?: boolean;
}) {
  return (
    <div className="metric-card">
      <div className="metric-label">{label}</div>
      {loading ? (
        <Skeleton height={32} width="60%" />
      ) : value !== null ? (
        <div className="metric-value">{value}</div>
      ) : (
        <div className="metric-value" style={{ color: 'var(--ink-4)', fontSize: 16 }}>—</div>
      )}
      {sub && <div className="metric-sub">{sub}</div>}
      {sparkValues && sparkValues.length > 1 && (
        <Sparkline values={sparkValues} color={color} />
      )}
    </div>
  );
}

// ─── Dashboard Page ───────────────────────────────────────────────────────────

export default function DashboardPage() {
  const [portfolios, setPortfolios] = useState<Portfolio[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [positions, setPositions] = useState<Position[]>([]);
  const [latestRisk, setLatestRisk] = useState<RiskResult[]>([]);
  const [riskHistory, setRiskHistory] = useState<RiskResult[]>([]);
  const [health, setHealth] = useState<ModelHealthResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [riskLoading, setRiskLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [predicting, setPredicting] = useState(false);
  const [predictMsg, setPredictMsg] = useState<string | null>(null);
  // Live predict result — used directly for KPI cards so values show on first load
  const [predictResult, setPredictResult] = useState<{ var: number; cvar: number; volatility: number } | null>(null);

  // Load portfolios + model health on mount
  useEffect(() => {
    Promise.all([portfolioApi.list(), inferenceApi.health()])
      .then(([ps, h]) => {
        setPortfolios(ps);
        setHealth(h);
        if (ps.length > 0) setSelectedId(ps[0].id);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  // Load portfolio-specific data when selection changes
  const loadPortfolioData = useCallback(async (id: number) => {
    setRiskLoading(true);
    try {
      const [pos, latest, history] = await Promise.all([
        portfolioApi.listPositions(id),
        portfolioApi.getLatestRisk(id),
        portfolioApi.getRiskHistory(id, 90),
      ]);
      setPositions(pos);
      setLatestRisk(latest);
      setRiskHistory(history);

      // Auto-compute fresh risk metrics so KPI cards always show values
      try {
        const pred = await inferenceApi.predict({ portfolio_id: id });
        setPredictResult({ var: pred.var, cvar: pred.cvar, volatility: pred.volatility });
      } catch {
        // inference unavailable — KPI cards will fall back to DB snapshot
        setPredictResult(null);
      }
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Ошибка загрузки данных портфеля');
    } finally {
      setRiskLoading(false);
    }
  }, []);

  useEffect(() => {
    if (selectedId !== null) {
      setPredictResult(null); // clear stale values while new data loads
      loadPortfolioData(selectedId);
    }
  }, [selectedId, loadPortfolioData]);

  // Trigger risk recalculation
  const handlePredict = async () => {
    if (!selectedId) return;
    setPredicting(true);
    setPredictMsg(null);
    try {
      const res = await inferenceApi.predict({ portfolio_id: selectedId });
      setPredictResult({ var: res.var, cvar: res.cvar, volatility: res.volatility });
      setPredictMsg(`VaR: ${(res.var * 100).toFixed(2)}% | CVaR: ${(res.cvar * 100).toFixed(2)}% | σ: ${(res.volatility * 100).toFixed(2)}%`);
      // Refresh DB snapshot (history chart, table)
      const [latest, history] = await Promise.all([
        portfolioApi.getLatestRisk(selectedId),
        portfolioApi.getRiskHistory(selectedId, 90),
      ]);
      setLatestRisk(latest);
      setRiskHistory(history);
    } catch (e: unknown) {
      setPredictMsg(e instanceof Error ? `Ошибка: ${e.message}` : 'Ошибка расчёта');
    } finally {
      setPredicting(false);
    }
  };

  // ── Derived data ──────────────────────────────────────────────────────────

  const selectedPortfolio = portfolios.find((p) => p.id === selectedId) ?? null;
  const byMetric = groupByMetric(latestRisk);

  // Prefer live predict response; fall back to DB snapshot
  const varVal = predictResult?.var ?? extractMetric(latestRisk, 'var');
  const cvarVal = predictResult?.cvar ?? extractMetric(latestRisk, 'cvar');
  const volVal = predictResult?.volatility ?? extractMetric(latestRisk, 'volatility');

  // Build sparkline values from history for each metric
  const varHistory = (byMetric['var'] ?? [])
    .sort((a, b) => a.asof_date.localeCompare(b.asof_date))
    .map((r) => r.value);
  const cvarHistory = (byMetric['cvar'] ?? [])
    .sort((a, b) => a.asof_date.localeCompare(b.asof_date))
    .map((r) => r.value);
  const volHistory = (byMetric['volatility'] ?? [])
    .sort((a, b) => a.asof_date.localeCompare(b.asof_date))
    .map((r) => r.value);

  // Build line chart series from risk history
  const historyByMetric = groupByMetric(riskHistory);
  const chartSeries: LineSeries[] = [];

  const varSorted = (historyByMetric['var'] ?? []).sort((a, b) => a.asof_date.localeCompare(b.asof_date));
  const cvarSorted = (historyByMetric['cvar'] ?? []).sort((a, b) => a.asof_date.localeCompare(b.asof_date));

  if (varSorted.length > 0) {
    chartSeries.push({
      name: 'VaR',
      color: 'var(--primary)',
      data: varSorted.map((r) => ({ x: r.asof_date, y: r.value })),
    });
  }
  if (cvarSorted.length > 0) {
    chartSeries.push({
      name: 'CVaR',
      color: 'var(--crit)',
      data: cvarSorted.map((r) => ({ x: r.asof_date, y: r.value })),
    });
  }

  // Donut data from positions
  const COLORS = ['var(--primary)', 'var(--accent)', '#6b8f71', '#c9a96e', '#8b6f47', '#4a6b3e'];
  const donutData = positions.map((p, i) => ({
    label: p.symbol,
    value: Math.abs(p.weight),
    color: COLORS[i % COLORS.length],
  }));

  const formatDate = (d: string) => d.slice(5); // MM-DD

  return (
    <>
      <Topbar crumbs={['RiskOps', 'Дашборд']} />
      <div className="page-content">
        <PageHead
          eyebrow="ОБЗОР ПОРТФЕЛЯ"
          title="Дашборд"
          sub={selectedPortfolio ? `${selectedPortfolio.name} · ${selectedPortfolio.currency}` : 'Выберите портфель'}
        >
          <button className="btn-secondary" onClick={() => selectedId && loadPortfolioData(selectedId)} disabled={riskLoading}>
            {riskLoading ? 'Загрузка…' : 'Обновить'}
          </button>
          <button className="btn-primary" onClick={handlePredict} disabled={predicting || !selectedId}>
            {predicting ? 'Расчёт…' : 'Пересчитать риск'}
          </button>
        </PageHead>

        {error && <ErrorBanner message={error} />}
        {predictMsg && (
          <div className="error-banner" style={{ background: 'var(--good-soft)', borderColor: 'var(--good)', color: 'var(--good)' }}>
            ✓ {predictMsg}
          </div>
        )}

        {/* Portfolio selector */}
        {!loading && portfolios.length > 0 && (
          <div className="row" style={{ gap: 8, marginBottom: 16 }}>
            {portfolios.map((p) => (
              <button
                key={p.id}
                className={selectedId === p.id ? 'btn-primary' : 'btn-secondary'}
                style={{ fontSize: 12 }}
                onClick={() => setSelectedId(p.id)}
              >
                {p.name}
              </button>
            ))}
          </div>
        )}

        {loading ? (
          <div className="grid-4" style={{ marginBottom: 24 }}>
            {[0, 1, 2, 3].map((i) => <Skeleton key={i} height={100} />)}
          </div>
        ) : (
          <>
            {/* KPI strip */}
            <div className="grid-4" style={{ marginBottom: 24 }}>
              <KpiCard
                label="VaR (95%)"
                value={varVal !== null ? `${(varVal * 100).toFixed(2)}%` : null}
                sub={latestRisk[0] ? `${latestRisk[0].method} · ${latestRisk[0].horizon_days}д` : undefined}
                sparkValues={varHistory}
                color="var(--primary)"
                loading={riskLoading}
              />
              <KpiCard
                label="CVaR (95%)"
                value={cvarVal !== null ? `${(cvarVal * 100).toFixed(2)}%` : null}
                sub="Ожидаемые потери"
                sparkValues={cvarHistory}
                color="var(--crit)"
                loading={riskLoading}
              />
              <KpiCard
                label="Волатильность"
                value={volVal !== null ? `${(volVal * 100).toFixed(2)}%` : null}
                sub="Годовая σ"
                sparkValues={volHistory}
                color="var(--accent)"
                loading={riskLoading}
              />
              <KpiCard
                label="Позиций"
                value={positions.length > 0 ? String(positions.length) : null}
                sub={selectedPortfolio?.currency}
                loading={riskLoading}
              />
            </div>

            {/* Model health banner */}
            {health && (
              <div className="row" style={{ gap: 8, marginBottom: 20, alignItems: 'center' }}>
                <span style={{ fontSize: 12, color: 'var(--ink-3)' }}>Модели:</span>
                <Pill variant={health.status === 'ok' ? 'good' : 'warn'}>
                  {health.status === 'ok' ? 'Активны' : health.status}
                </Pill>
                {health.loaded_models.map((m) => (
                  <Pill key={m} variant="primary">{m}</Pill>
                ))}
                {health.fallback_available && (
                  <Pill variant="warn">Fallback доступен</Pill>
                )}
              </div>
            )}

            <div className="grid-2" style={{ gap: 20 }}>
              {/* Risk history chart */}
              <div className="card">
                <div className="card-head">
                  <div className="card-title">История риска</div>
                  {chartSeries.length > 0 && (
                      <div className="row" style={{ gap: 12 }}>
                        {chartSeries.map((s) => (
                          <div key={s.name} className="row" style={{ gap: 6, alignItems: 'center' }}>
                            <div style={{ width: 14, height: 3, background: s.color, borderRadius: 2, flexShrink: 0 }} />
                            <span style={{ fontSize: 11, color: 'var(--ink)', fontFamily: 'var(--mono)', fontWeight: 500 }}>{s.name}</span>
                          </div>
                        ))}
                      </div>
                    )}
                </div>
                {riskLoading ? (
                  <Skeleton height={240} />
                ) : chartSeries.length > 0 ? (
                  <LineChart
                    series={chartSeries}
                    height={240}
                    yFormat={(v) => `${(v * 100).toFixed(1)}%`}
                    xFormat={(v) => formatDate(String(v))}
                    fillArea
                  />
                ) : (
                  <div className="empty-state">Нет данных истории риска</div>
                )}
              </div>

              {/* Positions donut + table */}
              <div className="card">
                <div className="card-head">
                  <div className="card-title">Состав портфеля</div>
                </div>
                {riskLoading ? (
                  <Skeleton height={240} />
                ) : positions.length > 0 ? (
                  <div className="row" style={{ gap: 24, alignItems: 'flex-start' }}>
                    <Donut data={donutData} size={160} />
                    <div style={{ flex: 1 }}>
                      <table className="data-table" style={{ width: '100%' }}>
                        <thead>
                          <tr>
                            <th>Тикер</th>
                            <th style={{ textAlign: 'right' }}>Вес</th>
                          </tr>
                        </thead>
                        <tbody>
                          {positions.map((p, i) => (
                            <tr key={p.symbol}>
                              <td>
                                <div className="row" style={{ gap: 6, alignItems: 'center' }}>
                                  <div style={{ width: 8, height: 8, borderRadius: '50%', background: COLORS[i % COLORS.length] }} />
                                  <span className="mono">{p.symbol}</span>
                                </div>
                              </td>
                              <td style={{ textAlign: 'right' }} className="mono">
                                {(p.weight * 100).toFixed(1)}%
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                ) : (
                  <div className="empty-state">Нет позиций в портфеле</div>
                )}
              </div>
            </div>

            {/* Latest risk results table */}
            {latestRisk.length > 0 && (
              <div className="card" style={{ marginTop: 20 }}>
                <div className="card-head">
                  <div className="card-title">Последние результаты риска</div>
                  {latestRisk[0] && (
                    <span style={{ fontSize: 11, color: 'var(--ink-4)' }}>
                      По состоянию на {latestRisk[0].asof_date}
                    </span>
                  )}
                </div>
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Метрика</th>
                      <th>Метод</th>
                      <th>Горизонт</th>
                      <th>Уровень</th>
                      <th style={{ textAlign: 'right' }}>Значение</th>
                      <th>Версия модели</th>
                    </tr>
                  </thead>
                  <tbody>
                    {latestRisk.map((r) => (
                      <tr key={r.id}>
                        <td><span className="mono" style={{ textTransform: 'uppercase' }}>{r.metric}</span></td>
                        <td>{r.method}</td>
                        <td>{r.horizon_days}д</td>
                        <td>{(r.alpha * 100).toFixed(0)}%</td>
                        <td style={{ textAlign: 'right' }} className="mono">
                          {(r.value * 100).toFixed(3)}%
                        </td>
                        <td className="mono" style={{ fontSize: 11, color: 'var(--ink-4)' }}>{r.model_version}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {portfolios.length === 0 && !loading && (
              <div className="empty-state" style={{ marginTop: 40 }}>
                <div style={{ fontSize: 32, marginBottom: 8 }}>📂</div>
                <div>Нет портфелей. Создайте первый портфель в разделе «Портфель».</div>
              </div>
            )}
          </>
        )}
      </div>
    </>
  );
}
