import { createCadDocument, createCadPart } from '@wbcnc/cad';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { userEvent } from '@vitest/browser/context';
import { afterEach, expect, it } from 'vitest';
import { CadEditor } from './CadEditor';
import { endCadSession } from './session';

const sessions: string[] = [];
afterEach(() => {
  cleanup();
  sessions.splice(0).forEach(endCadSession);
});
async function setup() {
  const source = createCadDocument();
  source.parts.push(createCadPart());
  sessions.push(source.id);
  render(
    <div style={{ height: 700 }}>
      <CadEditor document={source} onDraftChange={() => {}} onFinish={() => {}} onCancel={() => {}} />
    </div>
  );
  await waitFor(
    () => {
      expect(screen.queryByText(/^Checking sketch/)).toBeNull();
      expect(document.querySelector('.cad-editor')!.getAttribute('aria-busy')).toBe('false');
    },
    { timeout: 20_000 }
  );
}

it('routes a real tool shortcut after the user toggles Show constraints', async () => {
  await setup();
  const checkbox = screen.getByRole('checkbox', { name: 'Show constraints' });
  await userEvent.click(checkbox);
  expect(checkbox).not.toBeChecked();
  expect(document.activeElement).toBe(checkbox);
  await userEvent.keyboard('l');
  expect(screen.getByRole('button', { name: 'Line (L)' })).toHaveAttribute('aria-pressed', 'true');
});

it('keeps native Space toggling and focus on the checkbox before a drawing command', async () => {
  await setup();
  const checkbox = screen.getByRole('checkbox', { name: 'Show constraints' });
  await userEvent.click(checkbox);
  expect(checkbox).not.toBeChecked();
  await userEvent.keyboard(' ');
  expect(checkbox).toBeChecked();
  expect(document.activeElement).toBe(checkbox);
  expect(screen.getByRole('button', { name: 'Select (Esc)' })).toHaveAttribute('aria-pressed', 'true');
});

it.each(['Part name', 'Thickness'])('keeps drawing letters inside the focused %s input', async name => {
  await setup();
  const input = screen.getByRole('textbox', { name });
  await userEvent.clear(input);
  await userEvent.keyboard('lrcgq');
  expect(input).toHaveValue('lrcgq');
  expect(document.activeElement).toBe(input);
  expect(screen.getByRole('button', { name: 'Select (Esc)' })).toHaveAttribute('aria-pressed', 'true');
});
