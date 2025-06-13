import { Button } from '@wbcnc/ui/components/button';
import * as zip from '@zip.js/zip.js';
import { Save } from 'lucide-react';
import { useState } from 'react';
import { useCalibrationStore } from '../store/calibrationStore';

// Helper function to convert a Blob to a JPEG Blob via Canvas
// Remove the convertToJpegBlob function as it's no longer needed
/*
async function convertToJpegBlob(imageBlob: Blob): Promise<Blob> {
    // ... implementation ...
}
*/

export const SaveFramesButton = () => {
  const { capturedFrames } = useCalibrationStore();
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSaveFrames = async () => {
    if (capturedFrames.length === 0) {
      setError('No frames to save.');
      return;
    }

    setIsSaving(true);
    setError(null);
    let zipFileWriter: zip.BlobWriter | null = null;
    let zipWriter: zip.ZipWriter<Blob> | null = null;
    let objectUrl: string | null = null;

    try {
      // 1. Create Zip writer
      zipFileWriter = new zip.BlobWriter('application/zip');
      zipWriter = new zip.ZipWriter(zipFileWriter);

      // 2. Iterate and add each frame to the zip
      for (let i = 0; i < capturedFrames.length; i++) {
        const frame = capturedFrames[i]!;
        const fileName = `frame_${String(i).padStart(2, '0')}.jpg`;

        try {
          // Use the blob directly as it is already JPEG
          const imageBlob = frame.imageBlob;
          if (!imageBlob) continue;
          // Ensure blob exists before adding
          await zipWriter.add(fileName, new zip.BlobReader(imageBlob));
        } catch (writeError: any) {
          console.error(`Error adding frame ${i} (${fileName}) to zip:`, writeError);
          setError(`Error adding ${fileName} to zip: ${writeError.message}`);
          // Close zip writer if error occurs during add
          if (zipWriter) {
            await zipWriter.close(); // Discard zip
            zipWriter = null; // Prevent further operations
          }
          break; // Stop saving process if one file fails
        }
      }

      // 3. Finalize the zip file and initiate download if no errors occurred
      if (zipWriter) {
        const zipBlob = await zipWriter.close();

        // Create a download link
        const link = document.createElement('a');
        objectUrl = URL.createObjectURL(zipBlob);
        link.href = objectUrl;
        link.download = 'calibration_frames.zip';
        document.body.appendChild(link); // Required for Firefox
        link.click();
        document.body.removeChild(link);

        console.log('Frames zip file prepared for download.');
      }
    } catch (err: any) {
      console.error('Error creating zip file or initiating download:', err);
      setError(`Failed to create zip file: ${err.message}`);
      // Ensure zip writer is closed even if initialization failed somehow
      if (zipWriter) {
        try {
          await zipWriter.close();
        } catch {
          /* Ignore */
        }
      }
    } finally {
      setIsSaving(false);
      // Revoke the object URL to free up memory
      if (objectUrl) {
        URL.revokeObjectURL(objectUrl);
      }
    }
  };

  return (
    <div className="flex flex-col items-end">
      <Button onClick={handleSaveFrames} disabled={isSaving || capturedFrames.length === 0} variant="secondary">
        <Save />
        {isSaving ? 'Saving...' : 'Export'}
      </Button>
      {error && <p className="text-red-500 text-xs mt-1">{error}</p>}
    </div>
  );
};
