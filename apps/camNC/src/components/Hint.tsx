import React from 'react';

export function Hint({ title, children }: { title?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="border-l-2 pl-2 mb-4 space-y-1">
      <div className="text-sm">
        {title && <p className="mb-1 font-medium">{title}</p>}
        {children}
      </div>
    </div>
  );
}
