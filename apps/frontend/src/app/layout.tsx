import type { Metadata } from 'next';
import './globals.css';
import { Sidebar } from '@/components/Shell';

export const metadata: Metadata = {
  title: 'RiskOps — Рыночный риск портфеля',
  description: 'RiskOps MVP — управление рыночным риском портфеля',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ru">
      <body>
        <div className="app">
          <Sidebar />
          <div className="main">{children}</div>
        </div>
      </body>
    </html>
  );
}
