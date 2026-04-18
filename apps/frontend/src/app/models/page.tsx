'use client';

import React, { useEffect, useState } from 'react';
import { Topbar, PageHead, Pill, ErrorBanner, Skeleton } from '@/components/Shell';
import { trainingApi, type ModelInfo, type TrainResponse } from '@/lib/api';

const MODEL_TYPES = ['garch', 'montecarlo', 'all'] as const;
type ModelType = typeof MODEL_TYPES[number];

export default function ModelsPage() {
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Training form
  const [symbols, setSymbols] = useState('');
  const [modelType, setModelType] = useState<ModelType>('all');
  const [alpha, setAlpha] = useState('0.95');
  const [horizon, setHorizon] = useState('1');
  const [lookback, setLookback] = useState('252');
  const [training, setTraining] = useState(false);
  const [trainResult, setTrainResult] = useState<TrainResponse | null>(null);
  const [trainError, setTrainError] = useState<string | null>(null);

  // Job polling
  const [jobId, setJobId] = useState<string | null>(null);
  const [jobStatus, setJobStatus] = useState<TrainResponse | null>(null);

  const loadModels = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await trainingApi.listModels();
      setModels(res.models);
      setTotal(res.total);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Ошибка загрузки');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadModels(); }, []);

  // Poll job status
  useEffect(() => {
    if (!jobId) return;
    const interval = setInterval(async () => {
      try {
        const status = await trainingApi.getTrainingStatus(jobId);
        setJobStatus(status);
        if (status.status === 'completed' || status.status === 'failed') {
          clearInterval(interval);
          setJobId(null);
          await loadModels();
        }
      } catch {
        clearInterval(interval);
        setJobId(null);
      }
    }, 3000);
    return () => clearInterval(interval);
  }, [jobId]);

  const handleTrain = async () => {
    const syms = symbols.split(',').map((s) => s.trim().toUpperCase()).filter(Boolean);
    if (syms.length === 0) {
      setTrainError('Введите хотя бы один тикер');
      return;
    }
    setTraining(true);
    setTrainError(null);
    setTrainResult(null);
    setJobStatus(null);
    try {
      const res = await trainingApi.triggerTraining({
        symbols: syms,
        model_type: modelType,
        alpha: parseFloat(alpha),
        horizon_days: parseInt(horizon),
        lookback_days: parseInt(lookback),
      });
      setTrainResult(res);
      if (res.job_id) setJobId(res.job_id);
    } catch (e: unknown) {
      setTrainError(e instanceof Error ? e.message : 'Ошибка запуска обучения');
    } finally {
      setTraining(false);
    }
  };

  const statusVariant = (s: string): 'good' | 'warn' | 'crit' | '' => {
    if (s === 'completed' || s === 'active') return 'good';
    if (s === 'running' || s === 'pending') return 'warn';
    if (s === 'failed') return 'crit';
    return '';
  };

  return (
    <>
      <Topbar crumbs={['RiskOps', 'Реестр моделей']} />
      <div className="page-content">
        <PageHead
          eyebrow="ML МОДЕЛИ"
          title="Реестр моделей"
          sub={`${total} моделей зарегистрировано`}
        >
          <button className="btn-secondary" onClick={loadModels} disabled={loading}>
            {loading ? 'Загрузка…' : 'Обновить'}
          </button>
        </PageHead>

        {error && <ErrorBanner message={error} />}

        {/* Training form */}
        <div className="card" style={{ marginBottom: 20 }}>
          <div className="card-head">
            <div className="card-title">Обучение новой модели</div>
            {jobStatus && (
              <Pill variant={statusVariant(jobStatus.status)}>
                {jobStatus.status}
              </Pill>
            )}
          </div>

          {trainError && <ErrorBanner message={trainError} />}
          {trainResult && (
            <div className="error-banner" style={{ background: 'var(--good-soft)', borderColor: 'var(--good)', color: 'var(--good)', marginBottom: 12 }}>
              ✓ Задача запущена: {trainResult.job_id} · {trainResult.message}
            </div>
          )}

          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div>
              <div style={{ fontSize: 11, color: 'var(--ink-4)', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                Тикеры (через запятую)
              </div>
              <input
                className="input"
                placeholder="AAPL, MSFT, GOOGL"
                value={symbols}
                onChange={(e) => setSymbols(e.target.value)}
                style={{ width: '100%' }}
              />
            </div>

            <div className="row" style={{ gap: 16, flexWrap: 'wrap' }}>
              <div>
                <div style={{ fontSize: 11, color: 'var(--ink-4)', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Тип модели</div>
                <div className="row" style={{ gap: 6 }}>
                  {MODEL_TYPES.map((t) => (
                    <button
                      key={t}
                      className={modelType === t ? 'btn-primary' : 'btn-secondary'}
                      style={{ fontSize: 12 }}
                      onClick={() => setModelType(t)}
                    >
                      {t}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <div style={{ fontSize: 11, color: 'var(--ink-4)', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Уровень α</div>
                <input className="input" type="number" step="0.01" min="0.9" max="0.999" value={alpha} onChange={(e) => setAlpha(e.target.value)} style={{ width: 80 }} />
              </div>
              <div>
                <div style={{ fontSize: 11, color: 'var(--ink-4)', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Горизонт (дней)</div>
                <input className="input" type="number" min="1" max="30" value={horizon} onChange={(e) => setHorizon(e.target.value)} style={{ width: 80 }} />
              </div>
              <div>
                <div style={{ fontSize: 11, color: 'var(--ink-4)', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Lookback (дней)</div>
                <input className="input" type="number" min="30" max="1000" value={lookback} onChange={(e) => setLookback(e.target.value)} style={{ width: 80 }} />
              </div>
            </div>

            <div>
              <button className="btn-primary" onClick={handleTrain} disabled={training || !!jobId}>
                {training ? 'Запуск…' : jobId ? `Обучение… (${jobStatus?.status ?? 'pending'})` : 'Запустить обучение'}
              </button>
            </div>
          </div>

          {/* Job results */}
          {jobStatus?.results && jobStatus.results.length > 0 && (
            <div style={{ marginTop: 16 }}>
              <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--ink-3)', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                Результаты обучения
              </div>
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Тип</th>
                    <th>Модель</th>
                    <th>Версия</th>
                    <th style={{ textAlign: 'right' }}>VaR</th>
                    <th style={{ textAlign: 'right' }}>CVaR</th>
                    <th style={{ textAlign: 'right' }}>σ</th>
                    <th>Статус</th>
                  </tr>
                </thead>
                <tbody>
                  {jobStatus.results.map((r, i) => (
                    <tr key={i}>
                      <td className="mono">{r.model_type}</td>
                      <td className="mono" style={{ fontSize: 11 }}>{r.model_name}</td>
                      <td className="mono" style={{ fontSize: 11 }}>{r.model_version}</td>
                      <td style={{ textAlign: 'right' }} className="mono">{(r.var * 100).toFixed(3)}%</td>
                      <td style={{ textAlign: 'right' }} className="mono">{(r.cvar * 100).toFixed(3)}%</td>
                      <td style={{ textAlign: 'right' }} className="mono">{(r.volatility * 100).toFixed(3)}%</td>
                      <td><Pill variant={statusVariant(r.status)}>{r.status}</Pill></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Models registry */}
        <div className="card">
          <div className="card-head">
            <div className="card-title">Зарегистрированные модели</div>
            <span style={{ fontSize: 11, color: 'var(--ink-4)' }}>{total} всего</span>
          </div>
          {loading ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {[0, 1, 2].map((i) => <Skeleton key={i} height={48} />)}
            </div>
          ) : models.length > 0 ? (
            <table className="data-table">
              <thead>
                <tr>
                  <th>Название</th>
                  <th>Версия</th>
                  <th>Статус</th>
                  <th>MLflow Run</th>
                  <th>Метрики</th>
                  <th>Создана</th>
                </tr>
              </thead>
              <tbody>
                {models.map((m, i) => (
                  <tr key={i}>
                    <td className="mono">{m.model_name}</td>
                    <td className="mono" style={{ fontSize: 11 }}>{m.model_version}</td>
                    <td><Pill variant={statusVariant(m.status)}>{m.status}</Pill></td>
                    <td className="mono" style={{ fontSize: 10, color: 'var(--ink-4)' }}>
                      {m.mlflow_run_id ? m.mlflow_run_id.slice(0, 12) + '…' : '—'}
                    </td>
                    <td>
                      {m.metrics && Object.keys(m.metrics).length > 0 ? (
                        <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
                          {Object.entries(m.metrics).slice(0, 3).map(([k, v]) => (
                            <span key={k} style={{ fontSize: 10, color: 'var(--ink-3)' }}>
                              {k}: <span className="mono">{typeof v === 'number' ? v.toFixed(4) : v}</span>
                            </span>
                          ))}
                        </div>
                      ) : '—'}
                    </td>
                    <td style={{ fontSize: 11, color: 'var(--ink-4)' }}>
                      {m.created_at ? m.created_at.slice(0, 10) : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <div className="empty-state">
              <div style={{ fontSize: 32, marginBottom: 8 }}>🤖</div>
              <div>Нет зарегистрированных моделей.</div>
              <div style={{ marginTop: 4, fontSize: 12, color: 'var(--ink-4)' }}>
                Запустите обучение выше, чтобы создать первую модель.
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
