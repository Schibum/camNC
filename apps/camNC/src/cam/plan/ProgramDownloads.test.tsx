import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from '@wbcnc/ui/components/dropdown-menu';
import { ProgramDownloads } from './ProgramDownloads';

afterEach(cleanup);
const programs = [
  { tool: 1, diameter: 3.175, gcode: '(first)', timeMin: 1, setupSheet: '# First setup' },
  { tool: 1, diameter: 3.175, gcode: '(second speed)', timeMin: 2 },
];
const show = (disabled = false) => {
  const download = vi.fn();
  render(
    <DropdownMenu open>
      <DropdownMenuTrigger asChild>
        <button>Downloads</button>
      </DropdownMenuTrigger>
      <DropdownMenuContent>
        <ProgramDownloads programs={programs} disabled={disabled} onDownload={download} />
      </DropdownMenuContent>
    </DropdownMenu>
  );
  return download;
};

describe('program downloads', () => {
  it('keeps separate same-tool programs and downloads the matching setup', () => {
    const download = show();
    expect(screen.getAllByRole('menuitem', { name: /Download G-code/ })).toHaveLength(2);
    fireEvent.click(screen.getByRole('menuitem', { name: /Download G-code · P2 T1/ }));
    expect(download).toHaveBeenCalledWith(programs[1], 'gcode');
    fireEvent.click(screen.getByRole('menuitem', { name: /Download setup sheet/ }));
    expect(download).toHaveBeenCalledWith(programs[0], 'setup');
  });
  it('retains the program safety gate for all exports', () => {
    const download = show(true);
    for (const item of screen.getAllByRole('menuitem')) expect(item.getAttribute('aria-disabled')).toBe('true');
    fireEvent.click(screen.getByRole('menuitem', { name: /Download setup sheet/ }));
    expect(download).not.toHaveBeenCalled();
  });
});
