import { TooltipProvider } from '@wbcnc/ui/components/tooltip';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { useState } from 'react';
// Tailwind: the wrapping test measures real boxes.
import '@/style.css';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { kDefaultPlan, type PlanSettingsV1 } from '../planSettings';
import { useToolLibrary } from '../toolLibrary';
import { PlanSettingsPanel } from './PlanSettingsPanel';
import { selectToolPreset, type LibraryTool } from '@wbcnc/cam/tools';
import { cuttingKey, legacyCuttingKey, useCuttingData } from '../cuttingData';

vi.mock('@tanstack/react-router', () => ({ Link: ({ children }: { children: React.ReactNode }) => <a>{children}</a> }));

afterEach(() => {
  cleanup();
  useToolLibrary.setState({ bits: [], imports: [] });
  useCuttingData.setState({ saved: {} });
});

const description = (el: Element) =>
  (el.getAttribute('aria-describedby') ?? '')
    .split(/\s+/)
    .filter(Boolean)
    .map(id => document.getElementById(id)?.textContent ?? '')
    .join(' ')
    .trim();

function Panel({ onChange, initial = kDefaultPlan }: { onChange: (v: PlanSettingsV1) => void; initial?: PlanSettingsV1 }) {
  const [value, setValue] = useState(initial);
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

  it('selects cutting data in the job snapshot, clears missing preset values and keeps explicit overrides', () => {
    const tool: LibraryTool = {
      number: 1,
      diameter: 3.175,
      name: 'flat',
      guid: 'cutter',
      stickout: 23,
      presets: [
        { id: 'rough', name: 'Roughing', feed: 1800, rampFeed: 350, leadOutFeed: 700, useStepdown: false, useStepover: false },
        { id: 'finish', name: 'Finishing', feed: 1200, useStepdown: false, useStepover: false },
      ],
    };
    const bit = selectToolPreset(tool, 'rough');
    useToolLibrary.setState({ bits: [{ ...bit, id: 'stored', source: 'library' }], imports: [] });
    const onChange = vi.fn();
    render(<Panel initial={{ ...kDefaultPlan, bit, cutting: { feed: 2200 } }} onChange={onChange} />);
    const select = screen.getByRole('combobox', { name: 'Cutting preset' }) as HTMLSelectElement;
    expect(select.value).toBe('rough');
    expect(description(select)).toContain('Saved and job overrides still apply');
    fireEvent.change(select, { target: { value: 'finish' } });
    const changed = onChange.mock.lastCall![0] as PlanSettingsV1;
    expect(changed.bit).toMatchObject({ presetId: 'finish', presetName: 'Finishing', guid: 'cutter', stickout: 23, feed: 1200 });
    expect(changed.bit.rampFeed).toBeUndefined();
    expect(changed.bit.leadOutFeed).toBeUndefined();
    expect(changed.cutting).toEqual({ feed: 2200 });
    expect((screen.getByRole('textbox', { name: /^Ramp feed/ }) as HTMLInputElement).value).toBe('480');
    expect((screen.getByRole('textbox', { name: /^Lead-out feed/ }) as HTMLInputElement).value).toBe('2200');
    expect(useToolLibrary.getState().bits[0].presetId).toBe('rough');
  });

  it('resets a legacy saved feed once instead of restoring it from the shared fallback', () => {
    const bit = { ...kDefaultPlan.bit, guid: 'physical' };
    const legacy = legacyCuttingKey(bit, 'oak');
    useCuttingData.setState({ saved: { [legacy]: { rampFeed: 390 } } });
    render(<Panel initial={{ ...kDefaultPlan, bit }} onChange={() => {}} />);
    const ramp = screen.getByRole('textbox', { name: /^Ramp feed/ }) as HTMLInputElement;
    expect(ramp.value).toBe('390');
    fireEvent.click(screen.getByRole('button', { name: 'Ramp feed: back to the library or default value' }));
    expect(ramp.value).toBe('480');
    expect(useCuttingData.getState().saved[cuttingKey(bit, 'oak')]).toEqual({});
    expect(useCuttingData.getState().saved[legacy]).toEqual({ rampFeed: 390 });
  });
});
