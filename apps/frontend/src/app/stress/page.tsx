'use client';

import React, { useEffect, useState } from 'react';
import { Topbar, PageHead, Pill, ErrorBanner, Skeleton } from '@/components/Shell';
import { portfolioApi, inferenceApi, type Portfolio, type PredictResponse } from '@/lib/api';

type Method = 'historical' | 'garch' | 'montecarlo';

interface ScenarioResult {
  method: Method;
  alpha: number;
  horizon_days: number;
  result: PredictResponse | null;
  error: string | null;
  loading: boolean;
}

const METHODS: Method[] = ['historical', 'garch', 'montecarlo'];
const ALPHAS = [0.95, 0.99];
const HORIZONS = [1, 5, 10];

export default function StressPage() {
  const [portfolios, setPortfolios] = useState<Portfolio[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Scenario config
  const [method, setMethod] = useState<Method>('historical');
  const [alpha, setAlpha] = useState(0.95);
  const [horizon, setHorizon] = useState(1);

  // Results
  const [results, setResults] = useState<ScenarioResult[]>([]);
  const [running, setRunning] = useState(false);

  useEffect(() => {
    portfolioApi.list()
      .then((ps) => {
        setPortfolios(ps);
        if (ps.length > 0) setSelectedId(ps[0].id);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  const runSingle = async () => {
    if (!selectedId) return;
    setRunning(true);
    setError(null);
    try {
      const res = await inferenceApi.predict({
        portfolio_id: selectedId,
        method,
        alpha,
        horizon_days: horizon,
      });
      setResults((prev) => [
        {
          method,
          alpha,
          horizon_days: horizon,
          result: res,
          error: null,
          loading: false,
        },
        ...prev.filter((r) => !(r.method === method && r.alpha === alpha && r.horizon_days === horizon)),
      ]);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Ошибка расчёта');
    } finally {
      setRunning(false);
    }
  };

  const runAll = async () => {
    if (!selectedId) return;
    setRunning(true);
    setError(null);
    const scenarios: ScenarioResult[] = METHODS.flatMap((m) =>
      ALPHAS.flatMap((a) =>
        HORIZONS.map((h) => ({ method: m, alpha: a, horizon_days: h, result: null, error: null, loading: true }))
      )
    );
    setResults(scenarios);

    const updated = [...scenarios];
    await Promise.all(
      scenarios.map(async (s, i) => {
        try {
          const res = await inferenceApi.predict({
            portfolio_id: selectedId,
            method: s.method,
            alpha: s.alpha,
            horizon_days: s.horizon_days,
          });
          updated[i] = { ...s, result: res, loading: false };
        } catch (e: unknown) {
          updated[i] = { ...s, error: e instanceof Error ? e.message : 'Ошибка', loading: false };
        }
      })
    );
    setResults([...updated]);
    setRunning(false);
  };

  const clearResults = () => setResults([]);

  const selectedPortfolio = portfolios.find((p) => p.id === selectedId) ?? null;

  return (
    <>
      <Topbar crumbs={['RiskOps', 'Стресс-тесты']} />
      <div className="page-content">
        <PageHead
          eyebrow="АНАЛИЗ СЦЕНАРИЕВ"
          title="Стресс-тесты"
          sub={selectedPortfolio ? selectedPortfolio.name : 'Выберите портфель'}
        >
          <button className="btn-secondary" onClick={clearResults} disabled={results.length === 0}>
            Очистить
          </button>
          <button className="btn-secondary" onClick={runAll} disabled={running || !selectedId}>
            {running ? 'Расчёт…' : 'Все сценарии'}
          </button>
          <button className="btn-primary" onClick={runSingle} disabled={running || !selectedId}>
            {running ? 'Расчёт…' : 'Запустить'}
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

        {/* Scenario config */}
        <div className="card" style={{ marginBottom: 20 }}>
          <div className="card-head">
            <div className="card-title">Параметры сценария</div>
          </div>
          <div className="row" style={{ gap: 24, flexWrap: 'wrap' }}>
            <div>
              <div style={{ fontSize: 11, color: 'var(--ink-4)', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Метод</div>
              <div className="row" style={{ gap: 6 }}>
                {METHODS.map((m) => (
                  <button
                    key={m}
                    className={method === m ? 'btn-primary' : 'btn-secondary'}
                    style={{ fontSize: 12 }}
                    onClick={() => setMethod(m)}
                  >
                    {m}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <div style={{ fontSize: 11, color: 'var(--ink-4)', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Уровень доверия</div>
              <div className="row" style={{ gap: 6 }}>
                {ALPHAS.map((a) => (
                  <button
                    key={a}
                    className={alpha === a ? 'btn-primary' : 'btn-secondary'}
                    style={{ fontSize: 12 }}
                    onClick={() => setAlpha(a)}
                  >
                    {(a * 100).toFixed(0)}%
                  </button>
                ))}
              </div>
            </div>
            <div>
              <div style={{ fontSize: 11, color: 'var(--ink-4)', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Горизонт (дней)</div>
              <div className="row" style={{ gap: 6 }}>
                {HORIZONS.map((h) => (
                  <button
                    key={h}
                    className={horizon === h ? 'btn-primary' : 'btn-secondary'}
                    style={{ fontSize: 12 }}
                    onClick={() => setHorizon(h)}
                  >
                    {h}д
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* Results */}
        {results.length > 0 && (
          <div className="card">
            <div className="card-head">
              <div className="card-title">Результаты</div>
              <span style={{ fontSize: 11, color: 'var(--ink-4)' }}>{results.length} сценариев</span>
            </div>
            <table className="data-table">
              <thead>
                <tr>
                  <th>Метод</th>
                  <th>Уровень</th>
                  <th>Горизонт</th>
                  <th style={{ textAlign: 'right' }}>VaR</th>
                  <th style={{ textAlign: 'right' }}>CVaR</th>
                  <th style={{ textAlign: 'right' }}>Волатильность</th>
                  <th>Версия</th>
                  <th>Статус</th>
                </tr>
              </thead>
              <tbody>
                {results.map((r, i) => (
                  <tr key={i}>
                    <td className="mono">{r.method}</td>
                    <td className="mono">{(r.alpha * 100).toFixed(0)}%</td>
                    <td className="mono">{r.horizon_days}д</td>
                    {r.loading ? (
                      <td colSpan={4}><Skeleton height={16} /></td>
                    ) : r.error ? (
                      <td colSpan={4} style={{ color: 'var(--crit)', fontSize: 12 }}>{r.error}</td>
                    ) : r.result ? (
                      <>
                        <td style={{ textAlign: 'right' }} className="mono">{(r.result.var * 100).toFixed(3)}%</td>
                        <td style={{ textAlign: 'right' }} className="mono">{(r.result.cvar * 100).toFixed(3)}%</td>
                        <td style={{ textAlign: 'right' }} className="mono">{(r.result.volatility * 100).toFixed(3)}%</td>
                        <td className="mono" style={{ fontSize: 11, color: 'var(--ink-4)' }}>{r.result.model_version}</td>
                      </>
                    ) : (
                      <td colSpan={4} style={{ color: 'var(--ink-4)' }}>—</td>
                    )}
                    <td>
                      {r.loading ? <Pill variant="warn">Расчёт…</Pill>
                        : r.error ? <Pill variant="crit">Ошибка</Pill>
                        : <Pill variant="good">OK</Pill>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {results.length === 0 && !loading && (
          <div className="empty-state" style={{ marginTop: 40 }}>
            <div style={{ fontSize: 32, marginBottom: 8 }}>🧪</div>
            <div>Настройте параметры и нажмите «Запустить» для расчёта стресс-сценария.</div>
            <div style={{ marginTop: 4, fontSize: 12, color: 'var(--ink-4)' }}>
              «Все сценарии» запустит {METHODS.length * ALPHAS.length * HORIZONS.length} комбинаций параллельно.
            </div>
          </div>
        )}
      </div>
    </>
  );
}
