let owners = 0;

/** Checked at event time by machine/global shortcuts, including when a sketch field owns focus. */
export function isCadEditorActive(): boolean {
  return owners > 0;
}

export function acquireCadKeyboard(): () => void {
  owners++;
  let released = false;
  return () => {
    if (!released) owners = Math.max(0, owners - 1);
    released = true;
  };
}
