'use client';

import React, { useEffect, useState } from 'react';
import { Topbar, PageHead, Pill, ErrorBanner, Skeleton } from '@/components/Shell';
import { LineChart, Histogram, makeBins, type LineSeries } from '@/components/Charts';
import { marketDataApi, inferenceApi, type ProcessedReturn, type ModelHealthResponse } from '@/lib/api';

export default function DriftPage() {
  const [returns, setReturns] = useState<ProcessedReturn[]>([]);
  const [health, setHealth] = useState<ModelHealthResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Symbol filter
  const [symbolInput, setSymbolInput] = useState('');
  const [activeSymbols, setActiveSymbols] = useState<string[]>([]);

  const load = async (symbols?: string) => {
    setLoading(true);
    setError(null);
    try {
      const [ret, h] = await Promise.all([
        // limit=5000: up to 5 symbols × 252 trading days × 4 buffer = enough for rolling vol
        marketDataApi.getReturns({ symbols, limit: 5000 }),
        inferenceApi.health(),
      ]);
      setReturns(ret);
      setHealth(h);

      // Extract unique symbols
      const syms = Array.from(new Set(ret.map((r) => r.symbol)));
      setActiveSymbols(syms);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Ошибка загрузки');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const handleFilter = () => {
    const syms = symbolInput.split(',').map((s) => s.trim().toUpperCase()).filter(Boolean);
    load(syms.length > 0 ? syms.join(',') : undefined);
  };

  // ── Derived ───────────────────────────────────────────────────────────────

  // Group returns by symbol
  const bySymbol: Record<string, ProcessedReturn[]> = {};
  returns.forEach((r) => {
    (bySymbol[r.symbol] ??= []).push(r);
  });

  // Fixed palette — no undefined CSS vars
  const COLORS = ['var(--primary)', 'var(--crit)', '#3E5A6B', '#6b8f71', '#c9a96e'];
  const symbols = Object.keys(bySymbol).slice(0, 5);

  const returnSeries: LineSeries[] = symbols.map((sym, i) => {
    const sorted = [...bySymbol[sym]].sort((a, b) => a.price_date.localeCompare(b.price_date)).slice(-60);
    return {
      name: sym,
      color: COLORS[i % COLORS.length],
      data: sorted.map((r) => ({ x: r.price_date, y: r.ret })),
    };
  });

  // Rolling volatility (20-day window, annualised) — computed for ALL symbols
  const VOL_WINDOW = 20;
  const volSeries: LineSeries[] = symbols
    .map((sym, i) => {
      const sorted = [...bySymbol[sym]].sort((a, b) => a.price_date.localeCompare(b.price_date));
      if (sorted.length <= VOL_WINDOW) return null;

      const volData: { x: string; y: number }[] = [];
      for (let j = VOL_WINDOW; j < sorted.length; j++) {
        const slice = sorted.slice(j - VOL_WINDOW, j).map((r) => r.ret);
        const mean = slice.reduce((s, v) => s + v, 0) / slice.length;
        const variance = slice.reduce((s, v) => s + (v - mean) ** 2, 0) / slice.length;
        volData.push({ x: sorted[j].price_date, y: Math.sqrt(variance * 252) });
      }

      if (volData.length === 0) return null;
      return { name: `${sym} σ(20д)`, color: COLORS[i % COLORS.length], data: volData } as LineSeries;
    })
    .filter((s): s is LineSeries => s !== null);

  // Histogram for all returns
  const allReturns = returns.map((r) => r.ret);
  const bins = allReturns.length > 0 ? makeBins(allReturns) : [];

  // Stats per symbol
  const symbolStats = symbols.map((sym) => {
    const vals = bySymbol[sym].map((r) => r.ret);
    const mean = vals.reduce((s, v) => s + v, 0) / vals.length;
    const variance = vals.reduce((s, v) => s + (v - mean) ** 2, 0) / vals.length;
    const vol = Math.sqrt(variance * 252);
    const skew = vals.length > 2
      ? vals.reduce((s, v) => s + ((v - mean) / Math.sqrt(variance)) ** 3, 0) / vals.length
      : 0;
    return { sym, count: vals.length, mean, vol, skew };
  });

  return (
    <>
      <Topbar crumbs={['RiskOps', 'Мониторинг дрифта']} />
      <div className="page-content">
        <PageHead
          eyebrow="МОНИТОРИНГ ДАННЫХ"
          title="Мониторинг дрифта"
          sub={`${returns.length} наблюдений · ${activeSymbols.length} инструментов`}
        >
          <button className="btn-secondary" onClick={() => load()} disabled={loading}>
            {loading ? 'Загрузка…' : 'Обновить'}
          </button>
        </PageHead>

        {error && <ErrorBanner message={error} />}

        {/* Filter */}
        <div className="card" style={{ marginBottom: 20 }}>
          <div className="card-head">
            <div className="card-title">Фильтр инструментов</div>
            {health && (
              <Pill variant={health.status === 'ok' ? 'good' : 'warn'}>
                Inference: {health.status}
              </Pill>
            )}
          </div>
          <div className="row" style={{ gap: 8 }}>
            <input
              className="input"
              placeholder="AAPL, MSFT, GOOGL (пусто = все)"
              value={symbolInput}
              onChange={(e) => setSymbolInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleFilter()}
              style={{ flex: 1 }}
            />
            <button className="btn-primary" onClick={handleFilter} disabled={loading}>
              Применить
            </button>
          </div>
          {activeSymbols.length > 0 && (
            <div className="row" style={{ gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
              {activeSymbols.map((s) => (
                <span key={s} className="mono" style={{ fontSize: 11, background: 'var(--surface-2)', padding: '2px 6px', borderRadius: 4 }}>
                  {s}
                </span>
              ))}
            </div>
          )}
        </div>

        {loading ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <Skeleton height={200} />
            <Skeleton height={200} />
          </div>
        ) : (
          <>
            {/* Symbol stats */}
            {symbolStats.length > 0 && (
              <div className="grid-4" style={{ marginBottom: 20 }}>
                {symbolStats.map((s, i) => (
                  <div key={s.sym} className="metric-card">
                    <div className="metric-label">
                      <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: '50%', background: COLORS[i % COLORS.length], marginRight: 6 }} />
                      {s.sym}
                    </div>
                    <div className="metric-value" style={{ fontSize: 18 }}>{(s.vol * 100).toFixed(1)}%</div>
                    <div className="metric-sub">Годовая σ</div>
                    <div style={{ fontSize: 10, color: 'var(--ink-4)', marginTop: 4 }}>
                      μ: {(s.mean * 100).toFixed(3)}% · skew: {s.skew.toFixed(2)} · n={s.count}
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Returns time series */}
            {returnSeries.length > 0 && (
              <div className="card" style={{ marginBottom: 20 }}>
                <div className="card-head">
                  <div className="card-title">Доходности (последние 60 дней)</div>
                  <div className="row" style={{ gap: 12 }}>
                    {returnSeries.map((s) => (
                      <div key={s.name} className="row" style={{ gap: 4, alignItems: 'center' }}>
                        <div style={{ width: 10, height: 2, background: s.color }} />
                        <span style={{ fontSize: 11, color: 'var(--ink-3)' }}>{s.name}</span>
                      </div>
                    ))}
                  </div>
                </div>
                <LineChart
                  series={returnSeries}
                  height={220}
                  yFormat={(v) => `${(v * 100).toFixed(1)}%`}
                  xFormat={(v) => String(v).slice(5)}
                />
              </div>
            )}

            {/* Rolling volatility — all symbols with ≥ 21 observations */}
            {volSeries.length > 0 ? (
              <div className="card" style={{ marginBottom: 20 }}>
                <div className="card-head">
                  <div className="card-title">Скользящая волатильность (20д окно, годовая)</div>
                  <div className="row" style={{ gap: 12 }}>
                    {volSeries.map((s) => (
                      <div key={s.name} className="row" style={{ gap: 4, alignItems: 'center' }}>
                        <div style={{ width: 10, height: 2, background: s.color }} />
                        <span style={{ fontSize: 11, color: 'var(--ink-3)' }}>{s.name}</span>
                      </div>
                    ))}
                  </div>
                </div>
                <LineChart
                  series={volSeries}
                  height={180}
                  yFormat={(v) => `${(v * 100).toFixed(1)}%`}
                  xFormat={(v) => String(v).slice(5)}
                />
              </div>
            ) : returns.length > 0 ? (
              <div className="card" style={{ marginBottom: 20 }}>
                <div className="card-head">
                  <div className="card-title">Скользящая волатильность (20д окно, годовая)</div>
                </div>
                <div style={{ padding: '24px 0', textAlign: 'center', color: 'var(--ink-4)', fontSize: 13 }}>
                  Недостаточно данных для скользящего окна (нужно ≥ 21 наблюдение на символ)
                </div>
              </div>
            ) : null}

            {/* Distribution histogram */}
            {bins.length > 0 && (
              <div className="card" style={{ marginBottom: 20 }}>
                <div className="card-head">
                  <div className="card-title">Распределение доходностей</div>
                </div>
                <Histogram
                  bins={bins}
                  height={180}
                />
              </div>
            )}

            {returns.length === 0 && (
              <div className="empty-state" style={{ marginTop: 40 }}>
                <div style={{ fontSize: 32, marginBottom: 8 }}>📈</div>
                <div>Нет данных о доходностях.</div>
                <div style={{ marginTop: 4, fontSize: 12, color: 'var(--ink-4)' }}>
                  Загрузите рыночные данные на странице «Источники данных».
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </>
  );
}
