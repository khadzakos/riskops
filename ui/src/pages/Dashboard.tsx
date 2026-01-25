import { useEffect, useState } from 'react';
import { TrendingUp, TrendingDown, AlertTriangle, DollarSign, Activity, PieChart } from 'lucide-react';
import MetricCard from '../components/MetricCard';
import { Portfolio, RiskCalculation, Alert } from '../types';
import { api } from '../lib/api';

export default function Dashboard() {
  const [portfolios, setPortfolios] = useState<Portfolio[]>([]);
  const [latestRisk, setLatestRisk] = useState<RiskCalculation | null>(null);
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadDashboardData();
  }, []);

  const loadDashboardData = async () => {
    try {
      setError(null);
      const portfoliosData = await api.getPortfolios();
      setPortfolios(portfoliosData || []);

      const first = portfoliosData?.[0];
      if (first) {
        const [riskData, alertsData] = await Promise.all([
          api.getLatestRiskCalculation(first.id),
          api.getAlerts(first.id, { unreadOnly: true, limit: 5 }),
        ]);
        setLatestRisk(riskData);
        setAlerts(alertsData || []);
      } else {
        setLatestRisk(null);
        setAlerts([]);
      }
    } catch (error) {
      console.error('Error loading dashboard:', error);
      setError('Failed to load dashboard data from backend API.');
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-gray-400">Loading dashboard...</div>
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
          <h1 className="text-3xl font-bold text-white mb-2">Risk Analytics Dashboard</h1>
          <p className="text-gray-400">Real-time portfolio risk monitoring and assessment</p>
        </div>
        <button className="px-6 py-3 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-medium transition-colors">
          Calculate Risks
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <MetricCard
          title="Portfolio Value"
          value="N/A"
          subtitle="Provided by backend"
          icon={DollarSign}
          trend="neutral"
        />
        <MetricCard
          title="VaR (95%)"
          value={latestRisk ? `$${latestRisk.var_value.toLocaleString()}` : 'N/A'}
          subtitle="1-day horizon"
          icon={TrendingDown}
          trend="neutral"
        />
        <MetricCard
          title="CVaR"
          value={latestRisk ? `$${latestRisk.cvar_value.toLocaleString()}` : 'N/A'}
          subtitle="Expected shortfall"
          icon={AlertTriangle}
          trend="down"
          trendValue="-2.1%"
        />
        <MetricCard
          title="Volatility"
          value={latestRisk ? `${(latestRisk.volatility * 100).toFixed(2)}%` : 'N/A'}
          subtitle="Annualized"
          icon={Activity}
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 bg-[#0f1419] border border-gray-800 rounded-lg p-6">
          <h2 className="text-xl font-bold text-white mb-4 flex items-center gap-2">
            <TrendingUp size={24} className="text-blue-500" />
            Portfolio Performance
          </h2>
          <div className="h-80 flex items-center justify-center text-gray-500">
            <div className="text-center">
              <PieChart size={48} className="mx-auto mb-4 text-gray-600" />
              <p>Performance chart will be displayed here</p>
              <p className="text-sm mt-2">Connect your portfolio to see data</p>
            </div>
          </div>
        </div>

        <div className="bg-[#0f1419] border border-gray-800 rounded-lg p-6">
          <h2 className="text-xl font-bold text-white mb-4 flex items-center gap-2">
            <AlertTriangle size={24} className="text-blue-500" />
            Active Alerts
          </h2>
          <div className="space-y-3">
            {alerts.length === 0 ? (
              <div className="text-center py-8 text-gray-500">
                <p>No active alerts</p>
                <p className="text-sm mt-2">All risk limits are within thresholds</p>
              </div>
            ) : (
              alerts.map((alert) => (
                <div
                  key={alert.id}
                  className={`p-4 rounded-lg border ${
                    alert.severity === 'critical'
                      ? 'bg-red-500/10 border-red-500/50'
                      : 'bg-yellow-500/10 border-yellow-500/50'
                  }`}
                >
                  <div className="flex items-start gap-3">
                    <AlertTriangle
                      size={18}
                      className={alert.severity === 'critical' ? 'text-red-500' : 'text-yellow-500'}
                    />
                    <div className="flex-1">
                      <p className="text-sm font-medium text-white">{alert.alert_type}</p>
                      <p className="text-xs text-gray-400 mt-1">{alert.message}</p>
                      <p className="text-xs text-gray-500 mt-2">
                        {new Date(alert.created_at).toLocaleString()}
                      </p>
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-[#0f1419] border border-gray-800 rounded-lg p-6">
          <h2 className="text-xl font-bold text-white mb-4">Recent Portfolios</h2>
          <div className="space-y-3">
            {portfolios.length === 0 ? (
              <div className="text-center py-8 text-gray-500">
                <p>No portfolios yet</p>
                <p className="text-sm mt-2">Create your first portfolio to get started</p>
              </div>
            ) : (
              portfolios.slice(0, 5).map((portfolio) => (
                <div
                  key={portfolio.id}
                  className="flex items-center justify-between p-4 bg-[#0a0e14] rounded-lg hover:bg-gray-800/50 transition-colors cursor-pointer"
                >
                  <div>
                    <p className="font-medium text-white">{portfolio.name}</p>
                    <p className="text-sm text-gray-500">{portfolio.currency}</p>
                  </div>
                  <button className="text-blue-500 hover:text-blue-400 text-sm font-medium">
                    View Details →
                  </button>
                </div>
              ))
            )}
          </div>
        </div>

        <div className="bg-[#0f1419] border border-gray-800 rounded-lg p-6">
          <h2 className="text-xl font-bold text-white mb-4">Risk Distribution</h2>
          <div className="h-64 flex items-center justify-center text-gray-500">
            <div className="text-center">
              <PieChart size={48} className="mx-auto mb-4 text-gray-600" />
              <p>Risk breakdown chart</p>
              <p className="text-sm mt-2">By sector and asset class</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
