import React from 'react';

interface ActionButtonsProps {
  onReset: () => void;
  onSave?: () => void;
  canSave: boolean;
  saveDisabled?: boolean;
}

export const ActionButtons: React.FC<ActionButtonsProps> = ({
  onReset,
  onSave,
  canSave,
  saveDisabled = false,
}) => {
  return (
    <div style={{ marginTop: '15px', display: 'flex', gap: '10px' }}>
      <button
        onClick={onReset}
        style={{
          padding: '8px 16px',
          backgroundColor: '#f44336',
          color: 'white',
          border: 'none',
          borderRadius: '4px',
          cursor: 'pointer',
        }}
      >
        Reset
      </button>

      {canSave && (
        <button
          onClick={onSave}
          disabled={saveDisabled}
          style={{
            padding: '8px 16px',
            backgroundColor: saveDisabled ? '#cccccc' : '#4CAF50',
            color: 'white',
            border: 'none',
            borderRadius: '4px',
            cursor: saveDisabled ? 'not-allowed' : 'pointer',
          }}
        >
          Save Calibration
        </button>
      )}
    </div>
  );
};
