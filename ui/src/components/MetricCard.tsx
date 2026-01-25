import { LucideIcon } from 'lucide-react';

interface MetricCardProps {
  title: string;
  value: string | number;
  subtitle?: string;
  icon: LucideIcon;
  trend?: 'up' | 'down' | 'neutral';
  trendValue?: string;
  className?: string;
}

export default function MetricCard({
  title,
  value,
  subtitle,
  icon: Icon,
  trend,
  trendValue,
  className = '',
}: MetricCardProps) {
  const getTrendColor = () => {
    if (trend === 'up') return 'text-green-500';
    if (trend === 'down') return 'text-red-500';
    return 'text-gray-400';
  };

  return (
    <div className={`bg-[#0f1419] border border-gray-800 rounded-lg p-6 ${className}`}>
      <div className="flex items-start justify-between mb-4">
        <div className="p-2 bg-blue-600/10 rounded-lg">
          <Icon size={24} className="text-blue-500" />
        </div>
        {trend && trendValue && (
          <span className={`text-sm font-medium ${getTrendColor()}`}>
            {trend === 'up' ? '↑' : trend === 'down' ? '↓' : '→'} {trendValue}
          </span>
        )}
      </div>

      <div>
        <h3 className="text-gray-400 text-sm font-medium mb-2">{title}</h3>
        <p className="text-2xl font-bold text-white mb-1">{value}</p>
        {subtitle && <p className="text-sm text-gray-500">{subtitle}</p>}
      </div>
    </div>
  );
}
