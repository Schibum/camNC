import { TooltipProvider } from '@wbcnc/ui/components/tooltip';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { useState } from 'react';
// Tailwind: the wrapping test measures real boxes.
import '@/style.css';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { kDefaultPlan, type PlanSettingsV1 } from '../planSettings';
import { useToolLibrary } from '../toolLibrary';
import { PlanSettingsPanel } from './PlanSettingsPanel';

vi.mock('@tanstack/react-router', () => ({ Link: ({ children }: { children: React.ReactNode }) => <a>{children}</a> }));

afterEach(() => {
  cleanup();
  useToolLibrary.setState({ bits: [], imports: [] });
});

const description = (el: Element) =>
  (el.getAttribute('aria-describedby') ?? '')
    .split(/\s+/)
    .filter(Boolean)
    .map(id => document.getElementById(id)?.textContent ?? '')
    .join(' ')
    .trim();

function Panel({ onChange }: { onChange: (v: PlanSettingsV1) => void }) {
  const [value, setValue] = useState(kDefaultPlan);
  return (
    <TooltipProvider>
      <PlanSettingsPanel
        value={value}
        material="oak"
        onChange={v => {
          setValue(v);
          onChange(v);
        }}
      />
    </TooltipProvider>
  );
}

describe('Plan settings', () => {
  it('cut-through depth: dot decimals in any locale, a comma typed is fine, out of range says so', () => {
    const onChange = vi.fn();
    render(<Panel onChange={onChange} />);
    const cut = screen.getByRole('textbox', { name: 'Cut through to (mm below the board)' }) as HTMLInputElement;
    expect(cut.value).toBe('0.3');
    expect(description(cut)).toMatch(/^0–2 mm\./);

    fireEvent.change(cut, { target: { value: '0,5' } });
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ cutBelow: 0.5 }));
    fireEvent.blur(cut);
    expect(cut.value).toBe('0.5');

    onChange.mockClear();
    fireEvent.change(cut, { target: { value: '5' } });
    fireEvent.blur(cut);
    // It stays as typed, with the error, and the plan keeps 0.5.
    expect(cut.value).toBe('5');
    expect(cut.getAttribute('aria-invalid')).toBe('true');
    expect(description(cut)).toMatch(/^5 is out of range: 0–2 mm\./);
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.keyDown(cut, { key: 'Escape' });
    expect(cut.value).toBe('0.5');
    expect(cut.hasAttribute('aria-invalid')).toBe(false);
  });

  it('cutting data fields show dots and flag a value that is no number', () => {
    render(<Panel onChange={() => {}} />);
    const panel = within(screen.getByRole('region', { name: 'Cutting data' }));
    const stepdown = panel.getByRole('textbox', { name: /^Stepdown/ }) as HTMLInputElement;
    expect(stepdown.value).not.toContain(',');
    fireEvent.change(stepdown, { target: { value: '0' } });
    expect(description(stepdown)).toMatch(/^0 is out of range: more than 0 mm\./);
    expect(panel.queryByRole('button', { name: /^Save for/ })).toBeNull();
    fireEvent.change(stepdown, { target: { value: '1,2' } });
    expect(stepdown.hasAttribute('aria-invalid')).toBe(false);
    expect(panel.getByRole('button', { name: /^Save for/ })).toBeTruthy();
  });

  it('long bit names wrap in the bit list, with flutes and flute length on a second line', async () => {
    useToolLibrary
      .getState()
      .importLibrary(
        [{ number: 5, diameter: 6, name: 'VHM-Schaftfräser Z2 Ø 6 mm HB-Schaft lange Ausführung', flutes: 2, fluteLength: 22 }],
        'Library.json'
      );
    render(<Panel onChange={() => {}} />);
    fireEvent.pointerDown(screen.getByRole('combobox', { name: 'Bit' }), { button: 0, ctrlKey: false, pointerType: 'mouse' });
    const option = await screen.findByRole('option', { name: /VHM-Schaftfräser/ });
    expect(option.textContent).toContain('2 flutes · 22 mm flute length');
    const name = within(option).getByText(/^⌀ 6 · VHM/);
    // On as many lines as it takes, not cut off.
    expect(getComputedStyle(name).whiteSpace).toBe('normal');
    expect(name.scrollWidth).toBeLessThanOrEqual(name.clientWidth + 1);
  });
});
