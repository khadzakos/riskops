import { useState } from 'react';
import Sidebar from './components/Sidebar';
import Dashboard from './pages/Dashboard';
import Portfolios from './pages/Portfolios';
import RiskMetrics from './pages/RiskMetrics';
import Scenarios from './pages/Scenarios';
import Monitoring from './pages/Monitoring';

function App() {
  const [activeTab, setActiveTab] = useState('dashboard');

  const renderContent = () => {
    switch (activeTab) {
      case 'dashboard':
        return <Dashboard />;
      case 'portfolios':
        return <Portfolios />;
      case 'risk-metrics':
        return <RiskMetrics />;
      case 'scenarios':
        return <Scenarios />;
      case 'monitoring':
        return <Monitoring />;
      case 'settings':
        return (
          <div className="flex items-center justify-center h-full">
            <p className="text-gray-400">Settings page coming soon</p>
          </div>
        );
      default:
        return <Dashboard />;
    }
  };

  return (
    <div className="min-h-screen bg-[#0a0e14] flex">
      <Sidebar activeTab={activeTab} onTabChange={setActiveTab} />
      <main className="flex-1 p-8 overflow-auto">
        {renderContent()}
      </main>
    </div>
  );
}

export default App;
