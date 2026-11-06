import type { PlanResult } from '../camTypes';
import { DropdownMenuItem } from '@wbcnc/ui/components/dropdown-menu';
import { Download } from 'lucide-react';

export function ProgramDownloads({
  programs,
  disabled,
  onDownload,
}: {
  programs: PlanResult['programs'];
  disabled: boolean;
  onDownload: (program: PlanResult['programs'][number], kind: 'gcode' | 'setup') => void;
}) {
  const suffix = (program: PlanResult['programs'][number], index: number) => {
    const repeated = programs.filter(item => item.tool === program.tool).length > 1;
    return programs.length > 1 ? ` · ${repeated ? `P${index + 1} ` : ''}T${program.tool} ⌀${program.diameter}` : '';
  };
  return (
    <>
      {programs.map((program, index) => (
        <DropdownMenuItem key={`gcode-${index}`} disabled={disabled} onSelect={() => onDownload(program, 'gcode')}>
          <Download /> Download G-code{suffix(program, index)}
        </DropdownMenuItem>
      ))}
      {programs.map(
        (program, index) =>
          program.setupSheet && (
            <DropdownMenuItem key={`setup-${index}`} disabled={disabled} onSelect={() => onDownload(program, 'setup')}>
              <Download /> Download setup sheet{suffix(program, index)}
            </DropdownMenuItem>
          )
      )}
    </>
  );
}
