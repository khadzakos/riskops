'use client';

import React, { useEffect, useState, useCallback, useRef } from 'react';
import { Topbar, PageHead, Pill, ErrorBanner, Skeleton } from '@/components/Shell';
import { LineChart, Donut, Heatmap, type LineSeries } from '@/components/Charts';
import {
  portfolioApi,
  inferenceApi,
  marketDataApi,
  extractMetric,
  groupByMetric,
  type Portfolio,
  type Position,
  type RiskResult,
  type PredictResponse,
  type CorrelationMatrixResponse,
  type PriceChartResponse,
} from '@/lib/api';

const COLORS = ['var(--primary)', 'var(--accent)', '#6b8f71', '#c9a96e', '#8b6f47', '#4a6b3e', '#7b5ea7', '#c96e6e'];

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

// ── Correlation Matrix Component ──────────────────────────────────────────────

function CorrelationMatrixCard({
  portfolioId,
  positions,
}: {
  portfolioId: number;
  positions: Position[];
}) {
  const [data, setData] = useState<CorrelationMatrixResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lookback, setLookback] = useState(252);

  const load = useCallback(async () => {
    if (positions.length < 2) return;
    setLoading(true);
    setError(null);
    try {
      const result = await inferenceApi.getCorrelationMatrix(portfolioId, lookback);
      setData(result);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Ошибка загрузки матрицы корреляций');
    } finally {
      setLoading(false);
    }
  }, [portfolioId, positions.length, lookback]);

  useEffect(() => {
    load();
  }, [load]);

  if (positions.length < 2) {
    return (
      <div className="card">
        <div className="card-head">
          <div className="card-title">Матрица корреляций</div>
        </div>
        <div className="empty-state">Добавьте минимум 2 позиции для расчёта корреляций</div>
      </div>
    );
  }

  return (
    <div className="card">
      <div className="card-head">
        <div className="card-title">Матрица корреляций</div>
        <div className="row" style={{ gap: 8, alignItems: 'center' }}>
          <select
            className="input"
            value={lookback}
            onChange={(e) => setLookback(Number(e.target.value))}
            style={{ fontSize: 11, padding: '3px 6px', height: 26 }}
          >
            <option value={63}>3 мес</option>
            <option value={126}>6 мес</option>
            <option value={252}>1 год</option>
            <option value={504}>2 года</option>
          </select>
          <button className="btn-secondary" onClick={load} disabled={loading} style={{ fontSize: 11, padding: '3px 10px', height: 26 }}>
            {loading ? '…' : 'Обновить'}
          </button>
        </div>
      </div>

      {error && (
        <div style={{ color: 'var(--crit)', fontSize: 12, padding: '8px 0' }}>{error}</div>
      )}

      {loading ? (
        <Skeleton height={200} />
      ) : data && data.symbols.length >= 2 ? (
        <div style={{ overflowX: 'auto' }}>
          <Heatmap labels={data.symbols} matrix={data.matrix} />
          <div style={{ fontSize: 10, color: 'var(--ink-4)', marginTop: 6, textAlign: 'right' }}>
            Pearson · {data.lookback_days} торговых дней · {data.computed_at.slice(0, 10)}
          </div>
        </div>
      ) : (
        <div className="empty-state">Недостаточно данных для расчёта корреляций</div>
      )}
    </div>
  );
}

// ── Unified Price Chart Component ─────────────────────────────────────────────

function UnifiedPriceChartCard({
  positions,
}: {
  positions: Position[];
}) {
  const [data, setData] = useState<PriceChartResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [period, setPeriod] = useState<'3m' | '6m' | '1y' | '2y' | '5y'>('1y');

  const periodToDateFrom = (p: string): string => {
    const now = new Date();
    switch (p) {
      case '3m': now.setMonth(now.getMonth() - 3); break;
      case '6m': now.setMonth(now.getMonth() - 6); break;
      case '1y': now.setFullYear(now.getFullYear() - 1); break;
      case '2y': now.setFullYear(now.getFullYear() - 2); break;
      case '5y': now.setFullYear(now.getFullYear() - 5); break;
    }
    return now.toISOString().slice(0, 10);
  };

  const load = useCallback(async () => {
    if (positions.length === 0) return;
    setLoading(true);
    setError(null);
    try {
      const symbols = positions.map((p) => p.symbol);
      const result = await marketDataApi.getPriceChart({
        symbols,
        date_from: periodToDateFrom(period),
        normalized: false,
      });
      setData(result);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Ошибка загрузки графика цен');
    } finally {
      setLoading(false);
    }
  }, [positions, period]);

  useEffect(() => {
    load();
  }, [load]);

  if (positions.length === 0) {
    return (
      <div className="card">
        <div className="card-head">
          <div className="card-title">Динамика цен</div>
        </div>
        <div className="empty-state">Добавьте позиции для отображения графика</div>
      </div>
    );
  }

  // Build LineSeries from price chart data — always use raw close prices
  const chartSeries: LineSeries[] = [];
  if (data?.series) {
    data.series.forEach((s, i) => {
      if (s.points.length > 0) {
        chartSeries.push({
          name: s.symbol,
          color: COLORS[i % COLORS.length],
          data: s.points.map((p) => ({ x: p.date, y: p.raw })),
        });
      }
    });
  }

  return (
    <div className="card">
      <div className="card-head">
        <div className="card-title">Динамика цен</div>
        <div className="row" style={{ gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          {/* Period selector */}
          {(['3m', '6m', '1y', '2y', '5y'] as const).map((p) => (
            <button
              key={p}
              onClick={() => setPeriod(p)}
              style={{
                fontSize: 11,
                padding: '2px 8px',
                height: 24,
                background: period === p ? 'var(--primary)' : 'var(--bg-2)',
                color: period === p ? '#fff' : 'var(--ink-2)',
                border: `1px solid ${period === p ? 'var(--primary)' : 'var(--hair-strong)'}`,
                borderRadius: 4,
                cursor: 'pointer',
              }}
            >
              {p}
            </button>
          ))}
          <button className="btn-secondary" onClick={load} disabled={loading} style={{ fontSize: 11, padding: '3px 10px', height: 26 }}>
            {loading ? '…' : '↺'}
          </button>
        </div>
      </div>

      {/* Legend */}
      {chartSeries.length > 0 && (
        <div className="row" style={{ gap: 14, marginBottom: 8, flexWrap: 'wrap' }}>
          {chartSeries.map((s) => (
            <div key={s.name} className="row" style={{ gap: 5 }}>
              <div style={{ width: 12, height: 2, background: s.color, marginTop: 6 }} />
              <span className="mono" style={{ fontSize: 11, color: 'var(--ink-2)' }}>{s.name}</span>
            </div>
          ))}
        </div>
      )}

      {error && (
        <div style={{ color: 'var(--crit)', fontSize: 12, padding: '8px 0' }}>{error}</div>
      )}

      {loading ? (
        <Skeleton height={240} />
      ) : chartSeries.length > 0 ? (
        <LineChart
          series={chartSeries}
          height={240}
          yFormat={(v) => `$${v.toFixed(2)}`}
          xFormat={(v) => String(v).slice(5)}
          xTicks={8}
        />
      ) : (
        <div className="empty-state">Нет данных о ценах для выбранного периода</div>
      )}

      {data && (
        <div style={{ fontSize: 10, color: 'var(--ink-4)', marginTop: 4, textAlign: 'right' }}>
          Цены закрытия · {data.date_from} — {data.date_to}
        </div>
      )}
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
  const [newQuantity, setNewQuantity] = useState('');
  const [newPrice, setNewPrice] = useState('');
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
      // Load positions first (needed for charts)
      const pos = await portfolioApi.listPositions(id);
      setPositions(pos);

      // Run prediction first — this stores results to DB so history is up-to-date
      let pred: import('@/lib/api').PredictResponse | null = null;
      try {
        pred = await inferenceApi.predict({ portfolio_id: id });
        setPredictResult(pred);
      } catch {
        setPredictResult(null);
      }

      // Now load risk data (history will include the just-stored prediction)
      const [latest, history] = await Promise.all([
        portfolioApi.getLatestRisk(id),
        portfolioApi.getRiskHistory(id, 500),
      ]);
      setLatestRisk(latest);
      setRiskHistory(history);
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
    if (!selectedId || !newSymbol || !newQuantity) return;
    const qty = parseFloat(newQuantity);
    if (isNaN(qty) || qty <= 0) {
      setSaveMsg('Ошибка: количество должно быть положительным числом');
      return;
    }
    // Price is optional — if provided, validate it; if empty, backend auto-fetches market price
    let prc: number | undefined;
    if (newPrice.trim() !== '') {
      const parsed = parseFloat(newPrice);
      if (isNaN(parsed) || parsed <= 0) {
        setSaveMsg('Ошибка: цена должна быть положительным числом');
        return;
      }
      prc = parsed;
    }
    setSaving(true);
    setSaveMsg(null);
    try {
      await portfolioApi.upsertPosition(selectedId, {
        symbol: newSymbol.toUpperCase(),
        quantity: qty,
        ...(prc !== undefined ? { price: prc } : {}),
      });
      const priceLabel = prc !== undefined ? ` × $${prc.toFixed(2)}` : ' (цена — рыночная)';
      setSaveMsg(`Позиция ${newSymbol.toUpperCase()} сохранена (${qty} шт.${priceLabel})`);
      setNewSymbol('');
      setNewQuantity('');
      setNewPrice('');
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

  const varVal = predictResult?.var ?? extractMetric(latestRisk, 'var');
  const cvarVal = predictResult?.cvar ?? extractMetric(latestRisk, 'cvar');
  const volVal = predictResult?.volatility ?? extractMetric(latestRisk, 'volatility');

  const mddVal = predictResult?.max_drawdown ?? null;
  const sharpeVal = predictResult?.sharpe_ratio ?? null;
  const sortinoVal = predictResult?.sortino_ratio ?? null;
  const betaVal = predictResult?.beta_to_benchmark ?? null;

  const sharpeColor = sharpeVal === null ? 'var(--ink-4)' : sharpeVal >= 1 ? 'var(--good)' : sharpeVal >= 0 ? 'var(--warn)' : 'var(--crit)';
  const sortinoColor = sortinoVal === null ? 'var(--ink-4)' : sortinoVal >= 1 ? 'var(--good)' : sortinoVal >= 0 ? 'var(--warn)' : 'var(--crit)';
  const mddColor = mddVal === null ? 'var(--ink-4)' : mddVal > -0.1 ? 'var(--good)' : mddVal > -0.2 ? 'var(--warn)' : 'var(--crit)';
  const betaColor = betaVal === null ? 'var(--ink-4)' : betaVal >= 0.8 && betaVal <= 1.2 ? 'var(--accent)' : betaVal < 0.8 ? 'var(--good)' : 'var(--warn)';

  // Build risk history chart series.
  // riskHistory is ordered by created_at DESC (newest first).
  // For each metric, keep only the latest entry per asof_date, then sort ASC for the chart.
  const dedupeByDate = (entries: RiskResult[]): RiskResult[] => {
    const seen = new Map<string, RiskResult>();
    // entries are newest-first; first occurrence of each date wins (= most recent run)
    for (const e of entries) {
      if (!seen.has(e.asof_date)) seen.set(e.asof_date, e);
    }
    return Array.from(seen.values()).sort((a, b) => a.asof_date.localeCompare(b.asof_date));
  };

  const riskChartSeries: LineSeries[] = [];
  const varSorted = dedupeByDate(historyByMetric['var'] ?? []);
  const cvarSorted = dedupeByDate(historyByMetric['cvar'] ?? []);
  if (varSorted.length > 0) riskChartSeries.push({ name: 'VaR', color: 'var(--primary)', data: varSorted.map((r) => ({ x: r.asof_date, y: r.value })) });
  if (cvarSorted.length > 0) riskChartSeries.push({ name: 'CVaR', color: 'var(--crit)', data: cvarSorted.map((r) => ({ x: r.asof_date, y: r.value })) });

  const donutData = positions.map((p, i) => ({
    label: p.symbol,
    value: Math.abs(p.weight),
    color: COLORS[i % COLORS.length],
  }));

  const totalWeight = positions.reduce((s, p) => s + p.weight, 0);

  // ── Portfolio value tracking ───────────────────────────────────────────────
  // initialValue: sum of (quantity × purchase price) for all positions
  // currentValue: sum of (quantity × current_price) for positions that have market data
  const initialValue = positions.reduce((s, p) => {
    if (p.quantity > 0 && p.price > 0) return s + p.quantity * p.price;
    return s;
  }, 0);

  const currentValue = positions.reduce((s, p) => {
    const mktPrice = p.current_price ?? 0;
    if (p.quantity > 0 && mktPrice > 0) return s + p.quantity * mktPrice;
    // Fall back to purchase price if no market data available
    if (p.quantity > 0 && p.price > 0) return s + p.quantity * p.price;
    return s;
  }, 0);

  const valueChange = currentValue - initialValue;
  const valueChangePct = initialValue > 0 ? (valueChange / initialValue) * 100 : 0;
  const hasMarketPrices = positions.some((p) => (p.current_price ?? 0) > 0);

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
          <div style={{
            background: saveMsg.startsWith('Ошибка') ? 'var(--crit-soft)' : 'var(--good-soft)',
            color: saveMsg.startsWith('Ошибка') ? 'var(--crit)' : 'var(--good)',
            borderRadius: 6,
            padding: '8px 14px',
            fontSize: 12,
            marginBottom: 8,
          }}>
            {saveMsg}
          </div>
        )}

        {/* ── Portfolio selector ─────────────────────────────────────── */}
        {loading ? (
          <Skeleton height={40} />
        ) : portfolios.length === 0 ? (
          <div className="card" style={{ textAlign: 'center', padding: 32 }}>
            <div style={{ fontSize: 14, color: 'var(--ink-3)', marginBottom: 12 }}>
              Нет портфелей. Создайте первый портфель.
            </div>
            <button className="btn-primary" onClick={() => setShowCreateModal(true)}>
              + Создать портфель
            </button>
          </div>
        ) : (
          <div className="row" style={{ gap: 8, flexWrap: 'wrap', marginBottom: 4 }}>
            {portfolios.map((p) => (
              <button
                key={p.id}
                onClick={() => setSelectedId(p.id)}
                style={{
                  padding: '6px 16px',
                  borderRadius: 20,
                  border: `1px solid ${selectedId === p.id ? 'var(--primary)' : 'var(--hair-strong)'}`,
                  background: selectedId === p.id ? 'var(--primary)' : 'var(--bg-2)',
                  color: selectedId === p.id ? '#fff' : 'var(--ink-2)',
                  fontSize: 13,
                  cursor: 'pointer',
                  fontWeight: selectedId === p.id ? 600 : 400,
                }}
              >
                {p.name}
                {p.currency && (
                  <span style={{ marginLeft: 6, opacity: 0.7, fontSize: 11 }}>{p.currency}</span>
                )}
              </button>
            ))}
          </div>
        )}

        {/* ── KPI strip ─────────────────────────────────────────────── */}
        {selectedId !== null && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: 10, marginTop: 8 }}>
            {kpis.map((k) => (
              <div key={k.label} className="card" style={{ padding: '12px 14px' }}>
                <div className="row" style={{ gap: 5, marginBottom: 4, alignItems: 'center' }}>
                  <div style={{ fontSize: 10, color: 'var(--ink-3)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                    {k.label}
                  </div>
                  <MetricTooltip label={k.label} />
                </div>
                {dataLoading ? (
                  <Skeleton height={22} />
                ) : (
                  <div style={{ fontSize: 20, fontWeight: 700, color: k.color, fontVariantNumeric: 'tabular-nums' }}>
                    {k.value ?? <span style={{ color: 'var(--ink-4)', fontSize: 14 }}>—</span>}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {/* ── Portfolio value tracking ──────────────────────────────── */}
        {selectedId !== null && positions.length > 0 && (
          <div className="card" style={{ marginTop: 8 }}>
            <div className="card-head">
              <div className="card-title">Стоимость портфеля</div>
              {!hasMarketPrices && (
                <span style={{ fontSize: 10, color: 'var(--ink-4)' }}>нет рыночных цен</span>
              )}
            </div>
            {dataLoading ? (
              <Skeleton height={56} />
            ) : (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 16 }}>
                {/* Initial value */}
                <div>
                  <div style={{ fontSize: 10, color: 'var(--ink-3)', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 4 }}>
                    Начальная стоимость
                  </div>
                  <div style={{ fontSize: 20, fontWeight: 700, fontVariantNumeric: 'tabular-nums', color: 'var(--ink-1)' }}>
                    {initialValue > 0
                      ? `$${initialValue.toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
                      : <span style={{ color: 'var(--ink-4)', fontSize: 14 }}>—</span>}
                  </div>
                  <div style={{ fontSize: 10, color: 'var(--ink-4)', marginTop: 2 }}>кол-во × цена покупки</div>
                </div>

                {/* Current value */}
                <div>
                  <div style={{ fontSize: 10, color: 'var(--ink-3)', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 4 }}>
                    Текущая стоимость
                  </div>
                  <div style={{ fontSize: 20, fontWeight: 700, fontVariantNumeric: 'tabular-nums', color: 'var(--ink-1)' }}>
                    {currentValue > 0
                      ? `$${currentValue.toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
                      : <span style={{ color: 'var(--ink-4)', fontSize: 14 }}>—</span>}
                  </div>
                  <div style={{ fontSize: 10, color: 'var(--ink-4)', marginTop: 2 }}>кол-во × рыночная цена</div>
                </div>

                {/* Absolute change */}
                <div>
                  <div style={{ fontSize: 10, color: 'var(--ink-3)', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 4 }}>
                    Изменение
                  </div>
                  <div style={{
                    fontSize: 20,
                    fontWeight: 700,
                    fontVariantNumeric: 'tabular-nums',
                    color: initialValue > 0
                      ? (valueChange > 0 ? 'var(--good)' : valueChange < 0 ? 'var(--crit)' : 'var(--ink-3)')
                      : 'var(--ink-4)',
                  }}>
                    {initialValue > 0 ? (
                      <>
                        {valueChange >= 0 ? '+' : ''}
                        {`$${valueChange.toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
                      </>
                    ) : (
                      <span style={{ color: 'var(--ink-4)', fontSize: 14 }}>—</span>
                    )}
                  </div>
                  <div style={{ fontSize: 10, marginTop: 2, fontVariantNumeric: 'tabular-nums',
                    color: initialValue > 0
                      ? (valueChange > 0 ? 'var(--good)' : valueChange < 0 ? 'var(--crit)' : 'var(--ink-3)')
                      : 'var(--ink-4)',
                  }}>
                    {initialValue > 0
                      ? `${valueChangePct >= 0 ? '+' : ''}${valueChangePct.toFixed(2)}%`
                      : ''}
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* ── Positions table + Donut ────────────────────────────────── */}
        {selectedId !== null && (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 16, alignItems: 'start', marginTop: 8 }}>
            {/* Positions table */}
            <div className="card" style={{ minWidth: 0 }}>
              <div className="card-head">
                <div className="card-title">Позиции</div>
                <Pill>{positions.length} активов</Pill>
              </div>

              {/* Add position form */}
              <div className="row" style={{ gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
                <input
                  className="input"
                  placeholder="Тикер (AAPL)"
                  value={newSymbol}
                  onChange={(e) => setNewSymbol(e.target.value.toUpperCase())}
                  style={{ width: 100 }}
                />
                <input
                  className="input"
                  placeholder="Кол-во (100)"
                  type="number"
                  step="1"
                  min="0.0001"
                  value={newQuantity}
                  onChange={(e) => setNewQuantity(e.target.value)}
                  style={{ width: 110 }}
                />
                <input
                  className="input"
                  placeholder="Цена (необяз.)"
                  type="number"
                  step="0.01"
                  min="0.0001"
                  value={newPrice}
                  onChange={(e) => setNewPrice(e.target.value)}
                  style={{ width: 130 }}
                />
                <button
                  className="btn-primary"
                  onClick={handleAddPosition}
                  disabled={saving || !newSymbol || !newQuantity}
                  style={{ fontSize: 12 }}
                >
                  {saving ? '…' : '+ Добавить'}
                </button>
              </div>
              <div style={{ fontSize: 10, color: 'var(--ink-4)', marginBottom: 8 }}>
                Вес = кол-во × цена / сумма всех позиций. Цена необязательна — подставляется рыночная.
              </div>

              {dataLoading ? (
                <Skeleton height={120} />
              ) : positions.length === 0 ? (
                <div className="empty-state">Нет позиций. Добавьте активы выше.</div>
              ) : (
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                  <thead>
                    <tr style={{ borderBottom: '1px solid var(--hair)' }}>
                      <th style={{ textAlign: 'left', padding: '4px 8px', color: 'var(--ink-3)', fontWeight: 500, fontSize: 11 }}>Тикер</th>
                      <th style={{ textAlign: 'right', padding: '4px 8px', color: 'var(--ink-3)', fontWeight: 500, fontSize: 11 }}>Кол-во</th>
                      <th style={{ textAlign: 'right', padding: '4px 8px', color: 'var(--ink-3)', fontWeight: 500, fontSize: 11 }}>Цена покупки</th>
                      <th style={{ textAlign: 'right', padding: '4px 8px', color: 'var(--ink-3)', fontWeight: 500, fontSize: 11 }}>Тек. цена</th>
                      <th style={{ textAlign: 'right', padding: '4px 8px', color: 'var(--ink-3)', fontWeight: 500, fontSize: 11 }}>Стоимость</th>
                      <th style={{ textAlign: 'right', padding: '4px 8px', color: 'var(--ink-3)', fontWeight: 500, fontSize: 11 }}>P&amp;L</th>
                      <th style={{ textAlign: 'right', padding: '4px 8px', color: 'var(--ink-3)', fontWeight: 500, fontSize: 11 }}>Доля</th>
                      <th style={{ width: 32 }} />
                    </tr>
                  </thead>
                  <tbody>
                    {positions.map((p, i) => {
                      const mktPrice = p.current_price ?? 0;
                      // Current value uses market price if available, else purchase price
                      const effectivePrice = mktPrice > 0 ? mktPrice : p.price;
                      const posCurrentValue = p.quantity > 0 && effectivePrice > 0 ? p.quantity * effectivePrice : null;
                      const posInitialValue = p.quantity > 0 && p.price > 0 ? p.quantity * p.price : null;
                      const posPnl = posCurrentValue !== null && posInitialValue !== null && mktPrice > 0
                        ? posCurrentValue - posInitialValue
                        : null;
                      const posPnlPct = posPnl !== null && posInitialValue !== null && posInitialValue > 0
                        ? (posPnl / posInitialValue) * 100
                        : null;
                      const pnlColor = posPnl === null ? 'var(--ink-4)' : posPnl > 0 ? 'var(--good)' : posPnl < 0 ? 'var(--crit)' : 'var(--ink-3)';
                      return (
                        <tr key={p.symbol} style={{ borderBottom: '1px solid var(--hair)' }}>
                          <td style={{ padding: '6px 8px' }}>
                            <div className="row" style={{ gap: 8 }}>
                              <div style={{ width: 8, height: 8, borderRadius: '50%', background: COLORS[i % COLORS.length], flexShrink: 0, marginTop: 3 }} />
                              <span className="mono" style={{ fontWeight: 600 }}>{p.symbol}</span>
                            </div>
                          </td>
                          <td style={{ textAlign: 'right', padding: '6px 8px', fontVariantNumeric: 'tabular-nums', color: 'var(--ink-2)' }}>
                            {p.quantity > 0 ? p.quantity.toLocaleString('ru-RU', { maximumFractionDigits: 4 }) : '—'}
                          </td>
                          <td style={{ textAlign: 'right', padding: '6px 8px', fontVariantNumeric: 'tabular-nums', color: 'var(--ink-2)' }}>
                            {p.price > 0 ? `$${p.price.toFixed(2)}` : '—'}
                          </td>
                          <td style={{ textAlign: 'right', padding: '6px 8px', fontVariantNumeric: 'tabular-nums', color: mktPrice > 0 ? 'var(--ink-1)' : 'var(--ink-4)' }}>
                            {mktPrice > 0 ? `$${mktPrice.toFixed(2)}` : '—'}
                          </td>
                          <td style={{ textAlign: 'right', padding: '6px 8px', fontVariantNumeric: 'tabular-nums' }}>
                            {posCurrentValue !== null ? `$${posCurrentValue.toLocaleString('ru-RU', { maximumFractionDigits: 2 })}` : '—'}
                          </td>
                          <td style={{ textAlign: 'right', padding: '6px 8px', fontVariantNumeric: 'tabular-nums', color: pnlColor, fontSize: 12 }}>
                            {posPnl !== null ? (
                              <>
                                <div>{posPnl >= 0 ? '+' : ''}{posPnl.toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
                                {posPnlPct !== null && (
                                  <div style={{ fontSize: 10 }}>{posPnlPct >= 0 ? '+' : ''}{posPnlPct.toFixed(2)}%</div>
                                )}
                              </>
                            ) : '—'}
                          </td>
                          <td style={{ textAlign: 'right', padding: '6px 8px', color: 'var(--ink-3)', fontVariantNumeric: 'tabular-nums' }}>
                            {(p.weight * 100).toFixed(1)}%
                          </td>
                          <td style={{ textAlign: 'right', padding: '6px 4px' }}>
                            <button
                              onClick={() => handleDeletePosition(p.symbol)}
                              style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--crit)', fontSize: 14, padding: '0 4px' }}
                              title="Удалить позицию"
                            >
                              ×
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                  <tfoot>
                    <tr style={{ borderTop: '1px solid var(--hair-strong)' }}>
                      <td style={{ padding: '6px 8px', fontSize: 11, color: 'var(--ink-3)' }}>Итого</td>
                      <td />
                      <td />
                      <td />
                      <td style={{ textAlign: 'right', padding: '6px 8px', fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>
                        {currentValue > 0 ? `$${currentValue.toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '—'}
                      </td>
                      <td style={{ textAlign: 'right', padding: '6px 8px', fontWeight: 700, fontVariantNumeric: 'tabular-nums',
                        color: valueChange > 0 ? 'var(--good)' : valueChange < 0 ? 'var(--crit)' : 'var(--ink-3)' }}>
                        {initialValue > 0 && hasMarketPrices ? (
                          <>
                            <div>{valueChange >= 0 ? '+' : ''}{valueChange.toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
                            <div style={{ fontSize: 10, fontWeight: 400 }}>{valueChangePct >= 0 ? '+' : ''}{valueChangePct.toFixed(2)}%</div>
                          </>
                        ) : '—'}
                      </td>
                      <td style={{ textAlign: 'right', padding: '6px 8px', fontWeight: 700, color: totalWeight > 1.01 || totalWeight < 0.99 ? 'var(--warn)' : 'var(--good)', fontVariantNumeric: 'tabular-nums' }}>
                        {(totalWeight * 100).toFixed(1)}%
                      </td>
                      <td />
                    </tr>
                  </tfoot>
                </table>
              )}
            </div>

            {/* Donut chart */}
            {positions.length > 0 && (
              <div className="card" style={{ width: 200, flexShrink: 0 }}>
                <div className="card-head">
                  <div className="card-title">Аллокация</div>
                </div>
                <div style={{ display: 'flex', justifyContent: 'center', padding: '8px 0' }}>
                  <Donut data={donutData} size={160} />
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 4 }}>
                  {donutData.map((d) => (
                    <div key={d.label} className="row" style={{ gap: 6, fontSize: 11 }}>
                      <div style={{ width: 8, height: 8, borderRadius: '50%', background: d.color, flexShrink: 0, marginTop: 2 }} />
                      <span className="mono">{d.label}</span>
                      <span style={{ marginLeft: 'auto', color: 'var(--ink-3)' }}>{(d.value * 100).toFixed(1)}%</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* ── Risk history chart ─────────────────────────────────────── */}
        {selectedId !== null && (
          <div className="card" style={{ marginTop: 8 }}>
            <div className="card-head">
              <div className="card-title">История риска</div>
              {predictResult && (
                <Pill variant="primary">
                  Метод: {predictResult.method}
                </Pill>
              )}
            </div>
            {dataLoading ? (
              <Skeleton height={180} />
            ) : riskChartSeries.length > 0 ? (
              <>
                <div className="row" style={{ gap: 14, marginBottom: 8 }}>
                  {riskChartSeries.map((s) => (
                    <div key={s.name} className="row" style={{ gap: 5 }}>
                      <div style={{ width: 12, height: 2, background: s.color, marginTop: 6 }} />
                      <span style={{ fontSize: 11, color: 'var(--ink-2)' }}>{s.name}</span>
                    </div>
                  ))}
                </div>
                <LineChart
                  series={riskChartSeries}
                  height={180}
                  yFormat={(v) => `${(v * 100).toFixed(2)}%`}
                  xFormat={(v) => String(v).slice(5)}
                  xTicks={6}
                />
              </>
            ) : (
              <div className="empty-state">Нет истории риска. Запустите расчёт риска.</div>
            )}
          </div>
        )}

        {/* ── Unified Price Chart ────────────────────────────────────── */}
        {selectedId !== null && positions.length > 0 && (
          <div style={{ marginTop: 8 }}>
            <UnifiedPriceChartCard positions={positions} />
          </div>
        )}

        {/* ── Correlation Matrix ─────────────────────────────────────── */}
        {selectedId !== null && positions.length >= 2 && (
          <div style={{ marginTop: 8 }}>
            <CorrelationMatrixCard portfolioId={selectedId} positions={positions} />
          </div>
        )}
      </div>
    </>
  );
}
