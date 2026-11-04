import { useToolLibrary } from '@/cam/toolLibrary';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import type { ComponentType } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Route } from './bits';

vi.mock('@tanstack/react-router', () => ({ createFileRoute: () => (options: unknown) => ({ options }) }));
vi.mock('@/components/page-header', () => ({ PageHeader: () => null }));

const BitsPage = (Route as unknown as { options: { component: ComponentType } }).options.component;

afterEach(cleanup);

describe('Settings › Bits', () => {
  it('lists library and custom bits by source, edits and removes them', () => {
    useToolLibrary.setState({ bits: [], imports: [] });
    useToolLibrary.getState().importLibrary([{ number: 1, diameter: 3.175, name: '1/8 mill v1', guid: 'a' }], 'Library.json');
    useToolLibrary.getState().addCustom({ diameter: 4, name: '4 mm' });
    render(<BitsPage />);
    expect(within(screen.getByRole('list', { name: 'Library.json' })).getByText('1/8 mill v1')).toBeTruthy();
    const custom = within(screen.getByRole('list', { name: 'Added by hand' }));
    expect(custom.getByText('4 mm')).toBeTruthy();

    fireEvent.click(custom.getByRole('button', { name: 'Edit 4 mm' }));
    const form = within(screen.getByRole('form', { name: 'Edit 4 mm' }));
    fireEvent.change(form.getByLabelText('Name'), { target: { value: '4 mm upcut' } });
    fireEvent.click(form.getByRole('button', { name: 'Save' }));
    expect(useToolLibrary.getState().bits.at(-1)!.name).toBe('4 mm upcut');

    fireEvent.click(screen.getByRole('button', { name: 'Remove 4 mm upcut' }));
    expect(useToolLibrary.getState().bits.map(b => b.name)).toEqual(['1/8 mill v1']);
    expect(screen.queryByRole('list', { name: 'Added by hand' })).toBeNull();
  });
});
