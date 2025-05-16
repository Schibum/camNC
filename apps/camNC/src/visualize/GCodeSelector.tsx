import React, { useState } from 'react';
import { sampleGcode, bookShelf } from '../test_data/gcode';

interface GCodeOption {
  name: string;
  gcode: string;
}

const gcodeOptions: GCodeOption[] = [
  { name: 'Sample GCode (Eichenbox)', gcode: sampleGcode },
  { name: 'Book Shelf', gcode: bookShelf },
];

interface GCodeSelectorProps {
  onChange?: (gcode: string) => void;
}

export const GCodeSelector: React.FC<GCodeSelectorProps> = ({ onChange }) => {
  const [selectedGCode, setSelectedGCode] = useState<GCodeOption>(gcodeOptions[1]);

  const handleGCodeChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const selected = gcodeOptions.find(option => option.name === e.target.value);
    if (selected) {
      setSelectedGCode(selected);
      if (onChange) {
        onChange(selected.gcode);
      }
    }
  };

  return (
    <>
      <div className="flex flex-col space-y-1  bg-gray-100 rounded-lg">
        <label htmlFor="gcode-select" className="text-sm font-medium">
          Select GCode:
        </label>
        <select
          id="gcode-select"
          className="p-1 rounded-md border border-gray-300"
          value={selectedGCode.name}
          onChange={handleGCodeChange}
        >
          {gcodeOptions.map(option => (
            <option key={option.name} value={option.name}>
              {option.name}
            </option>
          ))}
        </select>
      </div>
    </>
  );
};
