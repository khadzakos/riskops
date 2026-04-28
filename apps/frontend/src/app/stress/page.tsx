'use client';

import React, { useEffect, useState } from 'react';
import { Topbar, PageHead, Pill, ErrorBanner, Skeleton } from '@/components/Shell';
import {
  portfolioApi,
  inferenceApi,
  type Portfolio,
  type ScenarioInfo,
  type ScenarioRunResponse,
} from '@/lib/api';

// ─── Types ────────────────────────────────────────────────────────────────────

interface ScenarioResult {
  scenarioId: string;
  scenarioName: string;
  scenarioType: string;
  portfolioId: number;
  portfolioName: string;
  result: ScenarioRunResponse | null;
  error: string | null;
  loading: boolean;
}

// ─── localStorage helpers ─────────────────────────────────────────────────────

const LS_KEY = 'riskops_stress_results';

function loadFromStorage(): ScenarioResult[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return [];
    const parsed: ScenarioResult[] = JSON.parse(raw);
    // Strip any rows that were still "loading" when the page was closed
    return parsed.map((r) => r.loading ? { ...r, loading: false, error: 'Прервано перезагрузкой' } : r);
  } catch {
    return [];
  }
}

function saveToStorage(results: ScenarioResult[]): void {
  if (typeof window === 'undefined') return;
  try {
    // Don't persist rows that are still loading
    const toSave = results.filter((r) => !r.loading);
    localStorage.setItem(LS_KEY, JSON.stringify(toSave));
  } catch {
    // quota exceeded or private browsing — silently ignore
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function pct(v: number, decimals = 2) {
  return `${(v * 100).toFixed(decimals)}%`;
}

function variantForType(type: string): 'good' | 'warn' | 'crit' {
  return type === 'historical' ? 'crit' : 'warn';
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function StressPage() {
  const [portfolios, setPortfolios] = useState<Portfolio[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [portfoliosLoading, setPortfoliosLoading] = useState(true);

  const [scenarios, setScenarios] = useState<ScenarioInfo[]>([]);
  const [scenariosLoading, setScenariosLoading] = useState(true);

  // Single selected scenario (radio-style), null = nothing selected
  const [selectedScenario, setSelectedScenario] = useState<string | null>(null);
  const [alpha, setAlpha] = useState(0.99);
  const [nSim, setNSim] = useState(50_000);

  // Custom scenario parameters
  const [customVolMultiplier, setCustomVolMultiplier] = useState(3);
  const [customCorrShock, setCustomCorrShock] = useState(0.5);

  const [results, setResults] = useState<ScenarioResult[]>(loadFromStorage);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Persist results to localStorage whenever they change (skip in-flight rows)
  useEffect(() => {
    saveToStorage(results);
  }, [results]);

  // Load portfolios
  useEffect(() => {
    portfolioApi
      .list()
      .then((ps) => {
        setPortfolios(ps);
        if (ps.length > 0) setSelectedId(ps[0].id);
      })
      .catch((e) => setError(e.message))
      .finally(() => setPortfoliosLoading(false));
  }, []);

  // Load scenario catalogue — no pre-selection
  useEffect(() => {
    inferenceApi
      .listScenarios()
      .then((r) => {
        setScenarios(r.scenarios);
        // intentionally no pre-selection
      })
      .catch((e) => setError(`Не удалось загрузить сценарии: ${e.message}`))
      .finally(() => setScenariosLoading(false));
  }, []);

  const runScenario = async () => {
    if (!selectedId || !selectedScenario) return;
    setRunning(true);
    setError(null);

    const isCustom = selectedScenario === 'custom';
    const scenario = isCustom
      ? { id: 'custom', name: 'Пользовательский', type: 'parametric' as const }
      : scenarios.find((s) => s.id === selectedScenario);
    if (!scenario) { setRunning(false); return; }

    const newRow: ScenarioResult = {
      scenarioId: scenario.id,
      scenarioName: scenario.name,
      scenarioType: scenario.type,
      portfolioId: selectedId,
      portfolioName: portfolios.find((p) => p.id === selectedId)?.name ?? String(selectedId),
      result: null,
      error: null,
      loading: true,
    };

    // Prepend new row (keep history)
    setResults((prev) => [newRow, ...prev]);

    try {
      const res = await inferenceApi.runScenario({
        portfolio_id: selectedId,
        scenario_id: scenario.id,
        alpha,
        n_simulations: nSim,
        ...(isCustom ? { vol_multiplier: customVolMultiplier, corr_shock: customCorrShock } : {}),
      });
      setResults((prev) =>
        prev.map((r, i) => (i === 0 ? { ...r, result: res, loading: false } : r))
      );
    } catch (e: unknown) {
      setResults((prev) =>
        prev.map((r, i) =>
          i === 0
            ? { ...r, error: e instanceof Error ? e.message : 'Ошибка расчёта', loading: false }
            : r
        )
      );
    } finally {
      setRunning(false);
    }
  };

  const clearResults = () => setResults([]);

  const selectedPortfolio = portfolios.find((p) => p.id === selectedId) ?? null;
  const historicalScenarios = scenarios.filter((s) => s.type === 'historical');
  const parametricScenarios = scenarios.filter((s) => s.type === 'parametric');

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
            Очистить историю
          </button>
          <button
            className="btn-primary"
            onClick={runScenario}
            disabled={running || !selectedId || !selectedScenario}
          >
            {running ? 'Расчёт…' : 'Запустить'}
          </button>
        </PageHead>

        {error && <ErrorBanner message={error} />}

        {/* Portfolio selector */}
        {!portfoliosLoading && portfolios.length > 0 && (
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

        <div className="grid-2" style={{ gap: 20, marginBottom: 20 }}>
          {/* Scenario catalogue — single select */}
          <div className="card">
            <div className="card-head">
              <div className="card-title">Сценарий</div>
              {selectedScenario && (
                <Pill variant={scenarios.find((s) => s.id === selectedScenario)?.type === 'historical' ? 'crit' : 'warn'}>
                  {scenarios.find((s) => s.id === selectedScenario)?.type === 'historical' ? 'Исторический' : 'Параметрический'}
                </Pill>
              )}
            </div>

            {scenariosLoading ? (
              <Skeleton height={200} />
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
                {/* Historical */}
                {historicalScenarios.length > 0 && (
                  <div>
                    <div
                      style={{
                        fontSize: 10,
                        color: 'var(--ink-4)',
                        textTransform: 'uppercase',
                        letterSpacing: '0.08em',
                        marginBottom: 8,
                        fontFamily: 'var(--mono)',
                      }}
                    >
                      Исторические кризисы
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                      {historicalScenarios.map((s) => (
                        <div
                          key={s.id}
                          className={`scn-card${selectedScenario === s.id ? ' active' : ''}`}
                          onClick={() => setSelectedScenario(s.id)}
                        >
                          <div className="scn-name">
                            {s.name}
                            {s.period_start && (
                              <span
                                style={{
                                  marginLeft: 8,
                                  fontSize: 10,
                                  color: selectedScenario === s.id ? 'rgba(251,247,238,0.7)' : 'var(--ink-4)',
                                  fontFamily: 'var(--mono)',
                                }}
                              >
                                {s.period_start.slice(0, 7)} – {s.period_end?.slice(0, 7)}
                              </span>
                            )}
                          </div>
                          <div className="scn-desc">{s.description}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Parametric */}
                {parametricScenarios.length > 0 && (
                  <div>
                    <div
                      style={{
                        fontSize: 10,
                        color: 'var(--ink-4)',
                        textTransform: 'uppercase',
                        letterSpacing: '0.08em',
                        marginBottom: 8,
                        fontFamily: 'var(--mono)',
                      }}
                    >
                      Параметрические стрессы
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                      {parametricScenarios.map((s) => (
                        <div
                          key={s.id}
                          className={`scn-card${selectedScenario === s.id ? ' active' : ''}`}
                          onClick={() => setSelectedScenario(s.id)}
                        >
                          <div className="scn-name">
                            {s.name}
                            {s.vol_multiplier != null && (
                              <span
                                style={{
                                  marginLeft: 8,
                                  fontSize: 10,
                                  color: selectedScenario === s.id ? 'rgba(251,247,238,0.7)' : 'var(--ink-4)',
                                  fontFamily: 'var(--mono)',
                                }}
                              >
                                vol ×{s.vol_multiplier}
                              </span>
                            )}
                          </div>
                          <div className="scn-desc">{s.description}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Custom scenario card */}
            <div>
              <div
                style={{
                  fontSize: 10,
                  color: 'var(--ink-4)',
                  textTransform: 'uppercase',
                  letterSpacing: '0.08em',
                  marginBottom: 8,
                  fontFamily: 'var(--mono)',
                }}
              >
                Пользовательский
              </div>
              <div
                className={`scn-card${selectedScenario === 'custom' ? ' active' : ''}`}
                onClick={() => setSelectedScenario((prev) => (prev === 'custom' ? null : 'custom'))}
              >
                <div className="scn-name">Пользовательский сценарий</div>
                <div className="scn-desc">Задайте параметры стресса вручную</div>
                {selectedScenario === 'custom' && (
                  <div
                    style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 12 }}
                    onClick={(e) => e.stopPropagation()}
                  >
                    <div>
                      <div
                        style={{
                          display: 'flex',
                          justifyContent: 'space-between',
                          fontSize: 11,
                          color: 'rgba(251,247,238,0.85)',
                          fontFamily: 'var(--mono)',
                          marginBottom: 4,
                        }}
                      >
                        <span>vol_multiplier</span>
                        <span>×{customVolMultiplier.toFixed(1)}</span>
                      </div>
                      <input
                        type="range"
                        min={1}
                        max={10}
                        step={0.5}
                        value={customVolMultiplier}
                        onChange={(e) => setCustomVolMultiplier(Number(e.target.value))}
                        style={{ width: '100%', accentColor: '#FBF7EE' }}
                      />
                    </div>
                    <div>
                      <div
                        style={{
                          display: 'flex',
                          justifyContent: 'space-between',
                          fontSize: 11,
                          color: 'rgba(251,247,238,0.85)',
                          fontFamily: 'var(--mono)',
                          marginBottom: 4,
                        }}
                      >
                        <span>corr_shock</span>
                        <span>{customCorrShock.toFixed(2)}</span>
                      </div>
                      <input
                        type="range"
                        min={0}
                        max={1}
                        step={0.05}
                        value={customCorrShock}
                        onChange={(e) => setCustomCorrShock(Number(e.target.value))}
                        style={{ width: '100%', accentColor: '#FBF7EE' }}
                      />
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Run parameters */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div className="card">
              <div className="card-head">
                <div className="card-title">Параметры расчёта</div>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                <div>
                  <div
                    style={{
                      fontSize: 11,
                      color: 'var(--ink-4)',
                      marginBottom: 8,
                      textTransform: 'uppercase',
                      letterSpacing: '0.06em',
                      fontFamily: 'var(--mono)',
                    }}
                  >
                    Уровень доверия (α)
                  </div>
                  <div className="row" style={{ gap: 6 }}>
                    {[0.95, 0.99, 0.999].map((a) => (
                      <button
                        key={a}
                        className={alpha === a ? 'btn-primary' : 'btn-secondary'}
                        style={{ fontSize: 12 }}
                        onClick={() => setAlpha(a)}
                      >
                        {(a * 100).toFixed(1)}%
                      </button>
                    ))}
                  </div>
                </div>
                <div>
                  <div
                    style={{
                      fontSize: 11,
                      color: 'var(--ink-4)',
                      marginBottom: 8,
                      textTransform: 'uppercase',
                      letterSpacing: '0.06em',
                      fontFamily: 'var(--mono)',
                    }}
                  >
                    Симуляций
                  </div>
                  <div className="row" style={{ gap: 6 }}>
                    {[10_000, 50_000, 100_000].map((n) => (
                      <button
                        key={n}
                        className={nSim === n ? 'btn-primary' : 'btn-secondary'}
                        style={{ fontSize: 12 }}
                        onClick={() => setNSim(n)}
                      >
                        {n.toLocaleString()}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </div>

            {/* Quick info about selected scenario */}
            {selectedScenario && (() => {
              if (selectedScenario === 'custom') {
                return (
                  <div className="card" style={{ background: 'var(--primary-soft)', border: '1px solid var(--primary)' }}>
                    <div style={{ fontSize: 11, color: 'var(--primary)', fontFamily: 'var(--mono)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 6 }}>
                      Выбранный сценарий
                    </div>
                    <div style={{ fontWeight: 600, fontSize: 13, color: 'var(--primary-ink)', marginBottom: 4 }}>Пользовательский</div>
                    <div style={{ fontSize: 11, color: 'var(--ink-4)', fontFamily: 'var(--mono)', marginTop: 6 }}>
                      vol ×{customVolMultiplier.toFixed(1)} · corr_shock {customCorrShock.toFixed(2)}
                    </div>
                  </div>
                );
              }
              const s = scenarios.find((x) => x.id === selectedScenario);
              if (!s) return null;
              return (
                <div className="card" style={{ background: 'var(--primary-soft)', border: '1px solid var(--primary)' }}>
                  <div style={{ fontSize: 11, color: 'var(--primary)', fontFamily: 'var(--mono)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 6 }}>
                    Выбранный сценарий
                  </div>
                  <div style={{ fontWeight: 600, fontSize: 13, color: 'var(--primary-ink)', marginBottom: 4 }}>{s.name}</div>
                  <div style={{ fontSize: 11, color: 'var(--ink-3)', lineHeight: 1.5 }}>{s.description}</div>
                  {s.type === 'historical' && s.period_start && (
                    <div style={{ fontSize: 11, color: 'var(--ink-4)', fontFamily: 'var(--mono)', marginTop: 6 }}>
                      Период: {s.period_start} — {s.period_end}
                    </div>
                  )}
                  {s.type === 'parametric' && s.vol_multiplier != null && (
                    <div style={{ fontSize: 11, color: 'var(--ink-4)', fontFamily: 'var(--mono)', marginTop: 6 }}>
                      vol ×{s.vol_multiplier} · corr_shock {s.corr_shock}
                    </div>
                  )}
                </div>
              );
            })()}
          </div>
        </div>

        {/* Results table */}
        {results.length > 0 && (
          <div className="card">
            <div className="card-head">
              <div className="card-title">История расчётов</div>
              <span style={{ fontSize: 11, color: 'var(--ink-4)', fontFamily: 'var(--mono)' }}>
                {results.length} запусков
              </span>
            </div>
            <table className="data-table">
              <thead>
                <tr>
                  <th>Портфель</th>
                  <th>Сценарий</th>
                  <th>Тип</th>
                  <th style={{ textAlign: 'right' }}>Stressed VaR</th>
                  <th style={{ textAlign: 'right' }}>Stressed CVaR</th>
                  <th style={{ textAlign: 'right' }}>Max Drawdown</th>
                  <th style={{ textAlign: 'right' }}>Худший день</th>
                  <th style={{ textAlign: 'right' }}>P1</th>
                  <th style={{ textAlign: 'right' }}>P10</th>
                  <th>Статус</th>
                </tr>
              </thead>
              <tbody>
                {results.map((r, i) => (
                  <tr key={i}>
                    <td style={{ fontSize: 12, color: 'var(--ink-3)' }}>{r.portfolioName}</td>
                    <td style={{ fontWeight: 500 }}>{r.scenarioName}</td>
                    <td>
                      <Pill variant={variantForType(r.scenarioType)}>
                        {r.scenarioType === 'historical' ? 'Исторический' : 'Параметрический'}
                      </Pill>
                    </td>
                    {r.loading ? (
                      <td colSpan={6}>
                        <Skeleton height={16} />
                      </td>
                    ) : r.error ? (
                      <td colSpan={6} style={{ color: 'var(--crit)', fontSize: 12 }}>
                        {r.error}
                      </td>
                    ) : r.result ? (
                      <>
                        <td style={{ textAlign: 'right' }} className="mono">
                          {pct(r.result.stressed_var, 3)}
                        </td>
                        <td style={{ textAlign: 'right' }} className="mono">
                          {pct(r.result.stressed_cvar, 3)}
                        </td>
                        <td
                          style={{
                            textAlign: 'right',
                            color:
                              r.result.max_drawdown < -0.2
                                ? 'var(--crit)'
                                : r.result.max_drawdown < -0.1
                                ? 'var(--warn)'
                                : undefined,
                          }}
                          className="mono"
                        >
                          {pct(r.result.max_drawdown, 2)}
                        </td>
                        <td style={{ textAlign: 'right', color: 'var(--crit)' }} className="mono">
                          {pct(r.result.worst_day, 2)}
                        </td>
                        <td style={{ textAlign: 'right' }} className="mono">
                          {pct(r.result.p1_return, 2)}
                        </td>
                        <td style={{ textAlign: 'right' }} className="mono">
                          {pct(r.result.p10_return, 2)}
                        </td>
                      </>
                    ) : (
                      <td colSpan={6} style={{ color: 'var(--ink-4)' }}>
                        —
                      </td>
                    )}
                    <td>
                      {r.loading ? (
                        <Pill variant="warn">Расчёт…</Pill>
                      ) : r.error ? (
                        <Pill variant="crit">Ошибка</Pill>
                      ) : (
                        <Pill variant="good">OK</Pill>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Empty state */}
        {results.length === 0 && !portfoliosLoading && !scenariosLoading && (
          <div className="empty-state" style={{ marginTop: 40 }}>
            <div>Выберите сценарий и нажмите «Запустить».</div>
            <div style={{ marginTop: 4, fontSize: 12, color: 'var(--ink-4)' }}>
              Доступно {scenarios.length + 1} сценариев: {historicalScenarios.length} исторических + {parametricScenarios.length} параметрических + 1 пользовательский.
            </div>
          </div>
        )}
      </div>
    </>
  );
}
