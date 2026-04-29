'use client';

import React, { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { WaveBackground } from '@/components/WaveBackground';

/* ─── Feature card data ─────────────────────────────────────────────────── */
const FEATURES = [
  {
    icon: '📊',
    title: 'Мониторинг рисков в реальном времени',
    desc: 'Непрерывный расчёт VaR, CVaR и волатильности по всем позициям портфеля. Мгновенная реакция на изменения рыночной конъюнктуры.',
  },
  {
    icon: '🧠',
    title: 'ML-модели оценки риска',
    desc: 'GARCH-модели и метод Монте-Карло для прогнозирования хвостовых рисков. Автоматическое переобучение при обнаружении дрифта.',
  },
  {
    icon: '🔔',
    title: 'Система алертов',
    desc: 'Настраиваемые пороги по ключевым метрикам. Уведомления при превышении лимитов VaR, резких изменениях волатильности и аномалиях.',
  },
  {
    icon: '🧪',
    title: 'Стресс-тестирование',
    desc: 'Симуляция исторических кризисных сценариев: 2008, COVID-19, санкционные шоки. Оценка устойчивости портфеля к экстремальным событиям.',
  },
  {
    icon: '📈',
    title: 'Бэктестинг моделей',
    desc: 'Верификация точности риск-моделей по тестам Купика и Кристоффёрсена. Скользящее окно для оценки стабильности прогнозов во времени.',
  },
  {
    icon: '🗄️',
    title: 'Интеграция источников данных',
    desc: 'Подключение к MOEX, Yahoo Finance и FRED. Автоматический сбор котировок, макроэкономических индикаторов и синтетических инструментов.',
  },
  {
    icon: '🔍',
    title: 'Мониторинг дрифта моделей',
    desc: 'Отслеживание деградации качества ML-моделей в продакшне. Автоматический триггер переобучения при выходе метрик за допустимые границы.',
  },
  {
    icon: '⚙️',
    title: 'Оркестрация пайплайнов',
    desc: 'Apache Airflow управляет ежедневными пайплайнами сбора данных, обучения и инференса. Полная воспроизводимость через MLflow.',
  },
] as const;

/* ─── Intersection-observer hook ────────────────────────────────────────── */
function useVisible(threshold = 0.15) {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const obs = new IntersectionObserver(
      ([entry]) => { if (entry.isIntersecting) { setVisible(true); obs.disconnect(); } },
      { threshold },
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [threshold]);

  return { ref, visible };
}

/* ─── Animated section wrapper ──────────────────────────────────────────── */
function FadeIn({ children, delay = 0 }: { children: React.ReactNode; delay?: number }) {
  const { ref, visible } = useVisible();
  return (
    <div
      ref={ref}
      style={{
        opacity: visible ? 1 : 0,
        transform: visible ? 'translateY(0)' : 'translateY(32px)',
        transition: `opacity 0.7s ease ${delay}ms, transform 0.7s ease ${delay}ms`,
      }}
    >
      {children}
    </div>
  );
}

/* ─── Page ───────────────────────────────────────────────────────────────── */
export default function AboutPage() {
  /* Hero entrance animation */
  const [heroVisible, setHeroVisible] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setHeroVisible(true), 80);
    return () => clearTimeout(t);
  }, []);

  return (
    <div style={{ background: 'var(--bg)', minHeight: '100vh' }}>

      {/* ══════════════════════════════════════════════════════════════════
          HERO
      ══════════════════════════════════════════════════════════════════ */}
      <section
        style={{
          position: 'relative',
          height: '100vh',
          minHeight: 600,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          overflow: 'hidden',
          textAlign: 'center',
        }}
      >
        {/* Animated wave canvas */}
        <WaveBackground />

        {/* Overlay to soften canvas at edges */}
        <div
          style={{
            position: 'absolute',
            inset: 0,
            background:
              'linear-gradient(to bottom, rgba(26,16,16,0.15) 0%, transparent 30%, transparent 70%, rgba(26,16,16,0.6) 100%)',
            pointerEvents: 'none',
          }}
        />

        {/* Hero content */}
        <div style={{ position: 'relative', zIndex: 2, padding: '0 24px' }}>
          {/* Eyebrow */}
          <div
            style={{
              opacity: heroVisible ? 1 : 0,
              transform: heroVisible ? 'translateY(0)' : 'translateY(-16px)',
              transition: 'opacity 0.6s ease 0ms, transform 0.6s ease 0ms',
              fontFamily: 'var(--mono)',
              fontSize: 11,
              letterSpacing: '0.22em',
              textTransform: 'uppercase',
              color: 'rgba(232,211,212,0.70)',
              marginBottom: 20,
            }}
          >
            Система управления рыночным риском
          </div>

          {/* Main title */}
          <h1
            style={{
              opacity: heroVisible ? 1 : 0,
              transform: heroVisible ? 'translateY(0)' : 'translateY(24px)',
              transition: 'opacity 0.7s ease 120ms, transform 0.7s ease 120ms',
              margin: 0,
              fontSize: 'clamp(72px, 14vw, 160px)',
              fontWeight: 600,
              letterSpacing: '-0.04em',
              lineHeight: 0.92,
              background: 'linear-gradient(135deg, #FBF7EE 0%, #E8D3D4 40%, #C47080 70%, #8A2A36 100%)',
              WebkitBackgroundClip: 'text',
              WebkitTextFillColor: 'transparent',
              backgroundClip: 'text',
              fontFamily: 'var(--sans)',
            }}
          >
            RiskOps
          </h1>

          {/* Subtitle */}
          <p
            style={{
              opacity: heroVisible ? 1 : 0,
              transform: heroVisible ? 'translateY(0)' : 'translateY(20px)',
              transition: 'opacity 0.7s ease 260ms, transform 0.7s ease 260ms',
              margin: '24px auto 0',
              maxWidth: 520,
              fontSize: 17,
              lineHeight: 1.55,
              color: 'rgba(251,247,238,0.72)',
              fontWeight: 400,
            }}
          >
            Платформа для оценки, мониторинга и управления рыночными рисками
            инвестиционного портфеля на основе ML-моделей
          </p>

          {/* CTA button */}
          <div
            style={{
              opacity: heroVisible ? 1 : 0,
              transform: heroVisible ? 'translateY(0)' : 'translateY(16px)',
              transition: 'opacity 0.7s ease 400ms, transform 0.7s ease 400ms',
              marginTop: 40,
            }}
          >
            <Link
              href="/"
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 10,
                padding: '14px 28px',
                borderRadius: 8,
                background: 'var(--primary)',
                color: '#FBF7EE',
                fontWeight: 600,
                fontSize: 14,
                letterSpacing: '-0.01em',
                textDecoration: 'none',
                border: '1px solid rgba(138,42,54,0.6)',
                boxShadow: '0 0 32px rgba(107,31,42,0.45), 0 2px 8px rgba(0,0,0,0.4)',
                transition: 'background 150ms, box-shadow 150ms, transform 150ms',
              }}
              onMouseEnter={e => {
                (e.currentTarget as HTMLAnchorElement).style.background = 'var(--primary-2)';
                (e.currentTarget as HTMLAnchorElement).style.transform = 'translateY(-2px)';
                (e.currentTarget as HTMLAnchorElement).style.boxShadow = '0 0 48px rgba(107,31,42,0.6), 0 4px 16px rgba(0,0,0,0.5)';
              }}
              onMouseLeave={e => {
                (e.currentTarget as HTMLAnchorElement).style.background = 'var(--primary)';
                (e.currentTarget as HTMLAnchorElement).style.transform = 'translateY(0)';
                (e.currentTarget as HTMLAnchorElement).style.boxShadow = '0 0 32px rgba(107,31,42,0.45), 0 2px 8px rgba(0,0,0,0.4)';
              }}
            >
              Перейти к дашборду
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                <path d="M3 8h10M9 4l4 4-4 4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </Link>
          </div>
        </div>

        {/* Scroll hint */}
        <div
          style={{
            position: 'absolute',
            bottom: 32,
            left: '50%',
            transform: 'translateX(-50%)',
            opacity: heroVisible ? 0.45 : 0,
            transition: 'opacity 1s ease 800ms',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: 6,
            color: 'rgba(251,247,238,0.7)',
            fontFamily: 'var(--mono)',
            fontSize: 10,
            letterSpacing: '0.18em',
            textTransform: 'uppercase',
          }}
        >
          <span>Прокрутите вниз</span>
          <svg width="16" height="20" viewBox="0 0 16 20" fill="none" style={{ animation: 'bounceDown 1.8s ease-in-out infinite' }}>
            <path d="M8 2v12M3 10l5 6 5-6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </div>
      </section>

      {/* ══════════════════════════════════════════════════════════════════
          ABOUT SECTION
      ══════════════════════════════════════════════════════════════════ */}
      <section
        style={{
          padding: '100px 32px',
          maxWidth: 900,
          margin: '0 auto',
        }}
      >
        <FadeIn>
          <div
            style={{
              fontFamily: 'var(--mono)',
              fontSize: 11,
              letterSpacing: '0.2em',
              textTransform: 'uppercase',
              color: 'var(--primary)',
              marginBottom: 16,
            }}
          >
            О проекте
          </div>
          <h2
            style={{
              fontSize: 'clamp(32px, 5vw, 52px)',
              fontWeight: 500,
              letterSpacing: '-0.025em',
              lineHeight: 1.1,
              margin: '0 0 28px',
              color: 'var(--ink)',
            }}
          >
            Управление рисками нового поколения
          </h2>
          <p
            style={{
              fontSize: 16,
              lineHeight: 1.75,
              color: 'var(--ink-2)',
              maxWidth: 720,
              margin: '0 0 20px',
            }}
          >
            RiskOps — это комплексная платформа для количественной оценки и мониторинга
            рыночных рисков инвестиционного портфеля. Проект решает ключевую проблему
            современного риск-менеджмента: разрыв между сложными математическими моделями
            и их практическим применением в реальном времени.
          </p>
          <p
            style={{
              fontSize: 16,
              lineHeight: 1.75,
              color: 'var(--ink-2)',
              maxWidth: 720,
              margin: 0,
            }}
          >
            Платформа объединяет сбор рыночных данных из множества источников, обучение
            статистических и ML-моделей, автоматический инференс и визуализацию результатов
            в едином интерфейсе. Всё это работает в режиме реального времени с полной
            воспроизводимостью экспериментов через MLflow и оркестрацией через Apache Airflow.
          </p>
        </FadeIn>
      </section>

      {/* ══════════════════════════════════════════════════════════════════
          FEATURES GRID
      ══════════════════════════════════════════════════════════════════ */}
      <section
        style={{
          padding: '0 32px 100px',
          maxWidth: 1200,
          margin: '0 auto',
        }}
      >
        <FadeIn>
          <div
            style={{
              fontFamily: 'var(--mono)',
              fontSize: 11,
              letterSpacing: '0.2em',
              textTransform: 'uppercase',
              color: 'var(--primary)',
              marginBottom: 16,
              textAlign: 'center',
            }}
          >
            Возможности
          </div>
          <h2
            style={{
              fontSize: 'clamp(28px, 4vw, 44px)',
              fontWeight: 500,
              letterSpacing: '-0.022em',
              lineHeight: 1.1,
              margin: '0 0 56px',
              color: 'var(--ink)',
              textAlign: 'center',
            }}
          >
            Всё необходимое для риск-менеджмента
          </h2>
        </FadeIn>

        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
            gap: 20,
          }}
        >
          {FEATURES.map((f, i) => (
            <FadeIn key={f.title} delay={i * 60}>
              <div
                style={{
                  background: 'var(--surface)',
                  border: '1px solid var(--hair)',
                  borderRadius: 12,
                  padding: '24px 22px',
                  height: '100%',
                  transition: 'border-color 200ms, box-shadow 200ms, transform 200ms',
                  cursor: 'default',
                }}
                onMouseEnter={e => {
                  const el = e.currentTarget as HTMLDivElement;
                  el.style.borderColor = 'var(--primary-soft)';
                  el.style.boxShadow = '0 4px 24px rgba(107,31,42,0.10)';
                  el.style.transform = 'translateY(-3px)';
                }}
                onMouseLeave={e => {
                  const el = e.currentTarget as HTMLDivElement;
                  el.style.borderColor = 'var(--hair)';
                  el.style.boxShadow = 'none';
                  el.style.transform = 'translateY(0)';
                }}
              >
                <div style={{ fontSize: 28, marginBottom: 14, lineHeight: 1 }}>{f.icon}</div>
                <div
                  style={{
                    fontWeight: 600,
                    fontSize: 14,
                    letterSpacing: '-0.01em',
                    color: 'var(--ink)',
                    marginBottom: 10,
                    lineHeight: 1.3,
                  }}
                >
                  {f.title}
                </div>
                <div
                  style={{
                    fontSize: 13,
                    lineHeight: 1.6,
                    color: 'var(--ink-3)',
                  }}
                >
                  {f.desc}
                </div>
              </div>
            </FadeIn>
          ))}
        </div>
      </section>

      {/* ══════════════════════════════════════════════════════════════════
          TECH STACK STRIP
      ══════════════════════════════════════════════════════════════════ */}
      <section
        style={{
          borderTop: '1px solid var(--hair)',
          borderBottom: '1px solid var(--hair)',
          background: 'var(--surface)',
          padding: '40px 32px',
        }}
      >
        <FadeIn>
          <div
            style={{
              maxWidth: 1000,
              margin: '0 auto',
              display: 'flex',
              flexWrap: 'wrap',
              gap: 12,
              justifyContent: 'center',
              alignItems: 'center',
            }}
          >
            {[
              'Next.js', 'TypeScript', 'Go', 'Python', 'PostgreSQL',
              'Apache Kafka', 'Apache Airflow', 'MLflow', 'Docker',
              'Prometheus', 'Grafana', 'GARCH', 'Монте-Карло',
            ].map(tech => (
              <span
                key={tech}
                style={{
                  fontFamily: 'var(--mono)',
                  fontSize: 11,
                  letterSpacing: '0.06em',
                  textTransform: 'uppercase',
                  padding: '5px 12px',
                  borderRadius: 20,
                  background: 'var(--bg-2)',
                  border: '1px solid var(--hair)',
                  color: 'var(--ink-3)',
                }}
              >
                {tech}
              </span>
            ))}
          </div>
        </FadeIn>
      </section>

      {/* ══════════════════════════════════════════════════════════════════
          AUTHOR SECTION
      ══════════════════════════════════════════════════════════════════ */}
      <section
        style={{
          padding: '100px 32px 120px',
          maxWidth: 700,
          margin: '0 auto',
          textAlign: 'center',
        }}
      >
        <FadeIn>
          <div
            style={{
              fontFamily: 'var(--mono)',
              fontSize: 11,
              letterSpacing: '0.2em',
              textTransform: 'uppercase',
              color: 'var(--primary)',
              marginBottom: 48,
            }}
          >
            Автор
          </div>

          {/* Photo */}
          <div
            style={{
              width: 120,
              height: 120,
              borderRadius: '50%',
              overflow: 'hidden',
              margin: '0 auto 24px',
              border: '3px solid var(--primary-soft)',
              boxShadow: '0 0 0 1px var(--hair), 0 8px 32px rgba(107,31,42,0.18)',
              position: 'relative',
              background: 'var(--bg-2)',
            }}
          >
            <Image
              src="/nikolay.jpg"
              alt="Nikolay Khadzakos"
              fill
              style={{ objectFit: 'cover' }}
              sizes="120px"
            />
          </div>

          {/* Name */}
          <h3
            style={{
              fontSize: 28,
              fontWeight: 600,
              letterSpacing: '-0.02em',
              margin: '0 0 8px',
              color: 'var(--ink)',
            }}
          >
            Nikolay Khadzakos
          </h3>

          {/* Role */}
          <div
            style={{
              fontFamily: 'var(--mono)',
              fontSize: 12,
              letterSpacing: '0.12em',
              textTransform: 'uppercase',
              color: 'var(--ink-4)',
              marginBottom: 24,
            }}
          >
            Creator &amp; Developer
          </div>

          {/* Divider */}
          <div
            style={{
              width: 40,
              height: 2,
              background: 'var(--primary)',
              borderRadius: 2,
              margin: '0 auto 24px',
              opacity: 0.5,
            }}
          />

          {/* Bio */}
          <p
            style={{
              fontSize: 14,
              lineHeight: 1.7,
              color: 'var(--ink-3)',
              maxWidth: 480,
              margin: '0 auto 28px',
            }}
          >
            Разработчик и исследователь в области количественных финансов и машинного обучения.
            RiskOps создан как курсовой проект, объединяющий современные подходы к риск-менеджменту
            с production-ready инфраструктурой.
          </p>

          {/* Telegram link */}
          <a
            href="https://t.me/khadzakos"
            target="_blank"
            rel="noopener noreferrer"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 8,
              padding: '10px 20px',
              borderRadius: 8,
              border: '1px solid var(--hair-strong)',
              background: 'var(--surface)',
              color: 'var(--ink-2)',
              fontSize: 13,
              fontWeight: 500,
              textDecoration: 'none',
              transition: 'border-color 150ms, background 150ms',
            }}
            onMouseEnter={e => {
              const el = e.currentTarget as HTMLAnchorElement;
              el.style.borderColor = 'var(--primary)';
              el.style.background = 'var(--primary-tint)';
            }}
            onMouseLeave={e => {
              const el = e.currentTarget as HTMLAnchorElement;
              el.style.borderColor = 'var(--hair-strong)';
              el.style.background = 'var(--surface)';
            }}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
              <path d="M21.8 2.6L1.4 10.3c-1.3.5-1.3 1.3-.2 1.6l5.1 1.6 11.8-7.4c.6-.3 1.1-.1.7.3L8.5 16.1l-.4 5.2c.6 0 .9-.3 1.2-.6l2.9-2.8 5.1 3.7c.9.5 1.6.3 1.8-.9l3.3-15.6c.3-1.4-.5-2-1.6-1.5z" fill="currentColor"/>
            </svg>
            @khadzakos
          </a>
        </FadeIn>
      </section>

      {/* Bounce animation keyframes */}
      <style>{`
        @keyframes bounceDown {
          0%, 100% { transform: translateY(0); }
          50%       { transform: translateY(6px); }
        }
      `}</style>
    </div>
  );
}
