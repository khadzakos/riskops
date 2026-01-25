import type {
  Alert,
  Portfolio,
  PortfolioPosition,
  RiskCalculation,
  RiskLimit,
  Scenario,
  ScenarioResult,
} from '../types';

type ApiErrorDetails = {
  status: number;
  statusText: string;
  url: string;
  bodyText?: string;
};

export class ApiError extends Error {
  details: ApiErrorDetails;
  constructor(message: string, details: ApiErrorDetails) {
    super(message);
    this.name = 'ApiError';
    this.details = details;
  }
}

const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL as string | undefined)?.replace(/\/+$/, '') || '';

function buildUrl(path: string, query?: Record<string, string | number | boolean | undefined>) {
  const isAbsolute = /^https?:\/\//i.test(path);
  const base = isAbsolute ? '' : API_BASE_URL;
  const url = `${base}${path}`;
  const qs = query
    ? Object.entries(query)
        .filter(([, v]) => v !== undefined)
        .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
        .join('&')
    : '';
  return qs ? `${url}${url.includes('?') ? '&' : '?'}${qs}` : url;
}

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const url = buildUrl(path);
  const res = await fetch(url, {
    headers: {
      'content-type': 'application/json',
      ...(init?.headers ?? {}),
    },
    ...init,
  });

  if (!res.ok) {
    let bodyText: string | undefined;
    try {
      bodyText = await res.text();
    } catch {
      // ignore
    }
    throw new ApiError(`API request failed: ${res.status} ${res.statusText}`, {
      status: res.status,
      statusText: res.statusText,
      url,
      bodyText,
    });
  }

  // 204 No Content
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export const api = {
  // Portfolios
  getPortfolios(): Promise<Portfolio[]> {
    return apiFetch('/api/portfolios');
  },
  createPortfolio(input: { name: string; description: string; currency: string }): Promise<Portfolio> {
    return apiFetch('/api/portfolios', { method: 'POST', body: JSON.stringify(input) });
  },
  getPortfolioPositions(portfolioId: string): Promise<PortfolioPosition[]> {
    return apiFetch(`/api/portfolios/${encodeURIComponent(portfolioId)}/positions`);
  },

  // Risk
  getLatestRiskCalculation(portfolioId: string): Promise<RiskCalculation | null> {
    return apiFetch(`/api/portfolios/${encodeURIComponent(portfolioId)}/risk/latest`);
  },
  getRiskHistory(portfolioId: string, limit = 30): Promise<RiskCalculation[]> {
    return apiFetch(buildUrl(`/api/portfolios/${encodeURIComponent(portfolioId)}/risk`, { limit }));
  },
  calculateRisk(portfolioId: string, input: { horizon_days: number; confidence_level: number }): Promise<RiskCalculation> {
    return apiFetch(`/api/portfolios/${encodeURIComponent(portfolioId)}/risk/calculate`, {
      method: 'POST',
      body: JSON.stringify(input),
    });
  },

  // Scenarios
  getScenarios(): Promise<Scenario[]> {
    return apiFetch('/api/scenarios');
  },
  createScenario(input: {
    name: string;
    description: string;
    scenario_type: string;
    parameters: Record<string, unknown>;
  }): Promise<Scenario> {
    return apiFetch('/api/scenarios', { method: 'POST', body: JSON.stringify(input) });
  },
  getScenarioResults(portfolioId: string): Promise<ScenarioResult[]> {
    return apiFetch(`/api/portfolios/${encodeURIComponent(portfolioId)}/scenario-results`);
  },
  runScenario(portfolioId: string, scenarioId: string): Promise<ScenarioResult> {
    return apiFetch(
      `/api/portfolios/${encodeURIComponent(portfolioId)}/scenarios/${encodeURIComponent(scenarioId)}/run`,
      { method: 'POST' }
    );
  },

  // Monitoring
  getRiskLimits(portfolioId: string): Promise<RiskLimit[]> {
    return apiFetch(`/api/portfolios/${encodeURIComponent(portfolioId)}/risk-limits`);
  },
  createRiskLimit(portfolioId: string, input: { limit_type: string; threshold_value: number }): Promise<RiskLimit> {
    return apiFetch(`/api/portfolios/${encodeURIComponent(portfolioId)}/risk-limits`, {
      method: 'POST',
      body: JSON.stringify(input),
    });
  },
  updateRiskLimit(limitId: string, input: Partial<Pick<RiskLimit, 'is_active' | 'threshold_value'>>): Promise<RiskLimit> {
    return apiFetch(`/api/risk-limits/${encodeURIComponent(limitId)}`, {
      method: 'PATCH',
      body: JSON.stringify(input),
    });
  },
  getAlerts(portfolioId: string, opts?: { unreadOnly?: boolean; limit?: number }): Promise<Alert[]> {
    return apiFetch(
      buildUrl(`/api/portfolios/${encodeURIComponent(portfolioId)}/alerts`, {
        unread: opts?.unreadOnly,
        limit: opts?.limit,
      })
    );
  },
  markAlertRead(alertId: string): Promise<Alert> {
    return apiFetch(`/api/alerts/${encodeURIComponent(alertId)}`, {
      method: 'PATCH',
      body: JSON.stringify({ is_read: true }),
    });
  },
};

