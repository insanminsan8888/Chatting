import React from 'react';

interface BrandLogoProps {
  className?: string;
  size?: 'sm' | 'md' | 'lg';
}

export const BrandLogo: React.FC<BrandLogoProps> = ({ className = '', size = 'md' }) => {
  const boxSize =
    size === 'sm' ? 'w-9 h-9' : size === 'lg' ? 'w-14 h-14' : 'w-10 h-10';
  const svgSize =
    size === 'sm' ? 'w-6 h-6' : size === 'lg' ? 'w-9 h-9' : 'w-6 h-6';

  return (
    <div
      className={`${boxSize} rounded-xl bg-gradient-to-br from-[#0B1120] via-[#0F172A] to-[#1A0D18] border border-blue-500/35 shadow-[0_0_20px_rgba(37,99,235,0.25)] flex items-center justify-center shrink-0 ${className}`}
      aria-hidden="true"
    >
      <svg
        viewBox="0 0 64 64"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        className={svgSize}
      >
        <defs>
          <linearGradient id="golgeShieldGrad" x1="10" y1="8" x2="54" y2="56" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stopColor="#3B82F6" />
            <stop offset="100%" stopColor="#F43F5E" />
          </linearGradient>
        </defs>
        <path
          d="M32 7L53 18.5V34C53 46.2 43.8 54.4 32 58C20.2 54.4 11 46.2 11 34V18.5L32 7Z"
          fill="#070A12"
          stroke="url(#golgeShieldGrad)"
          strokeWidth="3.2"
          strokeLinejoin="round"
        />
        <path
          d="M37 19.5C30.1 19.5 24.5 25.1 24.5 32C24.5 38.9 30.1 44.5 37 44.5C33.1 42.3 30.8 37.5 30.8 32C30.8 26.5 33.1 21.7 37 19.5Z"
          fill="#F43F5E"
        />
        <circle cx="39.5" cy="32" r="3.8" fill="#3B82F6" />
      </svg>
    </div>
  );
};
