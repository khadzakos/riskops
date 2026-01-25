import { useEffect, useState, type FormEvent } from 'react';
import { Plus, Edit2, Trash2, Upload } from 'lucide-react';
import { Portfolio, PortfolioPosition } from '../types';
import { api } from '../lib/api';

export default function Portfolios() {
  const [portfolios, setPortfolios] = useState<Portfolio[]>([]);
  const [selectedPortfolio, setSelectedPortfolio] = useState<Portfolio | null>(null);
  const [positions, setPositions] = useState<PortfolioPosition[]>([]);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadPortfolios();
  }, []);

  useEffect(() => {
    if (selectedPortfolio) {
      loadPositions(selectedPortfolio.id);
    }
  }, [selectedPortfolio]);

  const loadPortfolios = async () => {
    try {
      setError(null);
      const data = await api.getPortfolios();

      setPortfolios(data || []);
      if (data && data.length > 0 && !selectedPortfolio) {
        setSelectedPortfolio(data[0]);
      }
    } catch (error) {
      console.error('Error loading portfolios:', error);
      setError('Failed to load portfolios from backend API.');
    } finally {
      setLoading(false);
    }
  };

  const loadPositions = async (portfolioId: string) => {
    try {
      setError(null);
      const data = await api.getPortfolioPositions(portfolioId);

      setPositions(data || []);
    } catch (error) {
      console.error('Error loading positions:', error);
      setError('Failed to load positions from backend API.');
    }
  };

  const createPortfolio = async (name: string, description: string, currency: string) => {
    try {
      setError(null);
      await api.createPortfolio({ name, description, currency });
      await loadPortfolios();
      setShowCreateModal(false);
    } catch (error) {
      console.error('Error creating portfolio:', error);
      setError('Failed to create portfolio via backend API.');
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-gray-400">Loading portfolios...</div>
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
          <h1 className="text-3xl font-bold text-white mb-2">Portfolio Management</h1>
          <p className="text-gray-400">Create and manage your investment portfolios</p>
        </div>
        <div className="flex gap-3">
          <button className="px-4 py-2 bg-gray-800 hover:bg-gray-700 text-white rounded-lg font-medium transition-colors flex items-center gap-2">
            <Upload size={18} />
            Import CSV
          </button>
          <button
            onClick={() => setShowCreateModal(true)}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-medium transition-colors flex items-center gap-2"
          >
            <Plus size={18} />
            New Portfolio
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
        <div className="lg:col-span-1 bg-[#0f1419] border border-gray-800 rounded-lg p-4">
          <h2 className="text-lg font-bold text-white mb-4">Your Portfolios</h2>
          <div className="space-y-2">
            {portfolios.map((portfolio) => (
              <button
                key={portfolio.id}
                onClick={() => setSelectedPortfolio(portfolio)}
                className={`w-full text-left p-4 rounded-lg transition-colors ${
                  selectedPortfolio?.id === portfolio.id
                    ? 'bg-blue-600 text-white'
                    : 'bg-[#0a0e14] text-gray-300 hover:bg-gray-800'
                }`}
              >
                <p className="font-medium">{portfolio.name}</p>
                <p className="text-sm opacity-75 mt-1">{portfolio.currency}</p>
              </button>
            ))}
          </div>
        </div>

        <div className="lg:col-span-3 space-y-6">
          {selectedPortfolio ? (
            <>
              <div className="bg-[#0f1419] border border-gray-800 rounded-lg p-6">
                <div className="flex items-start justify-between mb-6">
                  <div>
                    <h2 className="text-2xl font-bold text-white mb-2">{selectedPortfolio.name}</h2>
                    <p className="text-gray-400">{selectedPortfolio.description}</p>
                  </div>
                  <div className="flex gap-2">
                    <button className="p-2 bg-gray-800 hover:bg-gray-700 rounded-lg transition-colors">
                      <Edit2 size={18} className="text-gray-400" />
                    </button>
                    <button className="p-2 bg-red-900/20 hover:bg-red-900/30 rounded-lg transition-colors">
                      <Trash2 size={18} className="text-red-500" />
                    </button>
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-4">
                  <div className="bg-[#0a0e14] p-4 rounded-lg">
                    <p className="text-gray-400 text-sm mb-1">Total Value</p>
                    <p className="text-2xl font-bold text-white">N/A</p>
                  </div>
                  <div className="bg-[#0a0e14] p-4 rounded-lg">
                    <p className="text-gray-400 text-sm mb-1">Positions</p>
                    <p className="text-2xl font-bold text-white">{positions.length}</p>
                  </div>
                  <div className="bg-[#0a0e14] p-4 rounded-lg">
                    <p className="text-gray-400 text-sm mb-1">Daily Change</p>
                    <p className="text-2xl font-bold text-white">N/A</p>
                  </div>
                </div>
              </div>

              <div className="bg-[#0f1419] border border-gray-800 rounded-lg p-6">
                <div className="flex items-center justify-between mb-6">
                  <h3 className="text-xl font-bold text-white">Portfolio Composition</h3>
                  <button className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-medium transition-colors flex items-center gap-2">
                    <Plus size={18} />
                    Add Position
                  </button>
                </div>

                {positions.length === 0 ? (
                  <div className="text-center py-12 text-gray-500">
                    <p>No positions in this portfolio</p>
                    <p className="text-sm mt-2">Add your first position to get started</p>
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full">
                      <thead>
                        <tr className="border-b border-gray-800">
                          <th className="text-left py-3 px-4 text-gray-400 font-medium text-sm">Ticker</th>
                          <th className="text-left py-3 px-4 text-gray-400 font-medium text-sm">Name</th>
                          <th className="text-right py-3 px-4 text-gray-400 font-medium text-sm">Quantity</th>
                          <th className="text-right py-3 px-4 text-gray-400 font-medium text-sm">Weight</th>
                          <th className="text-right py-3 px-4 text-gray-400 font-medium text-sm">Avg Price</th>
                          <th className="text-right py-3 px-4 text-gray-400 font-medium text-sm">Value</th>
                          <th className="text-right py-3 px-4 text-gray-400 font-medium text-sm">Actions</th>
                        </tr>
                      </thead>
                      <tbody>
                        {positions.map((position) => (
                          <tr key={position.id} className="border-b border-gray-800/50 hover:bg-gray-800/30">
                            <td className="py-4 px-4">
                              <span className="font-mono text-white font-medium">
                                {position.asset?.ticker}
                              </span>
                            </td>
                            <td className="py-4 px-4 text-gray-300">{position.asset?.name}</td>
                            <td className="py-4 px-4 text-right text-white">{position.quantity}</td>
                            <td className="py-4 px-4 text-right text-white">
                              {(position.weight * 100).toFixed(2)}%
                            </td>
                            <td className="py-4 px-4 text-right text-white">
                              ${position.avg_purchase_price.toFixed(2)}
                            </td>
                            <td className="py-4 px-4 text-right text-white">
                              ${(position.quantity * position.avg_purchase_price).toLocaleString()}
                            </td>
                            <td className="py-4 px-4 text-right">
                              <button className="text-blue-500 hover:text-blue-400 text-sm font-medium">
                                Edit
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </>
          ) : (
            <div className="bg-[#0f1419] border border-gray-800 rounded-lg p-12 text-center">
              <p className="text-gray-400 mb-4">No portfolio selected</p>
              <button
                onClick={() => setShowCreateModal(true)}
                className="px-6 py-3 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-medium transition-colors"
              >
                Create Your First Portfolio
              </button>
            </div>
          )}
        </div>
      </div>

      {showCreateModal && (
        <CreatePortfolioModal
          onClose={() => setShowCreateModal(false)}
          onCreate={createPortfolio}
        />
      )}
    </div>
  );
}

interface CreatePortfolioModalProps {
  onClose: () => void;
  onCreate: (name: string, description: string, currency: string) => void;
}

function CreatePortfolioModal({ onClose, onCreate }: CreatePortfolioModalProps) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [currency, setCurrency] = useState('USD');

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    onCreate(name, description, currency);
  };

  return (
    <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50">
      <div className="bg-[#0f1419] border border-gray-800 rounded-lg p-6 w-full max-w-md">
        <h2 className="text-2xl font-bold text-white mb-6">Create New Portfolio</h2>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-gray-400 text-sm font-medium mb-2">Portfolio Name</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full bg-[#0a0e14] border border-gray-800 rounded-lg px-4 py-3 text-white focus:border-blue-500 focus:outline-none"
              placeholder="My Portfolio"
              required
            />
          </div>
          <div>
            <label className="block text-gray-400 text-sm font-medium mb-2">Description</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="w-full bg-[#0a0e14] border border-gray-800 rounded-lg px-4 py-3 text-white focus:border-blue-500 focus:outline-none"
              placeholder="Optional description"
              rows={3}
            />
          </div>
          <div>
            <label className="block text-gray-400 text-sm font-medium mb-2">Base Currency</label>
            <select
              value={currency}
              onChange={(e) => setCurrency(e.target.value)}
              className="w-full bg-[#0a0e14] border border-gray-800 rounded-lg px-4 py-3 text-white focus:border-blue-500 focus:outline-none"
            >
              <option value="USD">USD - US Dollar</option>
              <option value="EUR">EUR - Euro</option>
              <option value="GBP">GBP - British Pound</option>
              <option value="RUB">RUB - Russian Ruble</option>
            </select>
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
              Create Portfolio
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
