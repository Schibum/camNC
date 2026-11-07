import '@/style.css';
import { TooltipProvider } from '@wbcnc/ui/components/tooltip';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { page } from '@vitest/browser/context';
import type { CSSProperties } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { kDefaultBit } from '../planSettings';
import { CuttingDataEditor } from './CuttingDataEditor';

const openTooltip = async () => {
  const field = screen.getByRole('textbox', { name: /Lead-out feed/ });
  act(() => field.focus());
  fireEvent.focus(field);
  await screen.findByRole('tooltip');
  // The role is on a hidden copy for screen readers; this is the bubble that shows.
  return document.querySelector<HTMLElement>('[data-slot="tooltip-content"]')!;
};

const renderEditor = (style: CSSProperties) =>
  render(
    <TooltipProvider>
      <div style={style}>
        <CuttingDataEditor bit={kDefaultBit} material="oak" />
      </div>
    </TooltipProvider>
  );

describe('cutting data tooltips', () => {
  beforeEach(() => page.viewport(1280, 800));
  afterEach(cleanup);

  it('stays on screen, above the field, with no room beside it', async () => {
    await page.viewport(390, 844);
    renderEditor({ padding: 8 });
    const tooltip = await openTooltip();
    expect(tooltip.dataset.side).toBe('top');
    // Placed a moment after it opens.
    await vi.waitFor(() => {
      const box = tooltip.getBoundingClientRect();
      expect(box.left).toBeGreaterThanOrEqual(0);
      expect(box.right).toBeLessThanOrEqual(document.documentElement.clientWidth);
    });
  });

  it('opens beside the field where there is room', async () => {
    renderEditor({ marginLeft: 600, width: 320 });
    expect((await openTooltip()).dataset.side).toBe('left');
  });
});
