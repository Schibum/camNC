import { useEffect } from 'react';
import { CapturedFrame } from '../lib/calibrationTypes';
import { ImageWithCornersOverlay } from './ImageWithCornersOverlay';

interface FrameDetailViewProps {
  frame: CapturedFrame;
  onClose: () => void;
  onNavigate: (direction: 'next' | 'prev') => void;
  onDelete: (frameId: string) => void;
}

export const FrameDetailView: React.FC<FrameDetailViewProps> = ({ frame, onClose, onNavigate, onDelete }) => {
  // Add keyboard navigation effect
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'ArrowRight' || event.key === ' ') {
        event.preventDefault();
        onNavigate('next');
      } else if (event.key === 'ArrowLeft') {
        event.preventDefault();
        onNavigate('prev');
      } else if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [onNavigate, onClose]);

  const handleDelete = () => {
    onDelete(frame.id);
    onClose();
  };

  if (!frame) {
    return <div>Frame not found</div>;
  }

  return (
    <div className="absolute inset-0 bg-black/95 z-20 overflow-y-auto text-white p-5">
      <div className="flex justify-between items-center mb-5">
        <h3 className="text-xl font-semibold">Frame Details</h3>
        <div className="flex items-center gap-4">
          <button
            className="bg-red-600 text-white px-3 py-1 rounded hover:bg-red-700 transition-colors text-sm"
            onClick={handleDelete}
            title="Delete Frame"
          >
            Delete
          </button>
          <button
            className="bg-transparent text-white text-2xl cursor-pointer hover:text-gray-300 transition-colors"
            onClick={onClose}
            title="Close Detail View"
          >
            ×
          </button>
        </div>
      </div>
      <div className="flex flex-col gap-4">
        <ImageWithCornersOverlay
          imageBlob={frame.imageBlob}
          corners={frame.corners}
          className="w-full h-auto max-h-[70vh] object-contain"
        />
        <div className="bg-white/10 p-4 rounded-lg space-y-2">
          <div>Captured at: {new Date(frame.timestamp).toLocaleString()}</div>
          <div>Corner points: {frame.corners.length}</div>
        </div>
      </div>
    </div>
  );
};