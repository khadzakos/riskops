'use client';

import React, { useEffect, useState } from 'react';
import { Topbar, PageHead, Pill, ErrorBanner, Skeleton } from '@/components/Shell';
import { marketDataApi, type DataSource, type IngestionLog, type IngestResponse } from '@/lib/api';

type IngestSource = 'yahoo' | 'moex' | 'synthetic' | 'credit_synthetic';
const SOURCES: IngestSource[] = ['yahoo', 'moex', 'synthetic', 'credit_synthetic'];

export default function DataPage() {
  const [sources, setSources] = useState<DataSource[]>([]);
  const [logs, setLogs] = useState<IngestionLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Ingest form
  const [ingestSource, setIngestSource] = useState<IngestSource>('yahoo');
  const [ingestSymbols, setIngestSymbols] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [ingesting, setIngesting] = useState(false);
  const [ingestResult, setIngestResult] = useState<IngestResponse | IngestResponse[] | null>(null);
  const [ingestError, setIngestError] = useState<string | null>(null);

  // Log filter
  const [filterStatus, setFilterStatus] = useState('');
  const [filterSource, setFilterSource] = useState('');

  const loadData = async () => {
    setLoading(true);
    setError(null);
    try {
      const [src, lg] = await Promise.all([
        marketDataApi.getSources(),
        marketDataApi.getIngestionLog({ limit: 100 }),
      ]);
      setSources(src);
      setLogs(lg);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Ошибка загрузки');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadData(); }, []);

  const handleIngest = async () => {
    setIngesting(true);
    setIngestError(null);
    setIngestResult(null);
    try {
      const syms = ingestSymbols.split(',').map((s) => s.trim().toUpperCase()).filter(Boolean);
      const res = await marketDataApi.triggerIngest({
        source: ingestSource,
        symbols: syms.length > 0 ? syms : undefined,
        date_from: dateFrom || undefined,
        date_to: dateTo || undefined,
      });
      setIngestResult(res);
      await loadData();
    } catch (e: unknown) {
      setIngestError(e instanceof Error ? e.message : 'Ошибка загрузки данных');
    } finally {
      setIngesting(false);
    }
  };

  const handleIngestAll = async () => {
    setIngesting(true);
    setIngestError(null);
    setIngestResult(null);
    try {
      const res = await marketDataApi.triggerIngestAll({
        date_from: dateFrom || undefined,
        date_to: dateTo || undefined,
      });
      setIngestResult(res);
      await loadData();
    } catch (e: unknown) {
      setIngestError(e instanceof Error ? e.message : 'Ошибка загрузки данных');
    } finally {
      setIngesting(false);
    }
  };

  // Filtered logs
  const filteredLogs = logs.filter((l) => {
    if (filterStatus && l.status !== filterStatus) return false;
    if (filterSource && l.source !== filterSource) return false;
    return true;
  });

  const logSources = Array.from(new Set(logs.map((l) => l.source)));
  const successCount = logs.filter((l) => l.status === 'completed').length;
  const failCount = logs.filter((l) => l.status === 'failed').length;
  const totalRows = logs.reduce((s, l) => s + (l.rows_ingested ?? 0), 0);

  const statusVariant = (s: string): 'good' | 'crit' | '' => {
    if (s === 'completed') return 'good';
    if (s === 'failed') return 'crit';
    return '';
  };

  return (
    <>
      <Topbar crumbs={['RiskOps', 'Источники данных']} />
      <div className="page-content">
        <PageHead
          eyebrow="РЫНОЧНЫЕ ДАННЫЕ"
          title="Источники данных"
          sub={`${logs.length} операций · ${totalRows.toLocaleString()} строк загружено`}
        >
          <button className="btn-secondary" onClick={loadData} disabled={loading}>
            {loading ? 'Загрузка…' : 'Обновить'}
          </button>
        </PageHead>

        {error && <ErrorBanner message={error} />}

        {/* KPI strip */}
        <div className="grid-4" style={{ marginBottom: 20 }}>
          {[
            { label: 'Источников', value: sources.length > 0 ? String(sources.length) : null },
            { label: 'Успешных загрузок', value: String(successCount), color: 'var(--good)' },
            { label: 'Ошибок', value: String(failCount), color: failCount > 0 ? 'var(--crit)' : undefined },
            { label: 'Строк загружено', value: totalRows > 0 ? totalRows.toLocaleString() : null },
          ].map((kpi) => (
            <div key={kpi.label} className="metric-card">
              <div className="metric-label">{kpi.label}</div>
              {loading ? <Skeleton height={28} width="60%" /> : (
                <div className="metric-value" style={{ color: kpi.color, fontSize: kpi.value ? undefined : 16 }}>
                  {kpi.value ?? '—'}
                </div>
              )}
            </div>
          ))}
        </div>

        {/* Data sources */}
        {sources.length > 0 && (
          <div className="card" style={{ marginBottom: 20 }}>
            <div className="card-head">
              <div className="card-title">Доступные источники</div>
            </div>
            <table className="data-table">
              <thead>
                <tr>
                  <th>Название</th>
                  <th>Тип данных</th>
                  <th>Описание</th>
                  <th>Расписание</th>
                </tr>
              </thead>
              <tbody>
                {sources.map((s) => (
                  <tr key={s.name}>
                    <td className="mono">{s.name}</td>
                    <td><Pill variant="primary">{s.data_type}</Pill></td>
                    <td style={{ fontSize: 12, color: 'var(--ink-3)' }}>{s.description}</td>
                    <td className="mono" style={{ fontSize: 11, color: 'var(--ink-4)' }}>{s.schedule ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Ingest form */}
        <div className="card" style={{ marginBottom: 20 }}>
          <div className="card-head">
            <div className="card-title">Загрузить данные</div>
          </div>

          {ingestError && <ErrorBanner message={ingestError} />}
          {ingestResult && (
            <div className="error-banner" style={{ background: 'var(--good-soft)', borderColor: 'var(--good)', color: 'var(--good)', marginBottom: 12 }}>
              ✓ Загрузка завершена:{' '}
              {Array.isArray(ingestResult)
                ? `${ingestResult.length} источников, ${ingestResult.reduce((s, r) => s + r.rows_ingested, 0)} строк`
                : `${ingestResult.rows_ingested} строк из ${ingestResult.source}`
              }
            </div>
          )}

          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div>
              <div style={{ fontSize: 11, color: 'var(--ink-4)', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Источник</div>
              <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
                {SOURCES.map((s) => (
                  <button
                    key={s}
                    className={ingestSource === s ? 'btn-primary' : 'btn-secondary'}
                    style={{ fontSize: 12 }}
                    onClick={() => setIngestSource(s)}
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>

            <div className="row" style={{ gap: 12, flexWrap: 'wrap' }}>
              <div style={{ flex: 1, minWidth: 200 }}>
                <div style={{ fontSize: 11, color: 'var(--ink-4)', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                  Тикеры (через запятую, необязательно)
                </div>
                <input
                  className="input"
                  placeholder="AAPL, MSFT, SBER"
                  value={ingestSymbols}
                  onChange={(e) => setIngestSymbols(e.target.value)}
                  style={{ width: '100%' }}
                />
              </div>
              <div>
                <div style={{ fontSize: 11, color: 'var(--ink-4)', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Дата от</div>
                <input className="input" type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
              </div>
              <div>
                <div style={{ fontSize: 11, color: 'var(--ink-4)', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Дата до</div>
                <input className="input" type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
              </div>
            </div>

            <div className="row" style={{ gap: 8 }}>
              <button className="btn-primary" onClick={handleIngest} disabled={ingesting}>
                {ingesting ? 'Загрузка…' : `Загрузить из ${ingestSource}`}
              </button>
              <button className="btn-secondary" onClick={handleIngestAll} disabled={ingesting}>
                {ingesting ? 'Загрузка…' : 'Загрузить все источники'}
              </button>
            </div>
          </div>
        </div>

        {/* Ingestion log */}
        <div className="card">
          <div className="card-head">
            <div className="card-title">Журнал загрузок</div>
            <div className="row" style={{ gap: 8 }}>
              <select
                className="input"
                style={{ fontSize: 12, padding: '4px 8px' }}
                value={filterStatus}
                onChange={(e) => setFilterStatus(e.target.value)}
              >
                <option value="">Все статусы</option>
                <option value="completed">Успешно</option>
                <option value="failed">Ошибка</option>
              </select>
              <select
                className="input"
                style={{ fontSize: 12, padding: '4px 8px' }}
                value={filterSource}
                onChange={(e) => setFilterSource(e.target.value)}
              >
                <option value="">Все источники</option>
                {logSources.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
          </div>

          {loading ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {[0, 1, 2, 3].map((i) => <Skeleton key={i} height={40} />)}
            </div>
          ) : filteredLogs.length > 0 ? (
            <table className="data-table">
              <thead>
                <tr>
                  <th>Источник</th>
                  <th>Тип</th>
                  <th style={{ textAlign: 'right' }}>Строк</th>
                  <th>Период</th>
                  <th>Тикеры</th>
                  <th>Время</th>
                  <th>Статус</th>
                </tr>
              </thead>
              <tbody>
                {filteredLogs.map((log) => (
                  <tr key={log.id}>
                    <td className="mono">{log.source}</td>
                    <td>{log.data_type}</td>
                    <td style={{ textAlign: 'right' }} className="mono">{log.rows_ingested.toLocaleString()}</td>
                    <td style={{ fontSize: 11, color: 'var(--ink-4)' }}>
                      {log.date_from?.slice(0, 10)} — {log.date_to?.slice(0, 10)}
                    </td>
                    <td>
                      {log.symbols && log.symbols.length > 0 ? (
                        <div className="row" style={{ gap: 3, flexWrap: 'wrap' }}>
                          {log.symbols.slice(0, 5).map((s) => (
                            <span key={s} className="mono" style={{ fontSize: 10, background: 'var(--surface-2)', padding: '1px 4px', borderRadius: 3 }}>{s}</span>
                          ))}
                          {log.symbols.length > 5 && <span style={{ fontSize: 10, color: 'var(--ink-4)' }}>+{log.symbols.length - 5}</span>}
                        </div>
                      ) : '—'}
                    </td>
                    <td style={{ fontSize: 11, color: 'var(--ink-4)' }}>
                      {log.created_at.slice(0, 16).replace('T', ' ')}
                    </td>
                    <td>
                      <Pill variant={statusVariant(log.status)}>
                        {log.status === 'completed' ? 'OK' : log.status}
                      </Pill>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <div className="empty-state">
              {logs.length === 0 ? 'Нет записей в журнале загрузок' : 'Нет записей по выбранным фильтрам'}
            </div>
          )}
        </div>
      </div>
    </>
  );
}
