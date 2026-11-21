import React, { useState } from 'react';

interface AvatarProps {
  src?: string;
  name: string;
  size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl';
  className?: string;
}

const SIZE_MAP = {
  xs: 'w-7 h-7 text-[11px]',
  sm: 'w-9 h-9 text-xs',
  md: 'w-11 h-11 text-sm',
  lg: 'w-14 h-14 text-base',
  xl: 'w-20 h-20 text-xl',
};

export const Avatar: React.FC<AvatarProps> = ({ src, name, size = 'md', className = '' }) => {
  const [failed, setFailed] = useState(false);
  const initials = (name || 'V')
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() || '')
    .join('') || 'V';

  if (src && !failed) {
    return (
      <img
        src={src}
        alt={name}
        referrerPolicy="no-referrer"
        onError={() => setFailed(true)}
        className={`${SIZE_MAP[size]} rounded-full object-cover shrink-0 bg-[#232631] border border-black/10 dark:border-white/10 ${className}`}
      />
    );
  }

  return (
    <div
      aria-label={name}
      className={`${SIZE_MAP[size]} rounded-full shrink-0 flex items-center justify-center font-display font-bold tracking-tight bg-gradient-to-br from-[#27272A] to-[#52525B] dark:from-[#272935] dark:to-[#6D28D9] text-white border border-black/10 dark:border-white/10 select-none ${className}`}
    >
      {initials}
    </div>
  );
};
