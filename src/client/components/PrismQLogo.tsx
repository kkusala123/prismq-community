import React from 'react';

interface PrismQLogoProps {
  className?: string;
}

export const PrismQLogo: React.FC<PrismQLogoProps> = ({ className = 'h-9 w-9' }) => (
  <svg
    viewBox="0 0 512 512"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    className={className}
    aria-hidden="true"
  >
    <defs>
      <linearGradient id="prismqLogoBg" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stopColor="#0F172A" />
        <stop offset="52%" stopColor="#1E3A8A" />
        <stop offset="100%" stopColor="#2554A8" />
      </linearGradient>
    </defs>
    <rect width="512" height="512" rx="116" fill="url(#prismqLogoBg)" />
    <line x1="274" y1="224" x2="408" y2="196" stroke="#38BDF8" strokeWidth="22" strokeLinecap="round" />
    <line x1="292" y1="260" x2="420" y2="260" stroke="#34D399" strokeWidth="22" strokeLinecap="round" />
    <line x1="308" y1="296" x2="408" y2="324" stroke="#FBBF24" strokeWidth="22" strokeLinecap="round" />
    <polygon points="240,124 124,368 228,286" fill="#FFFFFF" fillOpacity="0.97" />
    <polygon points="240,124 332,368 228,286" fill="#93C5FD" fillOpacity="0.92" />
    <polygon points="124,368 332,368 228,286" fill="#3B82F6" fillOpacity="0.96" />
  </svg>
);
