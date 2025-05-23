import GCodeDropzone from '@/components/GCodeDropzone';
import { useStore } from '@/store/store';

export function FileSelector() {
  const updateToolpath = useStore(s => s.updateToolpath);

  const handleFileUpload = (file: File) => {
    // Example: Read file contents
    const reader = new FileReader();
    reader.onload = e => {
      const contents = e.target?.result;
      // Process the GCode content
      updateToolpath(contents as string);
    };
    reader.readAsText(file, 'utf-8');
  };

  return <GCodeDropzone onFilesAccepted={handleFileUpload} />;
}
