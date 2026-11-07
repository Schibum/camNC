import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { userEvent } from '@vitest/browser/context';
import { useRef, useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CadThicknessField } from './CadThicknessField';

afterEach(cleanup);

function setup(initialValue = 18) {
  const commit = vi.fn<(value: number) => void>();
  const done = vi.fn();
  const parentKey = vi.fn();
  function Host() {
    const [value, setValue] = useState(initialValue);
    const next = useRef<HTMLButtonElement>(null);
    return (
      <div onKeyDown={parentKey}>
        <CadThicknessField
          value={value}
          onCommit={number => {
            commit(number);
            setValue(number);
          }}
          onDone={() => {
            done();
            next.current?.focus();
          }}
        />
        <button ref={next}>Next control</button>
        <button onClick={() => setValue(24)}>External value 24</button>
        <output aria-label="Committed thickness">{value}</output>
      </div>
    );
  }
  render(<Host />);
  return {
    input: screen.getByRole('textbox', { name: 'Thickness' }) as HTMLInputElement,
    next: screen.getByRole('button', { name: 'Next control' }),
    commit,
    done,
    parentKey,
  };
}

async function type(input: HTMLInputElement, text: string) {
  await userEvent.click(input);
  input.select();
  await userEvent.keyboard('{Backspace}');
  if (text) await userEvent.keyboard(text);
}

describe('CAD thickness entry', () => {
  it.each(['2mm', '2in', '1/2in', '(20+30)mm', '2mm+'])(
    'hides its fixed suffix while %s already supplies a unit, then restores it for a plain value',
    async text => {
      const ui = setup();
      const suffix = () => ui.input.parentElement!.querySelector('[aria-hidden="true"]');
      expect(suffix()?.textContent).toBe('mm');
      await type(ui.input, text);
      expect(suffix()).toBeNull();
      expect(document.activeElement).toBe(ui.input);
      expect(ui.input.value).toBe(text);
      expect(ui.commit).not.toHaveBeenCalled();
      await type(ui.input, '2');
      expect(suffix()?.textContent).toBe('mm');
      expect(document.activeElement).toBe(ui.input);
    }
  );

  it.each(['0', '-3', '', '2000'])('keeps invalid %j visible and focused after real Enter without changing source', async text => {
    const ui = setup();
    await type(ui.input, text);
    await userEvent.keyboard('{Enter}');
    expect(ui.input.value).toBe(text);
    expect(document.activeElement).toBe(ui.input);
    expect(ui.input.getAttribute('aria-invalid')).toBe('true');
    const error = screen.getByRole('alert');
    expect(ui.input.getAttribute('aria-describedby')?.split(' ')).toContain(error.id);
    expect(ui.commit).not.toHaveBeenCalled();
    expect(ui.done).not.toHaveBeenCalled();
    expect(ui.parentKey).not.toHaveBeenCalled();
    expect(screen.getByRole('status', { name: 'Committed thickness' }).textContent).toBe('18');
  });

  it('keeps invalid blurred text and lets the clicked next control retain focus', async () => {
    const ui = setup();
    await type(ui.input, '2000');
    await userEvent.click(ui.next);
    expect(document.activeElement).toBe(ui.next);
    expect(ui.input.value).toBe('2000');
    expect(ui.input.getAttribute('aria-invalid')).toBe('true');
    expect(screen.getByRole('alert')).toBeTruthy();
    expect(ui.commit).not.toHaveBeenCalled();
    expect(ui.done).not.toHaveBeenCalled();
  });

  it.each([
    ['10cm', 100],
    ['1/2in', 12.7],
    ['1/10', 0.1],
    ['2*150', 300],
  ])('commits valid %s once and finishes on real Enter', async (text, expected) => {
    const ui = setup();
    await type(ui.input, text);
    await userEvent.keyboard('{Enter}');
    expect(ui.commit).toHaveBeenCalledExactlyOnceWith(expected);
    expect(ui.done).toHaveBeenCalledTimes(1);
    expect(document.activeElement).toBe(ui.next);
    expect(ui.input.value).toBe(String(expected));
    expect(ui.input.hasAttribute('aria-invalid')).toBe(false);
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('commits valid blur without running keyboard completion or stealing focus', async () => {
    const ui = setup();
    await type(ui.input, '10cm');
    await userEvent.click(ui.next);
    expect(ui.commit).toHaveBeenCalledExactlyOnceWith(100);
    expect(ui.done).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(ui.next);
  });

  it('allows correction after invalid Enter, clearing the error only when the current text is valid', async () => {
    const ui = setup();
    await type(ui.input, '0');
    await userEvent.keyboard('{Enter}');
    expect(screen.getByRole('alert')).toBeTruthy();
    await type(ui.input, '1/2in');
    await userEvent.keyboard('{Enter}');
    expect(ui.commit).toHaveBeenCalledExactlyOnceWith(12.7);
    expect(screen.queryByRole('alert')).toBeNull();
    expect(document.activeElement).toBe(ui.next);
  });

  it('restores the latest source value on Escape even when an invalid draft survived a source update', async () => {
    const ui = setup();
    await type(ui.input, '-3');
    await userEvent.keyboard('{Enter}');
    await userEvent.click(screen.getByRole('button', { name: 'External value 24' }));
    expect(ui.input.value).toBe('-3');
    expect(ui.commit).not.toHaveBeenCalled();
    await userEvent.click(ui.input);
    await userEvent.keyboard('{Escape}');
    expect(ui.input.value).toBe('24');
    expect(screen.queryByRole('alert')).toBeNull();
    expect(ui.input.hasAttribute('aria-invalid')).toBe(false);
    expect(ui.commit).not.toHaveBeenCalled();
    expect(ui.done).toHaveBeenCalledTimes(1);
    expect(document.activeElement).toBe(ui.next);
  });

  it('does not commit an IME confirmation Enter and keeps full precision in the editable value', async () => {
    const ui = setup(18.123456789);
    expect(ui.input.value).toBe('18.123456789');
    await type(ui.input, '20');
    fireEvent.keyDown(ui.input, { key: 'Enter', isComposing: true, keyCode: 229 });
    expect(ui.commit).not.toHaveBeenCalled();
    expect(ui.done).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(ui.input);
    await userEvent.keyboard('{Enter}');
    await waitFor(() => expect(ui.commit).toHaveBeenCalledExactlyOnceWith(20));
  });

  it('reports invalid/current/reset validity without looping on inline callback identity changes', async () => {
    const validity = vi.fn<(valid: boolean) => void>();
    function Host() {
      const [valid, setValid] = useState(false);
      return (
        <>
          <CadThicknessField
            value={18}
            onCommit={() => {}}
            onValidityChange={next => {
              validity(next);
              setValid(next);
            }}
          />
          <button disabled={!valid}>Finish</button>
        </>
      );
    }
    const view = render(<Host />);
    const input = screen.getByRole('textbox', { name: 'Thickness' }) as HTMLInputElement;
    const finish = screen.getByRole('button', { name: 'Finish' });
    await waitFor(() => expect(finish).not.toBeDisabled());
    await type(input, '0');
    await userEvent.keyboard('{Enter}');
    expect(finish).toBeDisabled();
    expect(document.activeElement).toBe(input);
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(finish).not.toBeDisabled());
    expect(validity.mock.calls.map(([valid]) => valid)).toEqual([true, false, true]);
    await type(input, '2000');
    await userEvent.keyboard('{Enter}');
    expect(validity.mock.calls.at(-1)).toEqual([false]);
    view.unmount();
    expect(validity.mock.calls.at(-1)).toEqual([true]);
  });
});
