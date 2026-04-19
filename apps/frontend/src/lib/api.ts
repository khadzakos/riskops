/**
 * Typed API client for all RiskOps backend services.
 * All requests go through Next.js rewrites → API Gateway (port 8081).
 */

const BASE = '/api';

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { 'Content-Type': 'application/json', ...init?.headers },
    ...init,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(body.error ?? `HTTP ${res.status}`);
  }
  return res.json() as Promise<T>;
}

// ─── Portfolio Service ────────────────────────────────────────────────────────

export interface Portfolio {
  id: number;
  name: string;
  description: string;
  currency: string;
  created_at: string;
  updated_at: string;
}

export interface Position {
  portfolio_id: number;
  symbol: string;
  weight: number;
  updated_at: string;
}

export interface RiskResult {
  id: number;
  portfolio_id: number;
  asof_date: string;
  horizon_days: number;
  alpha: number;
  method: string;
  metric: string; // 'var' | 'cvar' | 'volatility'
  value: number;
  model_version: string;
  created_at: string;
}

export const portfolioApi = {
  list: () => apiFetch<Portfolio[]>('/portfolios'),
  get: (id: number) => apiFetch<Portfolio>(`/portfolios/${id}`),
  create: (body: { name: string; description?: string; currency?: string }) =>
    apiFetch<Portfolio>('/portfolios', { method: 'POST', body: JSON.stringify(body) }),
  delete: (id: number) =>
    fetch(`${BASE}/portfolios/${id}`, { method: 'DELETE' }),

  listPositions: (id: number) => apiFetch<Position[]>(`/portfolios/${id}/positions`),
  upsertPosition: (id: number, body: { symbol: string; weight: number }) =>
    apiFetch<Position>(`/portfolios/${id}/positions`, { method: 'POST', body: JSON.stringify(body) }),
  deletePosition: (id: number, symbol: string) =>
    fetch(`${BASE}/portfolios/${id}/positions/${symbol}`, { method: 'DELETE' }),

  getLatestRisk: (id: number) => apiFetch<RiskResult[]>(`/portfolios/${id}/risk/latest`),
  getRiskHistory: (id: number, limit = 100) =>
    apiFetch<RiskResult[]>(`/portfolios/${id}/risk?limit=${limit}`),
};

// ─── Market Data Service ──────────────────────────────────────────────────────

export interface RawPrice {
  symbol: string;
  price_date: string;
  close: number;
  currency?: string;
  source?: string;
  ingested_at: string;
}

export interface ProcessedReturn {
  symbol: string;
  price_date: string;
  ret: number;
  computed_at: string;
}

export interface DataSource {
  name: string;
  data_type: string;
  description: string;
  schedule?: string;
}

export interface IngestionLog {
  id: number;
  source: string;
  data_type: string;
  symbols: string[];
  date_from: string;
  date_to: string;
  rows_ingested: number;
  status: string;
  error_message?: string;
  created_at: string;
}

export interface IngestResponse {
  source: string;
  data_type: string;
  rows_ingested: number;
  status: 'completed' | 'failed';
  error?: string;
}

export const marketDataApi = {
  getSources: () => apiFetch<DataSource[]>('/market-data/sources'),
  getIngestionLog: (params?: { source?: string; status?: string; limit?: number }) => {
    const q = new URLSearchParams();
    if (params?.source) q.set('source', params.source);
    if (params?.status) q.set('status', params.status);
    if (params?.limit) q.set('limit', String(params.limit));
    return apiFetch<IngestionLog[]>(`/market-data/ingestion-log?${q}`);
  },
  getPrices: (params?: { symbols?: string; date_from?: string; date_to?: string; limit?: number }) => {
    const q = new URLSearchParams();
    if (params?.symbols) q.set('symbols', params.symbols);
    if (params?.date_from) q.set('date_from', params.date_from);
    if (params?.date_to) q.set('date_to', params.date_to);
    if (params?.limit) q.set('limit', String(params.limit));
    return apiFetch<RawPrice[]>(`/market-data/prices?${q}`);
  },
  getReturns: (params?: { symbols?: string; date_from?: string; date_to?: string; limit?: number }) => {
    const q = new URLSearchParams();
    if (params?.symbols) q.set('symbols', params.symbols);
    if (params?.date_from) q.set('date_from', params.date_from);
    if (params?.date_to) q.set('date_to', params.date_to);
    if (params?.limit) q.set('limit', String(params.limit));
    return apiFetch<ProcessedReturn[]>(`/market-data/returns?${q}`);
  },
  triggerIngest: (body: {
    source: 'yahoo' | 'moex' | 'synthetic' | 'credit_synthetic';
    symbols?: string[];
    date_from?: string;
    date_to?: string;
    count?: number;
  }) => apiFetch<IngestResponse>('/market-data/ingest', { method: 'POST', body: JSON.stringify(body) }),
  triggerIngestAll: (body?: { date_from?: string; date_to?: string }) =>
    apiFetch<IngestResponse[]>('/market-data/ingest/all', { method: 'POST', body: JSON.stringify(body ?? {}) }),
};

// ─── Inference Service ────────────────────────────────────────────────────────

export interface PredictResponse {
  portfolio_id: number;
  asof_date: string;
  method: string;
  alpha: number;
  horizon_days: number;
  var: number;
  cvar: number;
  volatility: number;
  max_drawdown: number | null;
  sharpe_ratio: number | null;
  sortino_ratio: number | null;
  beta_to_benchmark: number | null;
  model_version: string;
  computed_at: string;
}

export interface ModelHealthResponse {
  status: string;
  loaded_models: string[];
  fallback_available: boolean;
}

export const inferenceApi = {
  predict: (body: {
    portfolio_id: number;
    method?: 'historical' | 'garch' | 'montecarlo';
    alpha?: number;
    horizon_days?: number;
  }) => apiFetch<PredictResponse>('/risk/predict', { method: 'POST', body: JSON.stringify(body) }),
  health: () => apiFetch<ModelHealthResponse>('/risk/predict/health'),
};

// ─── Training Service ─────────────────────────────────────────────────────────

export interface ModelInfo {
  model_name: string;
  model_version: string;
  mlflow_run_id?: string;
  status: string;
  metrics?: Record<string, number>;
  created_at?: string;
}

export interface ModelsResponse {
  models: ModelInfo[];
  total: number;
}

export interface TrainResponse {
  job_id: string;
  status: string;
  message: string;
  results?: Array<{
    run_id: string;
    model_type: string;
    model_name: string;
    model_version: string;
    var: number;
    cvar: number;
    volatility: number;
    status: string;
    error?: string;
  }>;
}

export interface BacktestResponse {
  violations: number;
  total_obs: number;
  violation_rate: number;
  expected_rate: number;
  kupiec_lr: number;
  kupiec_pvalue: number;
  christoffersen_lr_ind: number;
  christoffersen_lr_cc: number;
  christoffersen_pvalue_ind: number;
  christoffersen_pvalue_cc: number;
  pi_01: number;
  pi_11: number;
  status: 'OK' | 'WARN' | 'CRIT';
  model_type: string;
  alpha: number;
  lookback_days: number;
  test_days: number;
  mlflow_run_id?: string | null;
}

export const trainingApi = {
  listModels: () => apiFetch<ModelsResponse>('/risk/models'),
  triggerTraining: (body: {
    symbols: string[];
    model_type?: 'garch' | 'montecarlo' | 'all';
    alpha?: number;
    horizon_days?: number;
    lookback_days?: number;
    weights?: Record<string, number>;
    n_simulations?: number;
  }) => apiFetch<TrainResponse>('/risk/train', { method: 'POST', body: JSON.stringify(body) }),
  getTrainingStatus: (jobId: string) => apiFetch<TrainResponse>(`/risk/train/status/${jobId}`),
  runBacktest: (body: {
    symbols: string[];
    model_type?: 'garch' | 'montecarlo' | 'historical';
    alpha?: number;
    lookback_days?: number;
    test_days?: number;
    horizon_days?: number;
    n_simulations?: number;
    log_to_mlflow?: boolean;
  }) => apiFetch<BacktestResponse>('/risk/backtest', { method: 'POST', body: JSON.stringify(body) }),
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Extract a specific metric value from a RiskResult array */
export function extractMetric(results: RiskResult[], metric: string): number | null {
  const r = results.find((x) => x.metric === metric);
  return r ? r.value : null;
}

/** Group risk results by metric name */
export function groupByMetric(results: RiskResult[]): Record<string, RiskResult[]> {
  return results.reduce<Record<string, RiskResult[]>>((acc, r) => {
    (acc[r.metric] ??= []).push(r);
    return acc;
  }, {});
}
