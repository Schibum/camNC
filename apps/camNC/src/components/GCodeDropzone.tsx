import React, { useCallback } from 'react';
import { useDropzone } from 'react-dropzone';

interface GCodeDropzoneProps {
  onFilesAccepted: (files: File) => void;
  className?: string;
}

/**
 * A component that provides drag & drop and click to upload functionality
 * for GCode files (.gcode, .nc)
 */
const GCodeDropzone: React.FC<GCodeDropzoneProps> = ({ onFilesAccepted, className = '' }) => {
  const onDrop = useCallback(
    (acceptedFiles: File[]) => {
      onFilesAccepted(acceptedFiles[0]);
    },
    [onFilesAccepted]
  );

  const { getRootProps, getInputProps, isDragActive, isDragReject } = useDropzone({
    multiple: false,
    onDrop,
    accept: {
      'text/plain': ['.gcode', '.nc'],
    },
  });

  return (
    <div
      {...getRootProps()}
      className={`flex flex-col items-center justify-center border-2 border-dashed rounded-lg p-6 transition-colors cursor-pointer
        ${isDragActive ? 'border-blue-500 bg-blue-50' : 'border-gray-300 hover:border-gray-400'}
        ${isDragReject ? 'border-red-500 bg-red-50' : ''}
        ${className}`}>
      <input {...getInputProps()} />
      <div className="flex flex-col items-center justify-center text-center">
        {isDragActive ? (
          <p className="text-blue-500 font-medium">Drop the files here...</p>
        ) : (
          <>
            <p className="text-gray-500">
              <span className="font-semibold">Click to upload</span> or drag and drop
            </p>
          </>
        )}
        {isDragReject && <p className="text-red-500 mt-2">Invalid file type. Only .gcode and .nc files are accepted.</p>}
      </div>
    </div>
  );
};

export default GCodeDropzone;
