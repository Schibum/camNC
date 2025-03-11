import React, { useState } from 'react';

interface UrlEntryStepProps {
  initialUrl: string;
  onConfirm: (url: string) => void;
}

export const UrlEntryStep: React.FC<UrlEntryStepProps> = ({ initialUrl = '', onConfirm }) => {
  const [url, setUrl] = useState(initialUrl);
  const [error, setError] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    // Simple validation - URL must not be empty
    if (!url.trim()) {
      setError('Please enter a valid video stream URL');
      return;
    }

    // Clear any previous errors
    setError('');

    // Confirm and move to next step
    onConfirm(url);
  };

  return (
    <div className="url-entry-step">
      <h2>Step 1: Enter Video Stream URL</h2>
      <p>Enter the URL of the video stream you want to use for camera calibration.</p>

      <form onSubmit={handleSubmit}>
        <div style={{ marginBottom: '10px' }}>
          <input
            type="text"
            placeholder="Enter video stream URL"
            value={url}
            onChange={e => setUrl(e.target.value)}
            style={{
              width: '400px',
              padding: '8px',
              fontSize: '16px',
              borderRadius: '4px',
              border: error ? '1px solid red' : '1px solid #ccc',
            }}
          />
          {error && <div style={{ color: 'red', marginTop: '5px', fontSize: '14px' }}>{error}</div>}
        </div>

        <button
          type="submit"
          style={{
            padding: '8px 16px',
            backgroundColor: '#4CAF50',
            color: 'white',
            border: 'none',
            borderRadius: '4px',
            cursor: 'pointer',
            fontSize: '16px',
          }}
        >
          Continue to Point Selection
        </button>
      </form>
    </div>
  );
};
