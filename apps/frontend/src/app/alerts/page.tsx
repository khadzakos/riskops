'use client';

import React, { useEffect, useState } from 'react';
import { Topbar, PageHead, Pill, ErrorBanner, Skeleton } from '@/components/Shell';
import { inferenceApi, marketDataApi, type ModelHealthResponse, type IngestionLog } from '@/lib/api';

export default function AlertsPage() {
  const [health, setHealth] = useState<ModelHealthResponse | null>(null);
  const [logs, setLogs] = useState<IngestionLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const [h, l] = await Promise.all([
        inferenceApi.health(),
        marketDataApi.getIngestionLog({ limit: 50 }),
      ]);
      setHealth(h);
      setLogs(l);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Ошибка загрузки');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const failedLogs = logs.filter((l) => l.status === 'failed');
  const successLogs = logs.filter((l) => l.status === 'completed');

  const modelStatus = health?.status === 'ok' ? 'good' : 'crit';
  const totalAlerts = failedLogs.length + (health?.status !== 'ok' ? 1 : 0);

  return (
    <>
      <Topbar crumbs={['RiskOps', 'Алерты']} />
      <div className="page-content">
        <PageHead
          eyebrow="МОНИТОРИНГ"
          title="Алерты"
          sub={`${totalAlerts} активных событий`}
        >
          <button className="btn-secondary" onClick={load} disabled={loading}>
            {loading ? 'Загрузка…' : 'Обновить'}
          </button>
        </PageHead>

        {error && <ErrorBanner message={error} />}

        {loading ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {[0, 1, 2].map((i) => <Skeleton key={i} height={80} />)}
          </div>
        ) : (
          <>
            {/* Model health */}
            <div className="card" style={{ marginBottom: 20 }}>
              <div className="card-head">
                <div className="card-title">Статус моделей</div>
                {health && <Pill variant={modelStatus}>{health.status === 'ok' ? 'Норма' : 'Проблема'}</Pill>}
              </div>
              {health ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                  {health.status !== 'ok' && (
                    <div className="alert-row crit">
                      <div className="alert-icon">⚠</div>
                      <div className="alert-body">
                        <div className="alert-title">Inference Service недоступен</div>
                        <div className="alert-sub">Статус: {health.status}</div>
                      </div>
                      <Pill variant="crit">Критично</Pill>
                    </div>
                  )}
                  <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
                    <div>
                      <div style={{ fontSize: 11, color: 'var(--ink-4)', marginBottom: 4 }}>Загруженные модели</div>
                      <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
                        {health.loaded_models.length > 0
                          ? health.loaded_models.map((m) => <Pill key={m} variant="primary">{m}</Pill>)
                          : <span style={{ fontSize: 12, color: 'var(--ink-4)' }}>Нет загруженных моделей</span>
                        }
                      </div>
                    </div>
                    <div>
                      <div style={{ fontSize: 11, color: 'var(--ink-4)', marginBottom: 4 }}>Fallback</div>
                      <Pill variant={health.fallback_available ? 'warn' : ''}>{health.fallback_available ? 'Доступен' : 'Недоступен'}</Pill>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="empty-state">Нет данных о статусе моделей</div>
              )}
            </div>

            {/* Failed ingestion logs */}
            <div className="card" style={{ marginBottom: 20 }}>
              <div className="card-head">
                <div className="card-title">Ошибки загрузки данных</div>
                <Pill variant={failedLogs.length > 0 ? 'crit' : 'good'}>
                  {failedLogs.length} ошибок
                </Pill>
              </div>
              {failedLogs.length > 0 ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {failedLogs.map((log) => (
                    <div key={log.id} className="alert-row crit">
                      <div className="alert-icon">✕</div>
                      <div className="alert-body">
                        <div className="alert-title">
                          {log.source} · {log.data_type}
                        </div>
                        <div className="alert-sub">
                          {log.error_message ?? 'Неизвестная ошибка'} · {log.created_at.slice(0, 16).replace('T', ' ')}
                        </div>
                        {log.symbols && log.symbols.length > 0 && (
                          <div className="row" style={{ gap: 4, marginTop: 4, flexWrap: 'wrap' }}>
                            {log.symbols.slice(0, 8).map((s) => (
                              <span key={s} className="mono" style={{ fontSize: 10, background: 'var(--surface-2)', padding: '1px 4px', borderRadius: 3 }}>{s}</span>
                            ))}
                            {log.symbols.length > 8 && <span style={{ fontSize: 10, color: 'var(--ink-4)' }}>+{log.symbols.length - 8}</span>}
                          </div>
                        )}
                      </div>
                      <Pill variant="crit">Ошибка</Pill>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="empty-state">Нет ошибок загрузки данных</div>
              )}
            </div>

            {/* Recent successful ingestions */}
            <div className="card">
              <div className="card-head">
                <div className="card-title">Последние загрузки</div>
                <Pill variant="good">{successLogs.length} успешных</Pill>
              </div>
              {successLogs.length > 0 ? (
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Источник</th>
                      <th>Тип</th>
                      <th style={{ textAlign: 'right' }}>Строк</th>
                      <th>Период</th>
                      <th>Время</th>
                      <th>Статус</th>
                    </tr>
                  </thead>
                  <tbody>
                    {successLogs.slice(0, 20).map((log) => (
                      <tr key={log.id}>
                        <td className="mono">{log.source}</td>
                        <td>{log.data_type}</td>
                        <td style={{ textAlign: 'right' }} className="mono">{log.rows_ingested.toLocaleString()}</td>
                        <td style={{ fontSize: 11, color: 'var(--ink-4)' }}>
                          {log.date_from?.slice(0, 10)} — {log.date_to?.slice(0, 10)}
                        </td>
                        <td style={{ fontSize: 11, color: 'var(--ink-4)' }}>
                          {log.created_at.slice(0, 16).replace('T', ' ')}
                        </td>
                        <td><Pill variant="good">OK</Pill></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <div className="empty-state">Нет данных о загрузках</div>
              )}
            </div>
          </>
        )}
      </div>
    </>
  );
}
