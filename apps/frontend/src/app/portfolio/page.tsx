'use client';

import React, { useEffect, useState, useCallback, useRef } from 'react';
import { Topbar, PageHead, Pill, ErrorBanner, Skeleton } from '@/components/Shell';
import { LineChart, Donut, type LineSeries } from '@/components/Charts';
import {
  portfolioApi,
  inferenceApi,
  extractMetric,
  groupByMetric,
  type Portfolio,
  type Position,
  type RiskResult,
  type PredictResponse,
} from '@/lib/api';

const COLORS = ['var(--primary)', 'var(--accent)', '#6b8f71', '#c9a96e', '#8b6f47', '#4a6b3e'];

// ── Metric Tooltip ────────────────────────────────────────────────────────────

interface MetricInfo {
  description: string;
  interpretation: string;
}

const METRIC_INFO: Record<string, MetricInfo> = {
  'VaR (95%)': {
    description: 'Value at Risk — максимальный ожидаемый убыток портфеля за 1 день с вероятностью 95%.',
    interpretation: 'Например, VaR 2% означает: в 95% случаев дневной убыток не превысит 2%. Чем меньше — тем ниже риск.',
  },
  'CVaR (95%)': {
    description: 'Conditional VaR (Expected Shortfall) — средний убыток в худших 5% сценариев.',
    interpretation: 'CVaR всегда ≥ VaR. Более консервативная мера риска — показывает средний убыток при экстремальных событиях.',
  },
  'Волатильность': {
    description: 'Стандартное отклонение дневных доходностей (аннуализированное).',
    interpretation: '< 10% — низкая, 10–20% — умеренная, > 20% — высокая.',
  },
  'Max Drawdown': {
    description: 'Максимальная просадка — наибольшее падение от пика до дна за всю историю.',
    interpretation: '> −10% — хорошо, −10%…−20% — умеренно, < −20% — высокий риск.',
  },
  'Sharpe': {
    description: 'Коэффициент Шарпа — отношение избыточной доходности к волатильности (rf = 0).',
    interpretation: '≥ 1 — хорошо, 0–1 — приемлемо, < 0 — портфель хуже безрискового актива.',
  },
  'Sortino': {
    description: 'Коэффициент Сортино — как Sharpe, но учитывает только нисходящую волатильность.',
    interpretation: '≥ 1 — хорошо, 0–1 — приемлемо, < 0 — убыточный портфель.',
  },
  'Beta (β)': {
    description: 'Бета — чувствительность портфеля к движениям рынка.',
    interpretation: 'β < 1 — защитный, β ≈ 1 — следует рынку, β > 1 — агрессивный.',
  },
  'Сумма весов': {
    description: 'Сумма весов всех позиций в портфеле.',
    interpretation: 'Должна быть равна 100% для полностью инвестированного портфеля.',
  },
};

function MetricTooltip({ label }: { label: string }) {
  const info = METRIC_INFO[label];
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  if (!info) return null;

  return (
    <div ref={ref} style={{ position: 'relative', display: 'inline-flex' }}>
      <button
        onClick={(e) => { e.stopPropagation(); setOpen((v) => !v); }}
        style={{
          background: 'var(--bg-2)',
          border: '1px solid var(--hair-strong)',
          borderRadius: '50%',
          width: 14,
          height: 14,
          fontSize: 9,
          cursor: 'pointer',
          color: 'var(--ink-3)',
          padding: 0,
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexShrink: 0,
        }}
        title="Подробнее"
      >
        ?
      </button>
      {open && (
        <div style={{
          position: 'fixed',
          width: 260,
          background: '#FFFFFF',
          border: '1px solid #CCCCCC',
          borderRadius: 8,
          padding: '12px 14px',
          boxShadow: '0 8px 32px rgba(0,0,0,0.18), 0 2px 8px rgba(0,0,0,0.10)',
          zIndex: 9999,
          fontSize: 11,
          lineHeight: 1.55,
          opacity: 1,
          // Position below the ? button using JS-free approach via transform
          top: (() => {
            if (typeof window === 'undefined') return 0;
            const el = ref.current;
            if (!el) return 0;
            const rect = el.getBoundingClientRect();
            return rect.bottom + 6;
          })(),
          left: (() => {
            if (typeof window === 'undefined') return 0;
            const el = ref.current;
            if (!el) return 0;
            const rect = el.getBoundingClientRect();
            return Math.max(8, Math.min(rect.left - 120, window.innerWidth - 276));
          })(),
        }}>
          <div style={{ fontWeight: 700, marginBottom: 5, color: '#111111', fontSize: 12 }}>{label}</div>
          <div style={{ color: '#333333', marginBottom: 8 }}>{info.description}</div>
          <div style={{ color: '#666666', borderTop: '1px solid #E4E4E4', paddingTop: 8 }}>
            <span style={{ fontWeight: 600, color: '#333333' }}>Интерпретация: </span>
            {info.interpretation}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Create Portfolio Modal ────────────────────────────────────────────────────

interface CreatePortfolioModalProps {
  onClose: () => void;
  onCreate: (p: Portfolio) => void;
}

function CreatePortfolioModal({ onClose, onCreate }: CreatePortfolioModalProps) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [currency, setCurrency] = useState('USD');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const handleCreate = async () => {
    if (!name.trim()) { setErr('Название обязательно'); return; }
    setSaving(true);
    setErr(null);
    try {
      const p = await portfolioApi.create({ name: name.trim(), description: description.trim(), currency });
      onCreate(p);
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : 'Ошибка создания');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 1000,
      background: 'rgba(0,0,0,0.45)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
    }} onClick={onClose}>
      <div
        style={{
          background: '#FFFFFF',
          border: '1px solid #CCCCCC',
          borderRadius: 10,
          padding: 28,
          width: 420,
          boxShadow: '0 8px 40px rgba(0,0,0,0.3)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 20 }}>Новый портфель</div>

        {err && (
          <div style={{ background: 'var(--crit-soft)', color: 'var(--crit)', borderRadius: 6, padding: '8px 12px', fontSize: 12, marginBottom: 14 }}>
            {err}
          </div>
        )}

        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div>
            <div style={{ fontSize: 11, color: 'var(--ink-3)', marginBottom: 4 }}>Название *</div>
            <input
              className="input"
              placeholder="Мой портфель"
              value={name}
              onChange={(e) => setName(e.target.value)}
              style={{ width: '100%' }}
              autoFocus
            />
          </div>
          <div>
            <div style={{ fontSize: 11, color: 'var(--ink-3)', marginBottom: 4 }}>Описание</div>
            <input
              className="input"
              placeholder="Необязательно"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              style={{ width: '100%' }}
            />
          </div>
          <div>
            <div style={{ fontSize: 11, color: 'var(--ink-3)', marginBottom: 4 }}>Валюта</div>
            <select
              className="input"
              value={currency}
              onChange={(e) => setCurrency(e.target.value)}
              style={{ width: '100%' }}
            >
              <option value="USD">USD</option>
              <option value="RUB">RUB</option>
              <option value="EUR">EUR</option>
            </select>
          </div>
        </div>

        <div className="row" style={{ gap: 10, marginTop: 24, justifyContent: 'flex-end' }}>
          <button className="btn-secondary" onClick={onClose} disabled={saving}>Отмена</button>
          <button className="btn-primary" onClick={handleCreate} disabled={saving || !name.trim()}>
            {saving ? 'Создаём…' : 'Создать'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function PortfolioPage() {
  const [portfolios, setPortfolios] = useState<Portfolio[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [positions, setPositions] = useState<Position[]>([]);
  const [latestRisk, setLatestRisk] = useState<RiskResult[]>([]);
  const [riskHistory, setRiskHistory] = useState<RiskResult[]>([]);
  const [predictResult, setPredictResult] = useState<PredictResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [dataLoading, setDataLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // New position form
  const [newSymbol, setNewSymbol] = useState('');
  const [newWeight, setNewWeight] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState<string | null>(null);

  // Create portfolio modal
  const [showCreateModal, setShowCreateModal] = useState(false);

  const refreshPortfolios = useCallback(async () => {
    const ps = await portfolioApi.list();
    setPortfolios(ps);
    return ps;
  }, []);

  useEffect(() => {
    portfolioApi.list()
      .then((ps) => {
        setPortfolios(ps);
        if (ps.length > 0) setSelectedId(ps[0].id);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  const loadData = useCallback(async (id: number) => {
    setDataLoading(true);
    try {
      const [pos, latest, history] = await Promise.all([
        portfolioApi.listPositions(id),
        portfolioApi.getLatestRisk(id),
        portfolioApi.getRiskHistory(id, 90),
      ]);
      setPositions(pos);
      setLatestRisk(latest);
      setRiskHistory(history);

      try {
        const pred = await inferenceApi.predict({ portfolio_id: id });
        setPredictResult(pred);
      } catch {
        setPredictResult(null);
      }
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Ошибка загрузки');
    } finally {
      setDataLoading(false);
    }
  }, []);

  useEffect(() => {
    if (selectedId !== null) loadData(selectedId);
  }, [selectedId, loadData]);

  const handleAddPosition = async () => {
    if (!selectedId || !newSymbol || !newWeight) return;
    setSaving(true);
    setSaveMsg(null);
    try {
      await portfolioApi.upsertPosition(selectedId, {
        symbol: newSymbol.toUpperCase(),
        weight: parseFloat(newWeight),
      });
      setSaveMsg(`Позиция ${newSymbol.toUpperCase()} сохранена`);
      setNewSymbol('');
      setNewWeight('');
      await loadData(selectedId);
    } catch (e: unknown) {
      setSaveMsg(e instanceof Error ? `Ошибка: ${e.message}` : 'Ошибка сохранения');
    } finally {
      setSaving(false);
    }
  };

  const handleDeletePosition = async (symbol: string) => {
    if (!selectedId) return;
    try {
      await portfolioApi.deletePosition(selectedId, symbol);
      await loadData(selectedId);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Ошибка удаления');
    }
  };

  // ── Derived ───────────────────────────────────────────────────────────────

  const selectedPortfolio = portfolios.find((p) => p.id === selectedId) ?? null;
  const historyByMetric = groupByMetric(riskHistory);

  const varVal = extractMetric(latestRisk, 'var');
  const cvarVal = extractMetric(latestRisk, 'cvar');
  const volVal = extractMetric(latestRisk, 'volatility');

  const mddVal = predictResult?.max_drawdown ?? null;
  const sharpeVal = predictResult?.sharpe_ratio ?? null;
  const sortinoVal = predictResult?.sortino_ratio ?? null;
  const betaVal = predictResult?.beta_to_benchmark ?? null;

  const sharpeColor = sharpeVal === null ? 'var(--ink-4)' : sharpeVal >= 1 ? 'var(--good)' : sharpeVal >= 0 ? 'var(--warn)' : 'var(--crit)';
  const sortinoColor = sortinoVal === null ? 'var(--ink-4)' : sortinoVal >= 1 ? 'var(--good)' : sortinoVal >= 0 ? 'var(--warn)' : 'var(--crit)';
  const mddColor = mddVal === null ? 'var(--ink-4)' : mddVal > -0.1 ? 'var(--good)' : mddVal > -0.2 ? 'var(--warn)' : 'var(--crit)';
  const betaColor = betaVal === null ? 'var(--ink-4)' : betaVal >= 0.8 && betaVal <= 1.2 ? 'var(--accent)' : betaVal < 0.8 ? 'var(--good)' : 'var(--warn)';

  const chartSeries: LineSeries[] = [];
  const varSorted = (historyByMetric['var'] ?? []).sort((a, b) => a.asof_date.localeCompare(b.asof_date));
  const cvarSorted = (historyByMetric['cvar'] ?? []).sort((a, b) => a.asof_date.localeCompare(b.asof_date));
  if (varSorted.length > 0) chartSeries.push({ name: 'VaR', color: 'var(--primary)', data: varSorted.map((r) => ({ x: r.asof_date, y: r.value })) });
  if (cvarSorted.length > 0) chartSeries.push({ name: 'CVaR', color: 'var(--crit)', data: cvarSorted.map((r) => ({ x: r.asof_date, y: r.value })) });

  const donutData = positions.map((p, i) => ({
    label: p.symbol,
    value: Math.abs(p.weight),
    color: COLORS[i % COLORS.length],
  }));

  const totalWeight = positions.reduce((s, p) => s + p.weight, 0);

  const kpis = [
    { label: 'VaR (95%)', value: varVal !== null ? `${(varVal * 100).toFixed(2)}%` : null, color: 'var(--primary)' },
    { label: 'CVaR (95%)', value: cvarVal !== null ? `${(cvarVal * 100).toFixed(2)}%` : null, color: 'var(--crit)' },
    { label: 'Волатильность', value: volVal !== null ? `${(volVal * 100).toFixed(2)}%` : null, color: 'var(--ink-2)' },
    { label: 'Max Drawdown', value: mddVal !== null ? `${(mddVal * 100).toFixed(2)}%` : null, color: mddColor },
    { label: 'Sharpe', value: sharpeVal !== null ? sharpeVal.toFixed(2) : null, color: sharpeColor },
    { label: 'Sortino', value: sortinoVal !== null ? sortinoVal.toFixed(2) : null, color: sortinoColor },
    { label: 'Beta (β)', value: betaVal !== null ? betaVal.toFixed(2) : null, color: betaColor },
    { label: 'Сумма весов', value: positions.length > 0 ? `${(totalWeight * 100).toFixed(1)}%` : null, color: totalWeight > 1.01 || totalWeight < 0.99 ? 'var(--warn)' : 'var(--good)' },
  ];

  return (
    <>
      <Topbar crumbs={['RiskOps', 'Портфель']} />
      <div className="page-content">
        <PageHead
          eyebrow="УПРАВЛЕНИЕ ПОРТФЕЛЕМ"
          title="Портфель"
          sub={selectedPortfolio ? `${selectedPortfolio.name} · ${selectedPortfolio.currency}` : ''}
        >
          <button className="btn-primary" onClick={() => setShowCreateModal(true)} style={{ marginRight: 8 }}>
            + Новый портфель
          </button>
          <button className="btn-secondary" onClick={() => selectedId && loadData(selectedId)} disabled={dataLoading}>
            {dataLoading ? 'Загрузка…' : 'Обновить'}
          </button>
        </PageHead>

        {showCreateModal && (
          <CreatePortfolioModal
            onClose={() => setShowCreateModal(false)}
            onCreate={async (p) => {
              setShowCreateModal(false);
              const ps = await refreshPortfolios();
              setSelectedId(p.id);
              if (ps.length > 0) await loadData(p.id);
            }}
          />
        )}

        {error && <ErrorBanner message={error} />}
        {saveMsg && (
          <div className="error-banner" style={{ background: 'var(--good-soft)', borderColor: 'var(--good)', color: 'var(--good)' }}>
            ✓ {saveMsg}
          </div>
        )}

        {/* Portfolio selector */}
        {!loading && portfolios.length > 0 && (
          <div className="row" style={{ gap: 8, marginBottom: 20, flexWrap: 'wrap' }}>
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
            {selectedId !== null && (
              <button
                className="btn-secondary"
                style={{ fontSize: 12, color: 'var(--crit)', borderColor: 'var(--crit)', marginLeft: 'auto' }}
                onClick={async () => {
                  if (!selectedId) return;
                  if (!confirm(`Удалить портфель «${portfolios.find((p) => p.id === selectedId)?.name}»? Это действие необратимо.`)) return;
                  try {
                    await portfolioApi.delete(selectedId);
                    const ps = await refreshPortfolios();
                    setSelectedId(ps.length > 0 ? ps[0].id : null);
                    setPositions([]);
                    setLatestRisk([]);
                    setRiskHistory([]);
                    setPredictResult(null);
                  } catch (e: unknown) {
                    setError(e instanceof Error ? e.message : 'Ошибка удаления портфеля');
                  }
                }}
              >
              Удалить портфель
            </button>
            )}
          </div>
        )}

        {loading ? (
          <Skeleton height={200} />
        ) : (
          <>
            {/* KPI strip */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(8, 1fr)', gap: 10, marginBottom: 20 }}>
              {kpis.map((kpi) => (
                <div key={kpi.label} className="metric-card">
                  <div className="metric-label" style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                    <span>{kpi.label}</span>
                    <MetricTooltip label={kpi.label} />
                  </div>
                  {dataLoading ? <Skeleton height={24} width="60%" /> : (
                    <div className="metric-value" style={{ color: kpi.value ? kpi.color : 'var(--ink-4)', fontSize: kpi.value ? 22 : 16 }}>
                      {kpi.value ?? '—'}
                    </div>
                  )}
                </div>
              ))}
            </div>

            <div className="grid-2" style={{ gap: 20, marginBottom: 20 }}>
              {/* Positions table */}
              <div className="card">
                <div className="card-head">
                  <div className="card-title">Позиции</div>
                  <Pill variant={positions.length > 0 ? 'good' : ''}>{positions.length} позиций</Pill>
                </div>

                {dataLoading ? <Skeleton height={140} /> : positions.length > 0 ? (
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>Тикер</th>
                        <th style={{ textAlign: 'right' }}>Вес</th>
                        <th>Обновлено</th>
                        <th></th>
                      </tr>
                    </thead>
                    <tbody>
                      {positions.map((p, i) => (
                        <tr key={p.symbol}>
                          <td>
                            <div className="row" style={{ gap: 6 }}>
                              <div style={{ width: 8, height: 8, borderRadius: '50%', background: COLORS[i % COLORS.length], flexShrink: 0 }} />
                              <span className="mono">{p.symbol}</span>
                            </div>
                          </td>
                          <td style={{ textAlign: 'right' }} className="mono">{(p.weight * 100).toFixed(1)}%</td>
                          <td style={{ fontSize: 11, color: 'var(--ink-4)' }}>{p.updated_at.slice(0, 10)}</td>
                          <td>
                            <button
                              style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--crit)', fontSize: 12 }}
                              onClick={() => handleDeletePosition(p.symbol)}
                            >
                              ✕
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                ) : (
                  <div className="empty-state">Нет позиций</div>
                )}

                {/* Add position form */}
                <div style={{ borderTop: '1px solid var(--hair)', paddingTop: 12, marginTop: 12 }}>
                  <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--ink-3)', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                    Добавить позицию
                  </div>
                  <div className="row" style={{ gap: 8 }}>
                    <input
                      className="input"
                      placeholder="Тикер (AAPL)"
                      value={newSymbol}
                      onChange={(e) => setNewSymbol(e.target.value)}
                      style={{ flex: 1 }}
                    />
                    <input
                      className="input"
                      placeholder="Вес (0.25)"
                      type="number"
                      step="0.01"
                      min="0"
                      max="1"
                      value={newWeight}
                      onChange={(e) => setNewWeight(e.target.value)}
                      style={{ width: 100 }}
                    />
                    <button className="btn-primary" onClick={handleAddPosition} disabled={saving || !newSymbol || !newWeight}>
                      {saving ? '…' : 'Добавить'}
                    </button>
                  </div>
                </div>
              </div>

              {/* Donut */}
              <div className="card">
                <div className="card-head">
                  <div className="card-title">Аллокация</div>
                </div>
                {dataLoading ? <Skeleton height={200} /> : donutData.length > 0 ? (
                  <div className="row" style={{ gap: 20, alignItems: 'center', justifyContent: 'center', padding: '12px 0' }}>
                    <Donut data={donutData} size={180} />
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                      {donutData.map((d) => (
                        <div key={d.label} className="row" style={{ gap: 6 }}>
                          <div style={{ width: 10, height: 10, borderRadius: '50%', background: d.color, flexShrink: 0 }} />
                          <span className="mono" style={{ fontSize: 12 }}>{d.label}</span>
                          <span style={{ fontSize: 11, color: 'var(--ink-4)' }}>{(d.value * 100).toFixed(1)}%</span>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : (
                  <div className="empty-state">Нет данных</div>
                )}
              </div>
            </div>

            {/* Risk history chart */}
            {chartSeries.length > 0 && (
              <div className="card">
                <div className="card-head">
                  <div className="card-title">История риска (90 дней)</div>
                  <div className="row" style={{ gap: 12 }}>
                    {chartSeries.map((s) => (
                      <div key={s.name} className="row" style={{ gap: 4 }}>
                        <div style={{ width: 10, height: 2, background: s.color }} />
                        <span style={{ fontSize: 11, color: 'var(--ink-3)' }}>{s.name}</span>
                      </div>
                    ))}
                  </div>
                </div>
                <LineChart
                  series={chartSeries}
                  height={200}
                  yFormat={(v) => `${(v * 100).toFixed(1)}%`}
                  xFormat={(v) => String(v).slice(5)}
                  fillArea
                />
              </div>
            )}
          </>
        )}
      </div>
    </>
  );
}
