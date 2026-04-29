'use client';

import React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Icons } from './Icons';

const NAV = [
  { section: 'Обзор' },
  { id: 'dashboard',  href: '/',           label: 'Дашборд',           icon: 'dashboard'  as const },
  { id: 'portfolio',  href: '/portfolio',  label: 'Портфель',          icon: 'portfolio'  as const },
  { id: 'alerts',     href: '/alerts',     label: 'Алерты',            icon: 'alerts'     as const, badge: '!', badgeCrit: true },
  { section: 'Риск-модели' },
  { id: 'stress',     href: '/stress',     label: 'Стресс-тесты',      icon: 'stress'     as const },
  { id: 'backtest',   href: '/backtest',   label: 'Бэктестинг',        icon: 'backtest'   as const },
  { id: 'models',     href: '/models',     label: 'Реестр моделей',    icon: 'models'     as const },
  { id: 'drift',      href: '/drift',      label: 'Мониторинг дрифта', icon: 'drift'      as const },
  { section: 'Данные' },
  { id: 'data',       href: '/data',       label: 'Источники данных',  icon: 'data'       as const },
] as const;

export function Sidebar() {
  const pathname = usePathname();

  const isAbout = pathname === '/about';

  return (
    <aside className="sidebar">
      <div className="brand">
        <div style={{ width: '100%' }}>
          <Link href="/" style={{ textDecoration: 'none', color: 'inherit' }}>
            <div className="brand-name">RiskOps</div>
          </Link>
          <div className="brand-sub">Core MVP · v1.0</div>
          <div style={{ marginTop: 4, fontSize: 10, color: 'var(--ink-4)', lineHeight: 1.4 }}>
            Created by{' '}
            <a
              href="https://t.me/khadzakos"
              target="_blank"
              rel="noopener noreferrer"
              style={{ color: 'var(--primary)', textDecoration: 'none', fontWeight: 500 }}
            >
              Nikolay Khadzakos
            </a>
          </div>
          <Link
            href="/about"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 5,
              marginTop: 10,
              fontSize: 11,
              fontFamily: 'var(--mono)',
              letterSpacing: '0.06em',
              textTransform: 'uppercase' as const,
              textDecoration: 'none',
              color: isAbout ? 'var(--primary)' : 'var(--ink-4)',
              fontWeight: isAbout ? 600 : 400,
              transition: 'color 120ms',
            }}
          >
            <svg width="11" height="11" viewBox="0 0 16 16" fill="none" style={{ flexShrink: 0 }}>
              <circle cx="8" cy="8" r="6.5" stroke="currentColor" strokeWidth="1.5"/>
              <path d="M8 7v5M8 5.5v.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
            </svg>
            О проекте
          </Link>
        </div>
      </div>

      {NAV.map((item, i) => {
        if ('section' in item) {
          return <div className="nav-section" key={'s' + i}>{item.section}</div>;
        }
        const Ic = Icons[item.icon];
        const active = item.href === '/'
          ? pathname === '/'
          : pathname.startsWith(item.href);
        return (
          <Link
            key={item.id}
            href={item.href}
            className={`nav-item ${active ? 'active' : ''}`}
            style={{ textDecoration: 'none' }}
          >
            <Ic size={15} />
            <span>{item.label}</span>
            {'badge' in item && item.badge && (
              <span className={`nav-badge ${'badgeCrit' in item && item.badgeCrit ? 'crit' : ''}`}>
                {item.badge}
              </span>
            )}
          </Link>
        );
      })}
    </aside>
  );
}

export function Topbar({ crumbs }: { crumbs: string[] }) {
  const now = new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
  return (
    <div className="topbar">
      <div className="crumbs">
        {crumbs.map((c, i) => (
          <React.Fragment key={i}>
            {i > 0 && <span className="sep">/</span>}
            <span className={i === crumbs.length - 1 ? 'cur' : ''}>{c}</span>
          </React.Fragment>
        ))}
      </div>
      <button
        className="topbar-btn"
        style={{
          background: 'var(--primary)',
          color: '#FBF7EE',
          borderRadius: 6,
          padding: '4px 10px',
          border: 'none',
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          cursor: 'pointer',
        }}
      >
        <Icons.refresh size={14} />
        <span className="mono" style={{ fontSize: 11, color: 'rgba(251,247,238,0.8)' }}>{now}</span>
      </button>
    </div>
  );
}

export function PageHead({
  eyebrow,
  title,
  sub,
  children,
}: {
  eyebrow?: string;
  title: string;
  sub?: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="page-head">
      <div>
        {eyebrow && <div className="page-eyebrow">{eyebrow}</div>}
        <h1 className="page-title">{title}</h1>
        {sub && <div className="page-sub">{sub}</div>}
      </div>
      {children && <div className="page-actions">{children}</div>}
    </div>
  );
}

export function Pill({
  variant = '',
  children,
}: {
  variant?: 'good' | 'warn' | 'crit' | 'primary' | '';
  children: React.ReactNode;
}) {
  return (
    <span className={`pill ${variant}`}>
      <span className="dot" />
      {children}
    </span>
  );
}

export function ErrorBanner({ message }: { message: string }) {
  return <div className="error-banner">⚠ {message}</div>;
}

export function Skeleton({ height = 24, width = '100%' }: { height?: number; width?: string | number }) {
  return <div className="skeleton" style={{ height, width }} />;
}
