import { useState, useEffect, type FormEvent } from 'react';
import { Bell, AlertTriangle, Plus, Check, X } from 'lucide-react';
import { Portfolio, RiskLimit, Alert } from '../types';
import { api } from '../lib/api';

export default function Monitoring() {
  const [portfolios, setPortfolios] = useState<Portfolio[]>([]);
  const [selectedPortfolio, setSelectedPortfolio] = useState<Portfolio | null>(null);
  const [riskLimits, setRiskLimits] = useState<RiskLimit[]>([]);
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [showLimitModal, setShowLimitModal] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadPortfolios();
  }, []);

  useEffect(() => {
    if (selectedPortfolio) {
      loadRiskLimits(selectedPortfolio.id);
      loadAlerts(selectedPortfolio.id);
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

  const loadRiskLimits = async (portfolioId: string) => {
    try {
      setError(null);
      const data = await api.getRiskLimits(portfolioId);
      setRiskLimits(data || []);
    } catch (e) {
      console.error('Error loading risk limits:', e);
      setError('Failed to load risk limits from backend API.');
      setRiskLimits([]);
    }
  };

  const loadAlerts = async (portfolioId: string) => {
    try {
      setError(null);
      const data = await api.getAlerts(portfolioId);
      setAlerts(data || []);
    } catch (e) {
      console.error('Error loading alerts:', e);
      setError('Failed to load alerts from backend API.');
      setAlerts([]);
    }
  };

  const createRiskLimit = async (limitType: string, thresholdValue: number) => {
    if (!selectedPortfolio) return;

    try {
      setError(null);
      await api.createRiskLimit(selectedPortfolio.id, { limit_type: limitType, threshold_value: thresholdValue });
      await loadRiskLimits(selectedPortfolio.id);
      setShowLimitModal(false);
    } catch (error) {
      console.error('Error creating risk limit:', error);
      setError('Failed to create risk limit via backend API.');
    }
  };

  const toggleLimit = async (limitId: string, isActive: boolean) => {
    try {
      setError(null);
      await api.updateRiskLimit(limitId, { is_active: !isActive });

      if (selectedPortfolio) {
        loadRiskLimits(selectedPortfolio.id);
      }
    } catch (e) {
      console.error('Error toggling risk limit:', e);
      setError('Failed to update risk limit via backend API.');
    }
  };

  const markAlertAsRead = async (alertId: string) => {
    try {
      setError(null);
      await api.markAlertRead(alertId);

      if (selectedPortfolio) {
        loadAlerts(selectedPortfolio.id);
      }
    } catch (e) {
      console.error('Error marking alert as read:', e);
      setError('Failed to mark alert as read via backend API.');
    }
  };

  const unreadAlerts = alerts.filter((a) => !a.is_read);
  const readAlerts = alerts.filter((a) => a.is_read);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-gray-400">Loading monitoring...</div>
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
          <h1 className="text-3xl font-bold text-white mb-2">Risk Monitoring</h1>
          <p className="text-gray-400">Set risk limits and receive alerts when thresholds are breached</p>
        </div>
        <button
          onClick={() => setShowLimitModal(true)}
          className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-medium transition-colors flex items-center gap-2"
        >
          <Plus size={18} />
          Add Risk Limit
        </button>
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
            <h3 className="text-sm font-bold text-white mb-3">Alert Summary</h3>
            <div className="space-y-2">
              <div className="flex items-center justify-between p-3 bg-[#0a0e14] rounded-lg">
                <span className="text-gray-400 text-sm">Unread</span>
                <span className="text-red-500 font-bold">{unreadAlerts.length}</span>
              </div>
              <div className="flex items-center justify-between p-3 bg-[#0a0e14] rounded-lg">
                <span className="text-gray-400 text-sm">Total Alerts</span>
                <span className="text-white font-bold">{alerts.length}</span>
              </div>
              <div className="flex items-center justify-between p-3 bg-[#0a0e14] rounded-lg">
                <span className="text-gray-400 text-sm">Active Limits</span>
                <span className="text-blue-500 font-bold">
                  {riskLimits.filter((l) => l.is_active).length}
                </span>
              </div>
            </div>
          </div>
        </div>

        <div className="lg:col-span-3 space-y-6">
          <div className="bg-[#0f1419] border border-gray-800 rounded-lg p-6">
            <h2 className="text-xl font-bold text-white mb-6">Risk Limits</h2>

            {riskLimits.length === 0 ? (
              <div className="text-center py-8 text-gray-500">
                <Bell size={48} className="mx-auto mb-4 text-gray-600" />
                <p>No risk limits configured</p>
                <p className="text-sm mt-2">Add your first risk limit to start monitoring</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {riskLimits.map((limit) => (
                  <div
                    key={limit.id}
                    className={`border rounded-lg p-5 ${
                      limit.is_active
                        ? 'bg-blue-900/10 border-blue-500/50'
                        : 'bg-gray-800/20 border-gray-700'
                    }`}
                  >
                    <div className="flex items-start justify-between mb-3">
                      <div>
                        <h3 className="font-bold text-white mb-1">
                          {limit.limit_type.replace(/_/g, ' ').toUpperCase()}
                        </h3>
                        <p className="text-2xl font-bold text-blue-500">
                          {limit.limit_type.includes('percentage') || limit.limit_type.includes('concentration')
                            ? `${limit.threshold_value}%`
                            : `$${limit.threshold_value.toLocaleString()}`}
                        </p>
                      </div>
                      <button
                        onClick={() => toggleLimit(limit.id, limit.is_active)}
                        className={`p-2 rounded-lg transition-colors ${
                          limit.is_active
                            ? 'bg-green-500/20 text-green-500 hover:bg-green-500/30'
                            : 'bg-gray-700 text-gray-400 hover:bg-gray-600'
                        }`}
                      >
                        {limit.is_active ? <Check size={18} /> : <X size={18} />}
                      </button>
                    </div>

                    <p className="text-xs text-gray-400">
                      Status: {limit.is_active ? 'Active' : 'Inactive'}
                    </p>
                    <p className="text-xs text-gray-500 mt-1">
                      Created: {new Date(limit.created_at).toLocaleDateString()}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="bg-[#0f1419] border border-gray-800 rounded-lg p-6">
            <h2 className="text-xl font-bold text-white mb-6 flex items-center gap-2">
              <Bell className="text-blue-500" />
              Alert History
            </h2>

            {alerts.length === 0 ? (
              <div className="text-center py-8 text-gray-500">
                <p>No alerts yet</p>
                <p className="text-sm mt-2">Alerts will appear here when risk limits are breached</p>
              </div>
            ) : (
              <div className="space-y-4">
                {unreadAlerts.length > 0 && (
                  <div>
                    <h3 className="text-sm font-bold text-white mb-3">Unread Alerts</h3>
                    <div className="space-y-3">
                      {unreadAlerts.map((alert) => (
                        <div
                          key={alert.id}
                          className={`p-4 rounded-lg border ${
                            alert.severity === 'critical'
                              ? 'bg-red-500/10 border-red-500/50'
                              : 'bg-yellow-500/10 border-yellow-500/50'
                          }`}
                        >
                          <div className="flex items-start justify-between">
                            <div className="flex items-start gap-3 flex-1">
                              <AlertTriangle
                                size={20}
                                className={
                                  alert.severity === 'critical' ? 'text-red-500' : 'text-yellow-500'
                                }
                              />
                              <div className="flex-1">
                                <p className="font-medium text-white">{alert.alert_type}</p>
                                <p className="text-sm text-gray-300 mt-1">{alert.message}</p>
                                <p className="text-xs text-gray-500 mt-2">
                                  {new Date(alert.created_at).toLocaleString()}
                                </p>
                              </div>
                            </div>
                            <button
                              onClick={() => markAlertAsRead(alert.id)}
                              className="px-3 py-1 bg-blue-600 hover:bg-blue-700 text-white text-sm rounded transition-colors"
                            >
                              Mark Read
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {readAlerts.length > 0 && (
                  <div>
                    <h3 className="text-sm font-bold text-white mb-3">Read Alerts</h3>
                    <div className="space-y-3">
                      {readAlerts.map((alert) => (
                        <div
                          key={alert.id}
                          className="p-4 rounded-lg bg-gray-800/30 border border-gray-700 opacity-60"
                        >
                          <div className="flex items-start gap-3">
                            <AlertTriangle
                              size={18}
                              className={alert.severity === 'critical' ? 'text-red-500' : 'text-yellow-500'}
                            />
                            <div className="flex-1">
                              <p className="font-medium text-white text-sm">{alert.alert_type}</p>
                              <p className="text-xs text-gray-400 mt-1">{alert.message}</p>
                              <p className="text-xs text-gray-500 mt-2">
                                {new Date(alert.created_at).toLocaleString()}
                              </p>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {showLimitModal && (
        <CreateLimitModal onClose={() => setShowLimitModal(false)} onCreate={createRiskLimit} />
      )}
    </div>
  );
}

interface CreateLimitModalProps {
  onClose: () => void;
  onCreate: (limitType: string, thresholdValue: number) => void;
}

function CreateLimitModal({ onClose, onCreate }: CreateLimitModalProps) {
  const [limitType, setLimitType] = useState('max_var');
  const [thresholdValue, setThresholdValue] = useState('50000');

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    onCreate(limitType, parseFloat(thresholdValue));
  };

  const limitTypes = [
    { value: 'max_var', label: 'Maximum VaR', unit: '$' },
    { value: 'max_cvar', label: 'Maximum CVaR', unit: '$' },
    { value: 'max_volatility', label: 'Maximum Volatility', unit: '%' },
    { value: 'max_concentration', label: 'Maximum Asset Concentration', unit: '%' },
    { value: 'min_diversification', label: 'Minimum Diversification', unit: 'assets' },
    { value: 'max_drawdown', label: 'Maximum Drawdown', unit: '%' },
  ];

  return (
    <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50">
      <div className="bg-[#0f1419] border border-gray-800 rounded-lg p-6 w-full max-w-md">
        <h2 className="text-2xl font-bold text-white mb-6">Add Risk Limit</h2>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-gray-400 text-sm font-medium mb-2">Limit Type</label>
            <select
              value={limitType}
              onChange={(e) => setLimitType(e.target.value)}
              className="w-full bg-[#0a0e14] border border-gray-800 rounded-lg px-4 py-3 text-white focus:border-blue-500 focus:outline-none"
            >
              {limitTypes.map((type) => (
                <option key={type.value} value={type.value}>
                  {type.label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-gray-400 text-sm font-medium mb-2">
              Threshold Value {limitTypes.find((t) => t.value === limitType)?.unit}
            </label>
            <input
              type="number"
              step="0.01"
              value={thresholdValue}
              onChange={(e) => setThresholdValue(e.target.value)}
              className="w-full bg-[#0a0e14] border border-gray-800 rounded-lg px-4 py-3 text-white focus:border-blue-500 focus:outline-none"
              placeholder="50000"
              required
            />
          </div>
          <div className="bg-blue-900/20 border border-blue-500/50 rounded-lg p-4">
            <p className="text-sm text-blue-400">
              You will receive alerts when this limit is breached. Make sure to configure Telegram
              notifications in settings.
            </p>
          </div>
          <div className="flex gap-3 pt-4">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 px-4 py-3 bg-gray-800 hover:bg-gray-700 text-white rounded-lg font-medium transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="flex-1 px-4 py-3 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-medium transition-colors"
            >
              Add Limit
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
