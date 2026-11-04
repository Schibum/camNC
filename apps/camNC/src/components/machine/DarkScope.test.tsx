import { DarkScope } from '@wbcnc/ui/components/dark-scope';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@wbcnc/ui/components/dropdown-menu';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

function Menu() {
  return (
    <DropdownMenu open>
      <DropdownMenuTrigger>Open</DropdownMenuTrigger>
      <DropdownMenuContent data-testid="menu">
        <DropdownMenuItem>Item</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

describe('DarkScope', () => {
  afterEach(cleanup);

  it('makes a menu opened from a dark part of the page dark, though it renders outside it', async () => {
    render(
      <DarkScope>
        <div className="dark">
          <Menu />
        </div>
      </DarkScope>
    );
    const menu = await screen.findByTestId('menu');
    expect(menu.closest('.dark')).toBe(menu);
  });

  it('leaves menus elsewhere in the page theme', async () => {
    render(<Menu />);
    expect((await screen.findByTestId('menu')).closest('.dark')).toBeNull();
  });
});
