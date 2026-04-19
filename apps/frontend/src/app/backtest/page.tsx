'use client';

import React, { useEffect, useState, useCallback } from 'react';
import { Topbar, PageHead, Pill, ErrorBanner, Skeleton } from '@/components/Shell';
import { LineChart, type LineSeries } from '@/components/Charts';
import {
  portfolioApi,
  trainingApi,
  groupByMetric,
  type Portfolio,
  type RiskResult,
  type BacktestResponse,
} from '@/lib/api';

// ── Status badge ──────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: 'OK' | 'WARN' | 'CRIT' | string }) {
  const map: Record<string, { bg: string; color: string; label: string }> = {
    OK:   { bg: 'var(--good-soft)',  color: 'var(--good)',    label: '✓ OK' },
    WARN: { bg: 'var(--warn-soft)',  color: 'var(--warn)',    label: '⚠ WARN' },
    CRIT: { bg: 'var(--crit-soft)', color: 'var(--crit)',    label: '✕ CRIT' },
  };
  const s = map[status] ?? { bg: 'var(--surface-2)', color: 'var(--ink-3)', label: status };
  return (
    <span style={{
      display: 'inline-block',
      padding: '2px 10px',
      borderRadius: 4,
      background: s.bg,
      color: s.color,
      fontWeight: 700,
      fontSize: 13,
      letterSpacing: '0.04em',
    }}>
      {s.label}
    </span>
  );
}

// ── P-value badge ─────────────────────────────────────────────────────────────

function PValueBadge({ p }: { p: number }) {
  const color = p > 0.05 ? 'var(--good)' : p > 0.01 ? 'var(--warn)' : 'var(--crit)';
  return <span style={{ color, fontWeight: 600, fontFamily: 'monospace' }}>{p.toFixed(4)}</span>;
}

// ── Stat row ──────────────────────────────────────────────────────────────────

function StatRow({ label, value, sub }: { label: string; value: React.ReactNode; sub?: string }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', padding: '6px 0', borderBottom: '1px solid var(--hair)' }}>
      <span style={{ fontSize: 12, color: 'var(--ink-3)' }}>{label}</span>
      <span style={{ fontSize: 13, fontWeight: 500 }}>
        {value}
        {sub && <span style={{ fontSize: 11, color: 'var(--ink-4)', marginLeft: 4 }}>{sub}</span>}
      </span>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function BacktestPage() {
  const [portfolios, setPortfolios] = useState<Portfolio[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [riskHistory, setRiskHistory] = useState<RiskResult[]>([]);
  const [loading, setLoading] = useState(true);
  const [dataLoading, setDataLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Backtest runner state
  const [btSymbols, setBtSymbols] = useState('AAPL,MSFT');
  const [btModel, setBtModel] = useState<'garch' | 'montecarlo' | 'historical'>('garch');
  const [btAlpha, setBtAlpha] = useState('0.99');
  const [btLookback, setBtLookback] = useState('252');
  const [btTestDays, setBtTestDays] = useState('60');
  const [btRunning, setBtRunning] = useState(false);
  const [btResult, setBtResult] = useState<BacktestResponse | null>(null);
  const [btError, setBtError] = useState<string | null>(null);

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

  const handleRunBacktest = async () => {
    setBtRunning(true);
    setBtError(null);
    setBtResult(null);
    try {
      const symbols = btSymbols.split(',').map((s) => s.trim()).filter(Boolean);
      const result = await trainingApi.runBacktest({
        symbols,
        model_type: btModel,
        alpha: parseFloat(btAlpha),
        lookback_days: parseInt(btLookback, 10),
        test_days: parseInt(btTestDays, 10),
        log_to_mlflow: true,
      });
      setBtResult(result);
    } catch (e: unknown) {
      setBtError(e instanceof Error ? e.message : 'Ошибка бэктеста');
    } finally {
      setBtRunning(false);
    }
  };

  // ── Derived ───────────────────────────────────────────────────────────────

  const selectedPortfolio = portfolios.find((p) => p.id === selectedId) ?? null;
  const byMetric = groupByMetric(riskHistory);

  const varSorted  = (byMetric['var']        ?? []).sort((a, b) => a.asof_date.localeCompare(b.asof_date));
  const cvarSorted = (byMetric['cvar']       ?? []).sort((a, b) => a.asof_date.localeCompare(b.asof_date));
  const volSorted  = (byMetric['volatility'] ?? []).sort((a, b) => a.asof_date.localeCompare(b.asof_date));

  const chartSeries: LineSeries[] = [];
  if (varSorted.length  > 0) chartSeries.push({ name: 'VaR',  color: 'var(--primary)', data: varSorted.map((r)  => ({ x: r.asof_date, y: r.value })) });
  if (cvarSorted.length > 0) chartSeries.push({ name: 'CVaR', color: 'var(--crit)',    data: cvarSorted.map((r) => ({ x: r.asof_date, y: r.value })) });

  const volSeries: LineSeries[] = volSorted.length > 0
    ? [{ name: 'Волатильность', color: 'var(--accent)', data: volSorted.map((r) => ({ x: r.asof_date, y: r.value })) }]
    : [];

  // Method stats
  const methodGroups: Record<string, RiskResult[]> = {};
  riskHistory.forEach((r) => { (methodGroups[r.method] ??= []).push(r); });
  const methodStats = Object.entries(methodGroups).map(([method, results]) => {
    const vals = results.filter((r) => r.metric === 'var').map((r) => r.value);
    const avg = vals.length > 0 ? vals.reduce((s, v) => s + v, 0) / vals.length : null;
    const max = vals.length > 0 ? Math.max(...vals) : null;
    const min = vals.length > 0 ? Math.min(...vals) : null;
    return { method, count: results.length, avg, max, min };
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

        {/* ── Backtest Runner ─────────────────────────────────────────────── */}
        <div className="card" style={{ marginBottom: 24 }}>
          <div className="card-head">
            <div className="card-title">Запустить бэктест</div>
            <span style={{ fontSize: 11, color: 'var(--ink-4)' }}>
              Rolling window · Kupiec + Christoffersen
            </span>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr) auto', gap: 12, alignItems: 'end', marginBottom: 16 }}>
            <div>
              <div style={{ fontSize: 11, color: 'var(--ink-3)', marginBottom: 4 }}>Тикеры (через запятую)</div>
              <input
                className="input"
                value={btSymbols}
                onChange={(e) => setBtSymbols(e.target.value)}
                placeholder="AAPL,MSFT"
                style={{ width: '100%' }}
              />
            </div>
            <div>
              <div style={{ fontSize: 11, color: 'var(--ink-3)', marginBottom: 4 }}>Модель</div>
              <select
                className="input"
                value={btModel}
                onChange={(e) => setBtModel(e.target.value as typeof btModel)}
                style={{ width: '100%' }}
              >
                <option value="garch">GARCH(1,1)</option>
                <option value="historical">Historical</option>
                <option value="montecarlo">Monte Carlo</option>
              </select>
            </div>
            <div>
              <div style={{ fontSize: 11, color: 'var(--ink-3)', marginBottom: 4 }}>Alpha (VaR)</div>
              <input
                className="input"
                type="number"
                step="0.01"
                min="0.9"
                max="0.9999"
                value={btAlpha}
                onChange={(e) => setBtAlpha(e.target.value)}
                style={{ width: '100%' }}
              />
            </div>
            <div>
              <div style={{ fontSize: 11, color: 'var(--ink-3)', marginBottom: 4 }}>Lookback (дней)</div>
              <input
                className="input"
                type="number"
                min="30"
                max="2520"
                value={btLookback}
                onChange={(e) => setBtLookback(e.target.value)}
                style={{ width: '100%' }}
              />
            </div>
            <div>
              <div style={{ fontSize: 11, color: 'var(--ink-3)', marginBottom: 4 }}>Test window (дней)</div>
              <input
                className="input"
                type="number"
                min="10"
                max="504"
                value={btTestDays}
                onChange={(e) => setBtTestDays(e.target.value)}
                style={{ width: '100%' }}
              />
            </div>
            <button
              className="btn-primary"
              onClick={handleRunBacktest}
              disabled={btRunning || !btSymbols}
              style={{ whiteSpace: 'nowrap' }}
            >
              {btRunning ? 'Считаем…' : '▶ Запустить'}
            </button>
          </div>

          {btError && <ErrorBanner message={btError} />}

          {/* ── Backtest Results ──────────────────────────────────────────── */}
          {btResult && (
            <div style={{ borderTop: '1px solid var(--hair)', paddingTop: 16 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
                <StatusBadge status={btResult.status} />
                <span style={{ fontSize: 12, color: 'var(--ink-3)' }}>
                  {btResult.model_type} · α={btResult.alpha} · lookback={btResult.lookback_days}д · test={btResult.test_days}д
                </span>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 20 }}>
                {/* Coverage */}
                <div>
                  <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--ink-3)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8 }}>
                    Покрытие
                  </div>
                  <StatRow
                    label="Нарушений VaR"
                    value={<span className="mono">{btResult.violations} / {btResult.total_obs}</span>}
                  />
                  <StatRow
                    label="Наблюдаемая частота"
                    value={<span className="mono" style={{ color: btResult.violation_rate > btResult.expected_rate * 1.5 ? 'var(--crit)' : 'var(--ink-1)' }}>
                      {(btResult.violation_rate * 100).toFixed(2)}%
                    </span>}
                  />
                  <StatRow
                    label="Ожидаемая частота"
                    value={<span className="mono">{(btResult.expected_rate * 100).toFixed(2)}%</span>}
                  />
                  <StatRow
                    label="Превышение"
                    value={<span className="mono" style={{ color: btResult.violation_rate > btResult.expected_rate ? 'var(--crit)' : 'var(--good)' }}>
                      ×{(btResult.violation_rate / Math.max(btResult.expected_rate, 1e-6)).toFixed(1)}
                    </span>}
                    sub="от ожидаемого"
                  />
                </div>

                {/* Kupiec test */}
                <div>
                  <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--ink-3)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8 }}>
                    Тест Купика (UC)
                  </div>
                  <StatRow
                    label="LR-статистика"
                    value={<span className="mono">{btResult.kupiec_lr.toFixed(4)}</span>}
                    sub="χ²(1)"
                  />
                  <StatRow
                    label="p-value"
                    value={<PValueBadge p={btResult.kupiec_pvalue} />}
                  />
                  <StatRow
                    label="H₀: p = 1−α"
                    value={btResult.kupiec_pvalue > 0.05
                      ? <Pill variant="good">Не отвергается</Pill>
                      : <Pill variant="crit">Отвергается</Pill>
                    }
                  />
                  <div style={{ marginTop: 8, fontSize: 11, color: 'var(--ink-4)', lineHeight: 1.5 }}>
                    Проверяет, совпадает ли наблюдаемая частота нарушений с ожидаемой (1−α).
                  </div>
                </div>

                {/* Christoffersen test */}
                <div>
                  <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--ink-3)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8 }}>
                    Тест Кристофферсена (CC)
                  </div>
                  <StatRow
                    label="LR_ind"
                    value={<span className="mono">{btResult.christoffersen_lr_ind.toFixed(4)}</span>}
                    sub="χ²(1)"
                  />
                  <StatRow
                    label="LR_cc"
                    value={<span className="mono">{btResult.christoffersen_lr_cc.toFixed(4)}</span>}
                    sub="χ²(2)"
                  />
                  <StatRow
                    label="p-value (CC)"
                    value={<PValueBadge p={btResult.christoffersen_pvalue_cc} />}
                  />
                  <StatRow
                    label="π₀₁ (нарушение после нет)"
                    value={<span className="mono">{(btResult.pi_01 * 100).toFixed(1)}%</span>}
                  />
                  <StatRow
                    label="π₁₁ (нарушение после да)"
                    value={<span className="mono" style={{ color: btResult.pi_11 > 0.3 ? 'var(--crit)' : 'var(--ink-1)' }}>
                      {(btResult.pi_11 * 100).toFixed(1)}%
                    </span>}
                  />
                  <div style={{ marginTop: 8, fontSize: 11, color: 'var(--ink-4)', lineHeight: 1.5 }}>
                    Дополнительно проверяет независимость нарушений (отсутствие кластеризации).
                    π₁₁ {'>'} 30% — признак кластеризации.
                  </div>
                </div>
              </div>

              {/* Decision guide */}
              <div style={{ marginTop: 16, padding: '10px 14px', borderRadius: 6, background: 'var(--surface-2)', fontSize: 11, color: 'var(--ink-3)' }}>
                <strong>Пороги:</strong>&nbsp;
                <span style={{ color: 'var(--good)' }}>p {'>'} 0.05 → OK</span> &nbsp;·&nbsp;
                <span style={{ color: 'var(--warn)' }}>0.01 {'<'} p ≤ 0.05 → WARN</span> &nbsp;·&nbsp;
                <span style={{ color: 'var(--crit)' }}>p ≤ 0.01 → CRIT (переобучение)</span>
                &nbsp;· Используется min(p_kupiec, p_cc).
              </div>
            </div>
          )}
        </div>

        {/* ── Portfolio selector ──────────────────────────────────────────── */}
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
                    <div className="metric-sub">Ср. VaR · {s.count} записей</div>
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
