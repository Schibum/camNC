import { createPlateDocument, type CadDimension, type CadDocument } from '@wbcnc/cad';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { userEvent } from '@vitest/browser/context';
import { useState } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { CadEditor } from './CadEditor';
import { endCadSession } from './session';

const documentIds: string[] = [];
afterEach(() => {
  cleanup();
  documentIds.forEach(endCadSession);
  documentIds.length = 0;
});
const width = (document: CadDocument) =>
  document.parts[0]!.sketch.constraints.find(
    (constraint): constraint is CadDimension => constraint.label === 'Width' && 'value' in constraint
  )!;

function setup() {
  const source = createPlateDocument();
  documentIds.push(source.id);
  function Harness() {
    const [draft, setDraft] = useState(source),
      [accepted, setAccepted] = useState(source),
      [step, setStep] = useState('design');
    return (
      <div style={{ height: 700 }}>
        {step === 'design' ? (
          <CadEditor
            document={draft}
            onDraftChange={setDraft}
            onFinish={document => {
              setAccepted(structuredClone(document));
              setDraft(document);
              setStep('boards');
            }}
            onCancel={() => setStep('boards')}
          />
        ) : (
          <div>
            <p>Boards</p>
            <button type="button" onClick={() => setStep('design')}>
              Edit design
            </button>
          </div>
        )}
        <output data-testid="draft-width">{String(width(draft).value)}</output>
        <output data-testid="accepted-width">{String(width(accepted).value)}</output>
      </div>
    );
  }
  render(<Harness />);
  const settled = () => waitFor(() => expect(screen.queryByText(/^Checking sketch/)).toBeNull(), { timeout: 20_000 });
  const edit = async (value: number) => {
    const dimension = screen.getByTestId('cad-canvas').querySelector(`[data-dimension="${width(source).id}"]`)!;
    await userEvent.dblClick(dimension);
    expect(document.activeElement).toBe(screen.getByRole('textbox', { name: 'Width mm' }));
    await userEvent.keyboard(`${value}{Enter}`);
    await settled();
  };
  const finish = async () => {
    await settled();
    await userEvent.click(screen.getByRole('button', { name: /Finish sketch/ }));
    await screen.findByRole('button', { name: 'Edit design' });
  };
  const reopen = async () => {
    await userEvent.click(screen.getByRole('button', { name: 'Edit design' }));
    await screen.findByTestId('cad-canvas');
    await settled();
  };
  return { source, settled, edit, finish, reopen };
}

describe('real pointer accepted-design history', () => {
  it.each([
    { name: 'Control+Y', shortcut: '{Control>}y{/Control}' },
    { name: 'Command+Y', shortcut: '{Meta>}y{/Meta}' },
    { name: 'Control+Shift+Z', shortcut: '{Control>}{Shift>}z{/Shift}{/Control}' },
  ])('keeps Undo after Finish/reentry and restores its edit through $name while CAM acceptance stays unchanged', async ({ shortcut }) => {
    const { settled, edit, finish, reopen } = setup();
    await settled();
    await edit(160);
    await finish();
    expect(screen.getByTestId('accepted-width').textContent).toBe('160');
    await reopen();
    expect(screen.getByRole('button', { name: 'Undo (Ctrl or Command Z)' }).hasAttribute('disabled')).toBe(false);
    await userEvent.keyboard('{Control>}z{/Control}');
    await settled();
    expect(screen.getByTestId('draft-width').textContent).toBe('120');
    expect(screen.getByTestId('accepted-width').textContent).toBe('160');
    await userEvent.keyboard(shortcut);
    await settled();
    expect(screen.getByTestId('draft-width').textContent).toBe('160');
    expect(screen.getByTestId('accepted-width').textContent).toBe('160');
  });

  it('cancels edits after reentry back to the most recently accepted source, including an undone draft', async () => {
    const { settled, edit, finish, reopen } = setup();
    await settled();
    await edit(160);
    await finish();
    await reopen();
    await userEvent.keyboard('{Control>}z{/Control}');
    await settled();
    expect(screen.getByTestId('draft-width').textContent).toBe('120');
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await screen.findByRole('button', { name: 'Edit design' });
    expect(screen.getByTestId('draft-width').textContent).toBe('160');
    expect(screen.getByTestId('accepted-width').textContent).toBe('160');
  });
});
