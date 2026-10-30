import * as React from 'react';

export type CamNcLogoIconProps = React.ComponentProps<'svg'>;

export function CamNcLogoIcon({ className = 'size-8', ...props }: CamNcLogoIconProps) {
  return (
    <svg viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg" className={className} {...props}>
      <rect width="100" height="100" rx="22" fill="#1C1917" />
      <path
        d="M 18 30 V 18 H 30 M 82 30 V 18 H 70 M 18 70 V 82 H 30 M 82 70 V 82 H 70"
        stroke="#A8A29E"
        strokeWidth="5"
        strokeLinecap="round"
      />
      <circle cx="50" cy="50" r="26" stroke="#44403C" strokeWidth="2.5" strokeDasharray="3.5 3.5" />
      <path
        d="M 30 70 L 30 38 L 50 26 L 70 38 L 70 64 L 46 64 L 46 48"
        stroke="#D97706"
        strokeWidth="6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="46" cy="48" r="6" fill="#F59E0B" />
      <circle cx="46" cy="48" r="2.2" fill="#FEF3C7" />
    </svg>
  );
}

export function CamNcBrand({ className }: { className?: string }) {
  return (
    <div className={`flex items-center gap-2.5 ${className ?? ''}`}>
      <CamNcLogoIcon className="size-8 flex-shrink-0" />
      <div className="grid flex-1 text-left text-sm leading-tight">
        <span className="truncate font-semibold tracking-tight">
          Cam<span className="text-amber-500 font-bold">NC</span>
        </span>
        <span className="truncate text-xs text-muted-foreground">Toolpath Vision</span>
      </div>
    </div>
  );
}
