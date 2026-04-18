'use client';

import React, { useEffect, useState, useCallback } from 'react';
import { Topbar, PageHead, Pill, ErrorBanner, Skeleton } from '@/components/Shell';
import { LineChart, type LineSeries } from '@/components/Charts';
import { portfolioApi, groupByMetric, type Portfolio, type RiskResult } from '@/lib/api';

export default function BacktestPage() {
  const [portfolios, setPortfolios] = useState<Portfolio[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [riskHistory, setRiskHistory] = useState<RiskResult[]>([]);
  const [loading, setLoading] = useState(true);
  const [dataLoading, setDataLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    portfolioApi.list()
      .then((ps) => {
        setPortfolios(ps);
        if (ps.length > 0) setSelectedId(ps[0].id);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  const loadHistory = useCallback(async (id: number) => {
    setDataLoading(true);
    try {
      const history = await portfolioApi.getRiskHistory(id, 200);
      setRiskHistory(history);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Ошибка загрузки');
    } finally {
      setDataLoading(false);
    }
  }, []);

  useEffect(() => {
    if (selectedId !== null) loadHistory(selectedId);
  }, [selectedId, loadHistory]);

  // ── Derived ───────────────────────────────────────────────────────────────

  const selectedPortfolio = portfolios.find((p) => p.id === selectedId) ?? null;
  const byMetric = groupByMetric(riskHistory);

  const varSorted = (byMetric['var'] ?? []).sort((a, b) => a.asof_date.localeCompare(b.asof_date));
  const cvarSorted = (byMetric['cvar'] ?? []).sort((a, b) => a.asof_date.localeCompare(b.asof_date));
  const volSorted = (byMetric['volatility'] ?? []).sort((a, b) => a.asof_date.localeCompare(b.asof_date));

  const chartSeries: LineSeries[] = [];
  if (varSorted.length > 0) chartSeries.push({ name: 'VaR', color: 'var(--primary)', data: varSorted.map((r) => ({ x: r.asof_date, y: r.value })) });
  if (cvarSorted.length > 0) chartSeries.push({ name: 'CVaR', color: 'var(--crit)', data: cvarSorted.map((r) => ({ x: r.asof_date, y: r.value })) });

  const volSeries: LineSeries[] = volSorted.length > 0
    ? [{ name: 'Волатильность', color: 'var(--accent)', data: volSorted.map((r) => ({ x: r.asof_date, y: r.value })) }]
    : [];

  // Method breakdown
  const methodGroups: Record<string, RiskResult[]> = {};
  riskHistory.forEach((r) => {
    (methodGroups[r.method] ??= []).push(r);
  });

  // Stats per method
  const methodStats = Object.entries(methodGroups).map(([method, results]) => {
    const varResults = results.filter((r) => r.metric === 'var');
    const vals = varResults.map((r) => r.value);
    const avg = vals.length > 0 ? vals.reduce((s, v) => s + v, 0) / vals.length : null;
    const max = vals.length > 0 ? Math.max(...vals) : null;
    const min = vals.length > 0 ? Math.min(...vals) : null;
    return { method, count: results.length, avg, max, min };
  });

  // Latest values per method
  const latestByMethod: Record<string, RiskResult> = {};
  riskHistory.forEach((r) => {
    const key = `${r.method}_${r.metric}`;
    if (!latestByMethod[key] || r.asof_date > latestByMethod[key].asof_date) {
      latestByMethod[key] = r;
    }
  });

  return (
    <>
      <Topbar crumbs={['RiskOps', 'Бэктестинг']} />
      <div className="page-content">
        <PageHead
          eyebrow="АНАЛИЗ ИСТОРИИ"
          title="Бэктестинг"
          sub={selectedPortfolio ? `${selectedPortfolio.name} · ${riskHistory.length} записей` : ''}
        >
          <button className="btn-secondary" onClick={() => selectedId && loadHistory(selectedId)} disabled={dataLoading}>
            {dataLoading ? 'Загрузка…' : 'Обновить'}
          </button>
        </PageHead>

        {error && <ErrorBanner message={error} />}

        {/* Portfolio selector */}
        {!loading && portfolios.length > 0 && (
          <div className="row" style={{ gap: 8, marginBottom: 20 }}>
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
          <Skeleton height={300} />
        ) : (
          <>
            {/* Method stats */}
            {methodStats.length > 0 && (
              <div className="grid-4" style={{ marginBottom: 20 }}>
                {methodStats.map((s) => (
                  <div key={s.method} className="metric-card">
                    <div className="metric-label">{s.method}</div>
                    <div className="metric-value" style={{ fontSize: 18 }}>
                      {s.avg !== null ? `${(s.avg * 100).toFixed(2)}%` : '—'}
                    </div>
                    <div className="metric-sub">
                      Ср. VaR · {s.count} записей
                    </div>
                    {s.max !== null && s.min !== null && (
                      <div style={{ fontSize: 10, color: 'var(--ink-4)', marginTop: 4 }}>
                        min {(s.min * 100).toFixed(2)}% / max {(s.max * 100).toFixed(2)}%
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}

            {/* VaR / CVaR history chart */}
            <div className="card" style={{ marginBottom: 20 }}>
              <div className="card-head">
                <div className="card-title">История VaR и CVaR</div>
                {chartSeries.length > 0 && (
                  <div className="row" style={{ gap: 12 }}>
                    {chartSeries.map((s) => (
                      <div key={s.name} className="row" style={{ gap: 4, alignItems: 'center' }}>
                        <div style={{ width: 10, height: 2, background: s.color }} />
                        <span style={{ fontSize: 11, color: 'var(--ink-3)' }}>{s.name}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
              {dataLoading ? <Skeleton height={240} /> : chartSeries.length > 0 ? (
                <LineChart
                  series={chartSeries}
                  height={240}
                  yFormat={(v) => `${(v * 100).toFixed(1)}%`}
                  xFormat={(v) => String(v).slice(5)}
                  fillArea
                />
              ) : (
                <div className="empty-state">Нет данных истории риска</div>
              )}
            </div>

            {/* Volatility chart */}
            {volSeries.length > 0 && (
              <div className="card" style={{ marginBottom: 20 }}>
                <div className="card-head">
                  <div className="card-title">История волатильности</div>
                </div>
                {dataLoading ? <Skeleton height={180} /> : (
                  <LineChart
                    series={volSeries}
                    height={180}
                    yFormat={(v) => `${(v * 100).toFixed(1)}%`}
                    xFormat={(v) => String(v).slice(5)}
                  />
                )}
              </div>
            )}

            {/* Full history table */}
            {riskHistory.length > 0 && (
              <div className="card">
                <div className="card-head">
                  <div className="card-title">Полная история</div>
                  <span style={{ fontSize: 11, color: 'var(--ink-4)' }}>{riskHistory.length} записей</span>
                </div>
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Дата</th>
                      <th>Метрика</th>
                      <th>Метод</th>
                      <th>Горизонт</th>
                      <th>Уровень</th>
                      <th style={{ textAlign: 'right' }}>Значение</th>
                      <th>Версия</th>
                    </tr>
                  </thead>
                  <tbody>
                    {riskHistory
                      .sort((a, b) => b.asof_date.localeCompare(a.asof_date))
                      .slice(0, 50)
                      .map((r) => (
                        <tr key={r.id}>
                          <td className="mono" style={{ fontSize: 11 }}>{r.asof_date}</td>
                          <td><span className="mono" style={{ textTransform: 'uppercase' }}>{r.metric}</span></td>
                          <td>{r.method}</td>
                          <td className="mono">{r.horizon_days}д</td>
                          <td className="mono">{(r.alpha * 100).toFixed(0)}%</td>
                          <td style={{ textAlign: 'right' }} className="mono">{(r.value * 100).toFixed(3)}%</td>
                          <td className="mono" style={{ fontSize: 11, color: 'var(--ink-4)' }}>{r.model_version}</td>
                        </tr>
                      ))}
                  </tbody>
                </table>
                {riskHistory.length > 50 && (
                  <div style={{ padding: '8px 0', fontSize: 11, color: 'var(--ink-4)', textAlign: 'center' }}>
                    Показано 50 из {riskHistory.length} записей
                  </div>
                )}
              </div>
            )}

            {riskHistory.length === 0 && !dataLoading && (
              <div className="empty-state" style={{ marginTop: 40 }}>
                <div style={{ fontSize: 32, marginBottom: 8 }}>📊</div>
                <div>Нет данных истории риска для этого портфеля.</div>
                <div style={{ marginTop: 4, fontSize: 12, color: 'var(--ink-4)' }}>
                  Запустите расчёт риска на странице «Дашборд» или «Стресс-тесты».
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </>
  );
}
