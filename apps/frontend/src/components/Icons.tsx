'use client';

import React from 'react';

interface IconProps {
  size?: number;
  className?: string;
}

const Icon: React.FC<{
  size?: number;
  fill?: string;
  stroke?: string;
  sw?: number;
  children: React.ReactNode;
}> = ({ size = 16, fill = 'none', stroke = 'currentColor', sw = 1.5, children }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill={fill}
    stroke={stroke}
    strokeWidth={sw}
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    {children}
  </svg>
);

export const Icons = {
  dashboard: ({ size = 16 }: IconProps) => (
    <Icon size={size}>
      <rect x="3" y="3" width="7" height="9" />
      <rect x="14" y="3" width="7" height="5" />
      <rect x="14" y="12" width="7" height="9" />
      <rect x="3" y="16" width="7" height="5" />
    </Icon>
  ),
  portfolio: ({ size = 16 }: IconProps) => (
    <Icon size={size}>
      <path d="M3 7h18M3 12h18M3 17h18" />
      <circle cx="7" cy="7" r="1.2" fill="currentColor" stroke="none" />
      <circle cx="12" cy="12" r="1.2" fill="currentColor" stroke="none" />
      <circle cx="17" cy="17" r="1.2" fill="currentColor" stroke="none" />
    </Icon>
  ),
  stress: ({ size = 16 }: IconProps) => (
    <Icon size={size}>
      <path d="M3 18L8 10L12 14L16 6L21 12" />
      <path d="M3 21h18" strokeDasharray="2 2" />
    </Icon>
  ),
  backtest: ({ size = 16 }: IconProps) => (
    <Icon size={size}>
      <path d="M3 3v18h18" />
      <path d="M7 15l3-4 3 2 5-7" />
      <circle cx="7" cy="15" r="1.5" fill="currentColor" stroke="none" />
      <circle cx="10" cy="11" r="1.5" fill="currentColor" stroke="none" />
      <circle cx="13" cy="13" r="1.5" fill="currentColor" stroke="none" />
      <circle cx="18" cy="6" r="1.5" fill="currentColor" stroke="none" />
    </Icon>
  ),
  models: ({ size = 16 }: IconProps) => (
    <Icon size={size}>
      <circle cx="12" cy="6" r="2.5" />
      <circle cx="6" cy="18" r="2.5" />
      <circle cx="18" cy="18" r="2.5" />
      <path d="M12 8.5v2M10 16l-2-6M14 16l2-6" />
    </Icon>
  ),
  data: ({ size = 16 }: IconProps) => (
    <Icon size={size}>
      <ellipse cx="12" cy="5" rx="8" ry="2.5" />
      <path d="M4 5v6c0 1.4 3.6 2.5 8 2.5s8-1.1 8-2.5V5" />
      <path d="M4 11v6c0 1.4 3.6 2.5 8 2.5s8-1.1 8-2.5v-6" />
    </Icon>
  ),
  alerts: ({ size = 16 }: IconProps) => (
    <Icon size={size}>
      <path d="M12 3a6 6 0 0 0-6 6v4l-2 3h16l-2-3V9a6 6 0 0 0-6-6z" />
      <path d="M10 19a2 2 0 0 0 4 0" />
    </Icon>
  ),
  drift: ({ size = 16 }: IconProps) => (
    <Icon size={size}>
      <path d="M3 12c3 0 3-6 6-6s3 12 6 12 3-6 6-6" />
    </Icon>
  ),
  settings: ({ size = 16 }: IconProps) => (
    <Icon size={size}>
      <circle cx="12" cy="12" r="2.5" />
      <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 0 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 0 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 0 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 0 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" />
    </Icon>
  ),
  search: ({ size = 16 }: IconProps) => (
    <Icon size={size}>
      <circle cx="11" cy="11" r="7" />
      <path d="m21 21-4.3-4.3" />
    </Icon>
  ),
  download: ({ size = 16 }: IconProps) => (
    <Icon size={size}>
      <path d="M12 3v12m0 0l-4-4m4 4l4-4M5 21h14" />
    </Icon>
  ),
  plus: ({ size = 16 }: IconProps) => (
    <Icon size={size}>
      <path d="M12 5v14M5 12h14" />
    </Icon>
  ),
  bell: ({ size = 16 }: IconProps) => (
    <Icon size={size}>
      <path d="M12 3a6 6 0 0 0-6 6v4l-2 3h16l-2-3V9a6 6 0 0 0-6-6z" />
    </Icon>
  ),
  chevron: ({ size = 16 }: IconProps) => (
    <Icon size={size}>
      <path d="m9 6 6 6-6 6" />
    </Icon>
  ),
  chevronDown: ({ size = 16 }: IconProps) => (
    <Icon size={size}>
      <path d="m6 9 6 6 6-6" />
    </Icon>
  ),
  play: ({ size = 16 }: IconProps) => (
    <Icon size={size} fill="currentColor" stroke="none">
      <path d="M6 4l14 8-14 8V4z" />
    </Icon>
  ),
  refresh: ({ size = 16 }: IconProps) => (
    <Icon size={size}>
      <path d="M3 12a9 9 0 0 1 15-6.7L21 8M21 3v5h-5M21 12a9 9 0 0 1-15 6.7L3 16M3 21v-5h5" />
    </Icon>
  ),
  filter: ({ size = 16 }: IconProps) => (
    <Icon size={size}>
      <path d="M3 5h18M6 12h12M10 19h4" />
    </Icon>
  ),
  external: ({ size = 16 }: IconProps) => (
    <Icon size={size}>
      <path d="M14 3h7v7M21 3l-9 9M10 5H5a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-5" />
    </Icon>
  ),
  check: ({ size = 16 }: IconProps) => (
    <Icon size={size}>
      <path d="M4 12l5 5L20 6" />
    </Icon>
  ),
  ingest: ({ size = 16 }: IconProps) => (
    <Icon size={size}>
      <path d="M12 3v12m0 0l-4-4m4 4l4-4M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" />
    </Icon>
  ),
};

export const BrandLogo: React.FC = () => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M4 18L9 10L13 14L20 5" />
    <circle cx="9" cy="10" r="1.5" fill="currentColor" stroke="none" />
    <circle cx="13" cy="14" r="1.5" fill="currentColor" stroke="none" />
  </svg>
);
