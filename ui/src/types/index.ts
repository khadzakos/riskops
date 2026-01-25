export interface Portfolio {
  id: string;
  user_id: string;
  name: string;
  description: string;
  currency: string;
  created_at: string;
  updated_at: string;
}

export interface Asset {
  id: string;
  ticker: string;
  name: string;
  sector: string;
  asset_type: string;
  currency: string;
  created_at: string;
}

export interface PortfolioPosition {
  id: string;
  portfolio_id: string;
  asset_id: string;
  quantity: number;
  weight: number;
  avg_purchase_price: number;
  created_at: string;
  updated_at: string;
  asset?: Asset;
}

export interface RiskCalculation {
  id: string;
  portfolio_id: string;
  calculation_date: string;
  horizon_days: number;
  confidence_level: number;
  var_value: number;
  var_percentage: number;
  cvar_value: number;
  cvar_percentage: number;
  volatility: number;
  sharpe_ratio: number;
  max_drawdown: number;
  created_at: string;
}

export interface Scenario {
  id: string;
  user_id: string;
  name: string;
  description: string;
  scenario_type: string;
  parameters: Record<string, unknown>;
  created_at: string;
}

export interface ScenarioResult {
  id: string;
  portfolio_id: string;
  scenario_id: string;
  portfolio_value_change: number;
  var_change: number;
  volatility_change: number;
  calculated_at: string;
  scenario?: Scenario;
}

export interface RiskLimit {
  id: string;
  portfolio_id: string;
  limit_type: string;
  threshold_value: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface Alert {
  id: string;
  portfolio_id: string;
  risk_limit_id: string | null;
  alert_type: string;
  message: string;
  severity: 'warning' | 'critical';
  is_read: boolean;
  created_at: string;
}
