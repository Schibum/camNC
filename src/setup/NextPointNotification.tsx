import React from 'react';

interface NextPointNotificationProps {
  pointCount: number;
  style?: React.CSSProperties;
}

export const NextPointNotification: React.FC<NextPointNotificationProps> = ({
  pointCount,
  style
}) => {
  if (pointCount >= 4) {
    return null;
  }

  const getNextPointLabel = () => {
    const nextLabels = [
      '1: (xmin, ymin)',
      '2: (xmin, ymax)',
      '3: (xmax, ymin)',
      '4: (xmax, ymax)'
    ];
    return pointCount < 4 ? nextLabels[pointCount] : null;
  };

  return (
    <div style={{
      position: 'absolute',
      top: -25,
      left: 0,
      color: '#666',
      pointerEvents: 'none',
      zIndex: 1,
      backgroundColor: 'rgba(255, 255, 255, 0.8)',
      padding: '2px 6px',
      borderRadius: '4px',
      ...style
    }}>
      Next point to select: {getNextPointLabel()}
    </div>
  );
};