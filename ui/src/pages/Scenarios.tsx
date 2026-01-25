import { useState, useEffect, type FormEvent } from 'react';
import { Zap, Plus, Play } from 'lucide-react';
import { Portfolio, Scenario, ScenarioResult } from '../types';
import { api } from '../lib/api';

export default function Scenarios() {
  const [portfolios, setPortfolios] = useState<Portfolio[]>([]);
  const [selectedPortfolio, setSelectedPortfolio] = useState<Portfolio | null>(null);
  const [scenarios, setScenarios] = useState<Scenario[]>([]);
  const [results, setResults] = useState<ScenarioResult[]>([]);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [running, setRunning] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadData();
  }, []);

  useEffect(() => {
    if (selectedPortfolio) {
      loadResults(selectedPortfolio.id);
    }
  }, [selectedPortfolio]);

  const loadData = async () => {
    try {
      setError(null);
      const [portfoliosData, scenariosData] = await Promise.all([api.getPortfolios(), api.getScenarios()]);
      setPortfolios(portfoliosData || []);
      setScenarios(scenariosData || []);

      if (portfoliosData && portfoliosData.length > 0) {
        setSelectedPortfolio(portfoliosData[0]);
      } else {
        setSelectedPortfolio(null);
      }
    } catch (e) {
      console.error('Error loading scenarios data:', e);
      setError('Failed to load scenarios data from backend API.');
    } finally {
      setLoading(false);
    }
  };

  const loadResults = async (portfolioId: string) => {
    try {
      setError(null);
      const data = await api.getScenarioResults(portfolioId);
      setResults(data || []);
    } catch (e) {
      console.error('Error loading scenario results:', e);
      setError('Failed to load scenario results from backend API.');
      setResults([]);
    }
  };

  const runScenario = async (scenarioId: string) => {
    if (!selectedPortfolio) return;

    setRunning(true);
    try {
      setError(null);
      await api.runScenario(selectedPortfolio.id, scenarioId);
      await loadResults(selectedPortfolio.id);
    } catch (error) {
      console.error('Error running scenario:', error);
      setError('Failed to run scenario via backend API.');
    } finally {
      setRunning(false);
    }
  };

  const createScenario = async (
    name: string,
    description: string,
    scenarioType: string,
    parameters: Record<string, unknown>
  ) => {
    try {
      setError(null);
      const created = await api.createScenario({
        name,
        description,
        scenario_type: scenarioType,
        parameters,
      });

      await loadData();
      setShowCreateModal(false);
      return created;
    } catch (error) {
      console.error('Error creating scenario:', error);
      setError('Failed to create scenario via backend API.');
      return undefined;
    }
  };

  const predefinedScenarios = [
    {
      name: 'Market Crash (-20%)',
      description: 'Simulate a major market downturn',
      type: 'market_crash',
      parameters: { market_change: -20 },
      color: 'bg-red-900/20 border-red-500/50',
    },
    {
      name: 'Interest Rate Hike (+2%)',
      description: 'Central bank raises rates by 2%',
      type: 'rate_change',
      parameters: { rate_change: 2 },
      color: 'bg-yellow-900/20 border-yellow-500/50',
    },
    {
      name: 'Sector Rotation',
      description: 'Tech -15%, Value +10%',
      type: 'sector_rotation',
      parameters: { tech_change: -15, value_change: 10 },
      color: 'bg-blue-900/20 border-blue-500/50',
    },
    {
      name: 'Currency Crisis',
      description: 'Base currency devalues by 10%',
      type: 'currency_crisis',
      parameters: { currency_change: -10 },
      color: 'bg-purple-900/20 border-purple-500/50',
    },
  ];

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-gray-400">Loading scenarios...</div>
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
          <h1 className="text-3xl font-bold text-white mb-2">Scenario Analysis</h1>
          <p className="text-gray-400">Stress test your portfolios under various market conditions</p>
        </div>
        <button
          onClick={() => setShowCreateModal(true)}
          className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-medium transition-colors flex items-center gap-2"
        >
          <Plus size={18} />
          Custom Scenario
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
        </div>

        <div className="lg:col-span-3 space-y-6">
          <div className="bg-[#0f1419] border border-gray-800 rounded-lg p-6">
            <h2 className="text-xl font-bold text-white mb-6">Predefined Stress Tests</h2>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {predefinedScenarios.map((scenario, index) => (
                <div key={index} className={`border rounded-lg p-5 ${scenario.color}`}>
                  <div className="flex items-start justify-between mb-3">
                    <div>
                      <h3 className="font-bold text-white mb-1">{scenario.name}</h3>
                      <p className="text-sm text-gray-400">{scenario.description}</p>
                    </div>
                    <Zap size={20} className="text-yellow-500" />
                  </div>

                  <div className="bg-black/30 rounded p-3 mb-4 text-xs font-mono text-gray-300">
                    {Object.entries(scenario.parameters).map(([key, value]) => (
                      <div key={key}>
                        {key}: {value}
                      </div>
                    ))}
                  </div>

                  <button
                    onClick={() => {
                      createScenario(
                        scenario.name,
                        scenario.description,
                        scenario.type,
                        scenario.parameters
                      ).then((created) => {
                        if (created) runScenario(created.id);
                      });
                    }}
                    disabled={running || !selectedPortfolio}
                    className="w-full px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-700 disabled:cursor-not-allowed text-white rounded-lg font-medium transition-colors flex items-center justify-center gap-2"
                  >
                    <Play size={16} />
                    Run Scenario
                  </button>
                </div>
              ))}
            </div>
          </div>

          <div className="bg-[#0f1419] border border-gray-800 rounded-lg p-6">
            <h2 className="text-xl font-bold text-white mb-6">Custom Scenarios</h2>

            {scenarios.length === 0 ? (
              <div className="text-center py-8 text-gray-500">
                <Zap size={48} className="mx-auto mb-4 text-gray-600" />
                <p>No custom scenarios created yet</p>
                <p className="text-sm mt-2">Create your first custom scenario to get started</p>
              </div>
            ) : (
              <div className="space-y-3">
                {scenarios.map((scenario) => (
                  <div
                    key={scenario.id}
                    className="flex items-center justify-between p-4 bg-[#0a0e14] rounded-lg"
                  >
                    <div className="flex-1">
                      <p className="font-medium text-white">{scenario.name}</p>
                      <p className="text-sm text-gray-400 mt-1">{scenario.description}</p>
                      <p className="text-xs text-gray-500 mt-2">
                        Type: {scenario.scenario_type}
                      </p>
                    </div>
                    <button
                      onClick={() => runScenario(scenario.id)}
                      disabled={running || !selectedPortfolio}
                      className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-700 disabled:cursor-not-allowed text-white rounded-lg font-medium transition-colors"
                    >
                      Run
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="bg-[#0f1419] border border-gray-800 rounded-lg p-6">
            <h2 className="text-xl font-bold text-white mb-6">Scenario Results</h2>

            {results.length === 0 ? (
              <div className="text-center py-8 text-gray-500">
                <p>No scenario results yet</p>
                <p className="text-sm mt-2">Run a scenario to see the impact on your portfolio</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-gray-800">
                      <th className="text-left py-3 px-4 text-gray-400 font-medium text-sm">Scenario</th>
                      <th className="text-right py-3 px-4 text-gray-400 font-medium text-sm">
                        Value Change
                      </th>
                      <th className="text-right py-3 px-4 text-gray-400 font-medium text-sm">
                        VaR Change
                      </th>
                      <th className="text-right py-3 px-4 text-gray-400 font-medium text-sm">
                        Vol. Change
                      </th>
                      <th className="text-right py-3 px-4 text-gray-400 font-medium text-sm">Date</th>
                    </tr>
                  </thead>
                  <tbody>
                    {results.map((result) => (
                      <tr key={result.id} className="border-b border-gray-800/50 hover:bg-gray-800/30">
                        <td className="py-3 px-4 text-white">{result.scenario?.name}</td>
                        <td
                          className={`py-3 px-4 text-right font-medium ${
                            result.portfolio_value_change < 0 ? 'text-red-500' : 'text-green-500'
                          }`}
                        >
                          {result.portfolio_value_change > 0 ? '+' : ''}$
                          {result.portfolio_value_change.toLocaleString(undefined, {
                            maximumFractionDigits: 0,
                          })}
                        </td>
                        <td
                          className={`py-3 px-4 text-right font-medium ${
                            result.var_change < 0 ? 'text-green-500' : 'text-red-500'
                          }`}
                        >
                          {result.var_change > 0 ? '+' : ''}$
                          {result.var_change.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                        </td>
                        <td
                          className={`py-3 px-4 text-right font-medium ${
                            result.volatility_change < 0 ? 'text-green-500' : 'text-red-500'
                          }`}
                        >
                          {result.volatility_change > 0 ? '+' : ''}
                          {(result.volatility_change * 100).toFixed(2)}%
                        </td>
                        <td className="py-3 px-4 text-right text-gray-400 text-sm">
                          {new Date(result.calculated_at).toLocaleDateString()}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      </div>

      {showCreateModal && (
        <CreateScenarioModal
          onClose={() => setShowCreateModal(false)}
          onCreate={async (...args) => {
            await createScenario(...args);
          }}
        />
      )}
    </div>
  );
}

interface CreateScenarioModalProps {
  onClose: () => void;
  onCreate: (
    name: string,
    description: string,
    scenarioType: string,
    parameters: Record<string, unknown>
  ) => void;
}

function CreateScenarioModal({ onClose, onCreate }: CreateScenarioModalProps) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [scenarioType, setScenarioType] = useState('market_crash');
  const [marketChange, setMarketChange] = useState('-10');

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    onCreate(name, description, scenarioType, {
      market_change: parseFloat(marketChange),
    });
  };

  return (
    <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50">
      <div className="bg-[#0f1419] border border-gray-800 rounded-lg p-6 w-full max-w-md">
        <h2 className="text-2xl font-bold text-white mb-6">Create Custom Scenario</h2>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-gray-400 text-sm font-medium mb-2">Scenario Name</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full bg-[#0a0e14] border border-gray-800 rounded-lg px-4 py-3 text-white focus:border-blue-500 focus:outline-none"
              placeholder="My Custom Scenario"
              required
            />
          </div>
          <div>
            <label className="block text-gray-400 text-sm font-medium mb-2">Description</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="w-full bg-[#0a0e14] border border-gray-800 rounded-lg px-4 py-3 text-white focus:border-blue-500 focus:outline-none"
              placeholder="Describe the scenario"
              rows={3}
              required
            />
          </div>
          <div>
            <label className="block text-gray-400 text-sm font-medium mb-2">Scenario Type</label>
            <select
              value={scenarioType}
              onChange={(e) => setScenarioType(e.target.value)}
              className="w-full bg-[#0a0e14] border border-gray-800 rounded-lg px-4 py-3 text-white focus:border-blue-500 focus:outline-none"
            >
              <option value="market_crash">Market Crash</option>
              <option value="rate_change">Interest Rate Change</option>
              <option value="sector_rotation">Sector Rotation</option>
              <option value="currency_crisis">Currency Crisis</option>
              <option value="custom">Custom</option>
            </select>
          </div>
          <div>
            <label className="block text-gray-400 text-sm font-medium mb-2">
              Market Change (%)
            </label>
            <input
              type="number"
              step="0.1"
              value={marketChange}
              onChange={(e) => setMarketChange(e.target.value)}
              className="w-full bg-[#0a0e14] border border-gray-800 rounded-lg px-4 py-3 text-white focus:border-blue-500 focus:outline-none"
              placeholder="-10"
              required
            />
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
              Create Scenario
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
