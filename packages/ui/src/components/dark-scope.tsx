import * as React from 'react';

const DarkScopeContext = React.createContext(false);

/**
 * Marks a part of the page as dark (one that also carries the `dark` class) for the menus, popovers, selects and
 * tooltips opened from it. Those render in a portal at the end of the body, outside the `dark` class; React context
 * still reaches them, so they take the `dark` class themselves.
 */
export function DarkScope({ children }: { children: React.ReactNode }) {
  return <DarkScopeContext.Provider value={true}>{children}</DarkScopeContext.Provider>;
}

/** 'dark' inside a `DarkScope`: the class for a portaled popup's own element. */
export function useDarkScopeClass(): string | undefined {
  return React.useContext(DarkScopeContext) ? 'dark' : undefined;
}
