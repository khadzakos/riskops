import { useState, useEffect } from 'react';
import { TrendingDown, AlertTriangle, Activity, BarChart3 } from 'lucide-react';
import { Portfolio, RiskCalculation } from '../types';
import MetricCard from '../components/MetricCard';
import { api } from '../lib/api';

export default function RiskMetrics() {
  const [portfolios, setPortfolios] = useState<Portfolio[]>([]);
  const [selectedPortfolio, setSelectedPortfolio] = useState<Portfolio | null>(null);
  const [horizon, setHorizon] = useState(1);
  const [confidence, setConfidence] = useState(0.95);
  const [latestRisk, setLatestRisk] = useState<RiskCalculation | null>(null);
  const [riskHistory, setRiskHistory] = useState<RiskCalculation[]>([]);
  const [calculating, setCalculating] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadPortfolios();
  }, []);

  useEffect(() => {
    if (selectedPortfolio) {
      loadRiskData(selectedPortfolio.id);
    }
  }, [selectedPortfolio]);

  const loadPortfolios = async () => {
    try {
      setError(null);
      const data = await api.getPortfolios();
      setPortfolios(data || []);
      if (data && data.length > 0) {
        setSelectedPortfolio(data[0]);
      } else {
        setSelectedPortfolio(null);
      }
    } catch (e) {
      console.error('Error loading portfolios:', e);
      setError('Failed to load portfolios from backend API.');
    } finally {
      setLoading(false);
    }
  };

  const loadRiskData = async (portfolioId: string) => {
    try {
      setError(null);
      const [latest, history] = await Promise.all([
        api.getLatestRiskCalculation(portfolioId),
        api.getRiskHistory(portfolioId, 30),
      ]);
      setLatestRisk(latest);
      setRiskHistory(history || []);
    } catch (e) {
      console.error('Error loading risk data:', e);
      setError('Failed to load risk data from backend API.');
      setLatestRisk(null);
      setRiskHistory([]);
    }
  };

  const calculateRisk = async () => {
    if (!selectedPortfolio) return;

    setCalculating(true);
    try {
      setError(null);
      await api.calculateRisk(selectedPortfolio.id, {
        horizon_days: horizon,
        confidence_level: confidence,
      });
      await loadRiskData(selectedPortfolio.id);
    } catch (error) {
      console.error('Error calculating risk:', error);
      setError('Risk calculation failed via backend API.');
    } finally {
      setCalculating(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-gray-400">Loading risk metrics...</div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {error && (
        <div className="bg-red-900/20 border border-red-500/40 rounded-lg p-4 text-red-200 text-sm">
          {error}
        </div>
      )}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-white mb-2">Risk Metrics Calculation</h1>
          <p className="text-gray-400">Calculate VaR, CVaR, and volatility for your portfolios</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
        <div className="bg-[#0f1419] border border-gray-800 rounded-lg p-6">
          <h2 className="text-lg font-bold text-white mb-4">Select Portfolio</h2>
          <div className="space-y-2">
            {portfolios.map((portfolio) => (
              <button
                key={portfolio.id}
                onClick={() => setSelectedPortfolio(portfolio)}
                className={`w-full text-left p-3 rounded-lg transition-colors ${
                  selectedPortfolio?.id === portfolio.id
                    ? 'bg-blue-600 text-white'
                    : 'bg-[#0a0e14] text-gray-300 hover:bg-gray-800'
                }`}
              >
                <p className="font-medium text-sm">{portfolio.name}</p>
              </button>
            ))}
          </div>

          <div className="mt-6 pt-6 border-t border-gray-800">
            <h3 className="text-sm font-bold text-white mb-4">Calculation Parameters</h3>

            <div className="space-y-4">
              <div>
                <label className="block text-gray-400 text-xs font-medium mb-2">Horizon (days)</label>
                <select
                  value={horizon}
                  onChange={(e) => setHorizon(Number(e.target.value))}
                  className="w-full bg-[#0a0e14] border border-gray-800 rounded-lg px-3 py-2 text-white text-sm focus:border-blue-500 focus:outline-none"
                >
                  <option value={1}>1 Day</option>
                  <option value={10}>10 Days</option>
                  <option value={30}>1 Month</option>
                  <option value={90}>3 Months</option>
                </select>
              </div>

              <div>
                <label className="block text-gray-400 text-xs font-medium mb-2">Confidence Level</label>
                <select
                  value={confidence}
                  onChange={(e) => setConfidence(Number(e.target.value))}
                  className="w-full bg-[#0a0e14] border border-gray-800 rounded-lg px-3 py-2 text-white text-sm focus:border-blue-500 focus:outline-none"
                >
                  <option value={0.90}>90%</option>
                  <option value={0.95}>95%</option>
                  <option value={0.99}>99%</option>
                </select>
              </div>

              <button
                onClick={calculateRisk}
                disabled={calculating || !selectedPortfolio}
                className="w-full px-4 py-3 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-700 disabled:cursor-not-allowed text-white rounded-lg font-medium transition-colors"
              >
                {calculating ? 'Calculating...' : 'Calculate Risk'}
              </button>
            </div>
          </div>
        </div>

        <div className="lg:col-span-3 space-y-6">
          {latestRisk ? (
            <>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                <MetricCard
                  title="Value at Risk (VaR)"
                  value={`$${latestRisk.var_value.toLocaleString(undefined, { maximumFractionDigits: 0 })}`}
                  subtitle={`${latestRisk.var_percentage.toFixed(2)}% of portfolio`}
                  icon={TrendingDown}
                  trend="neutral"
                />
                <MetricCard
                  title="CVaR (Expected Shortfall)"
                  value={`$${latestRisk.cvar_value.toLocaleString(undefined, { maximumFractionDigits: 0 })}`}
                  subtitle={`${latestRisk.cvar_percentage.toFixed(2)}% of portfolio`}
                  icon={AlertTriangle}
                  trend="down"
                />
                <MetricCard
                  title="Portfolio Volatility"
                  value={`${(latestRisk.volatility * 100).toFixed(2)}%`}
                  subtitle="Annualized"
                  icon={Activity}
                />
                <MetricCard
                  title="Sharpe Ratio"
                  value={latestRisk.sharpe_ratio.toFixed(2)}
                  subtitle="Risk-adjusted return"
                  icon={BarChart3}
                  trend="up"
                />
              </div>

              <div className="bg-[#0f1419] border border-gray-800 rounded-lg p-6">
                <h2 className="text-xl font-bold text-white mb-6">Risk Metrics Details</h2>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div className="space-y-4">
                    <div className="bg-[#0a0e14] p-4 rounded-lg">
                      <p className="text-gray-400 text-sm mb-2">Maximum Drawdown</p>
                      <p className="text-2xl font-bold text-red-500">
                        {(latestRisk.max_drawdown * 100).toFixed(2)}%
                      </p>
                      <p className="text-xs text-gray-500 mt-2">Largest peak-to-trough decline</p>
                    </div>

                    <div className="bg-[#0a0e14] p-4 rounded-lg">
                      <p className="text-gray-400 text-sm mb-2">Calculation Date</p>
                      <p className="text-lg font-medium text-white">
                        {new Date(latestRisk.calculation_date).toLocaleString()}
                      </p>
                    </div>

                    <div className="bg-[#0a0e14] p-4 rounded-lg">
                      <p className="text-gray-400 text-sm mb-2">Horizon Period</p>
                      <p className="text-lg font-medium text-white">{latestRisk.horizon_days} days</p>
                    </div>
                  </div>

                  <div className="bg-[#0a0e14] p-4 rounded-lg">
                    <h3 className="text-sm font-bold text-white mb-4">Risk Interpretation</h3>
                    <div className="space-y-4 text-sm">
                      <div>
                        <p className="text-blue-400 font-medium mb-1">VaR ({(confidence * 100).toFixed(0)}%)</p>
                        <p className="text-gray-400">
                          With {(confidence * 100).toFixed(0)}% confidence, your portfolio will not lose more than ${latestRisk.var_value.toLocaleString(undefined, { maximumFractionDigits: 0 })} over the next {latestRisk.horizon_days} day(s).
                        </p>
                      </div>

                      <div>
                        <p className="text-blue-400 font-medium mb-1">CVaR (Expected Shortfall)</p>
                        <p className="text-gray-400">
                          In the worst {((1 - confidence) * 100).toFixed(0)}% of cases, the average loss would be ${latestRisk.cvar_value.toLocaleString(undefined, { maximumFractionDigits: 0 })}.
                        </p>
                      </div>

                      <div>
                        <p className="text-blue-400 font-medium mb-1">Volatility</p>
                        <p className="text-gray-400">
                          Your portfolio's annualized volatility is {(latestRisk.volatility * 100).toFixed(2)}%. {latestRisk.volatility < 0.15 ? 'Low risk' : latestRisk.volatility < 0.25 ? 'Moderate risk' : 'High risk'} profile.
                        </p>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              <div className="bg-[#0f1419] border border-gray-800 rounded-lg p-6">
                <h2 className="text-xl font-bold text-white mb-6">Risk Calculation History</h2>

                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead>
                      <tr className="border-b border-gray-800">
                        <th className="text-left py-3 px-4 text-gray-400 font-medium text-sm">Date</th>
                        <th className="text-right py-3 px-4 text-gray-400 font-medium text-sm">Horizon</th>
                        <th className="text-right py-3 px-4 text-gray-400 font-medium text-sm">VaR</th>
                        <th className="text-right py-3 px-4 text-gray-400 font-medium text-sm">CVaR</th>
                        <th className="text-right py-3 px-4 text-gray-400 font-medium text-sm">Volatility</th>
                        <th className="text-right py-3 px-4 text-gray-400 font-medium text-sm">Sharpe</th>
                      </tr>
                    </thead>
                    <tbody>
                      {riskHistory.map((risk) => (
                        <tr key={risk.id} className="border-b border-gray-800/50 hover:bg-gray-800/30">
                          <td className="py-3 px-4 text-white text-sm">
                            {new Date(risk.calculation_date).toLocaleDateString()}
                          </td>
                          <td className="py-3 px-4 text-right text-gray-300 text-sm">
                            {risk.horizon_days}d
                          </td>
                          <td className="py-3 px-4 text-right text-white text-sm">
                            ${risk.var_value.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                          </td>
                          <td className="py-3 px-4 text-right text-white text-sm">
                            ${risk.cvar_value.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                          </td>
                          <td className="py-3 px-4 text-right text-white text-sm">
                            {(risk.volatility * 100).toFixed(2)}%
                          </td>
                          <td className="py-3 px-4 text-right text-white text-sm">
                            {risk.sharpe_ratio.toFixed(2)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          ) : (
            <div className="bg-[#0f1419] border border-gray-800 rounded-lg p-12 text-center">
              <TrendingDown size={48} className="mx-auto mb-4 text-gray-600" />
              <p className="text-gray-400 mb-4">No risk calculations available</p>
              <p className="text-sm text-gray-500 mb-6">
                Select a portfolio and calculate risk metrics to see detailed analysis
              </p>
              <button
                onClick={calculateRisk}
                disabled={!selectedPortfolio}
                className="px-6 py-3 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-700 disabled:cursor-not-allowed text-white rounded-lg font-medium transition-colors"
              >
                Calculate Risk Now
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
