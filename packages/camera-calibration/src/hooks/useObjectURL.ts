import { useState, useEffect } from "react";

/**
 * Custom hook to create and revoke an Object URL for a Blob.
 * Returns the Object URL string, or null if the blob is null.
 */
export function useObjectURL(blob: Blob | null): string | null {
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!blob) {
      setUrl(null);
      return;
    }

    const objectUrl = URL.createObjectURL(blob);
    setUrl(objectUrl);

    // Cleanup function to revoke the Object URL
    return () => {
      URL.revokeObjectURL(objectUrl);
      setUrl(null);
    };
  }, [blob]); // Re-run only when the blob instance changes

  return url;
}
