/** Work offsets throughout the app are in mm, regardless of the controller's current unit mode. */
export function workOffsetCommand(offset: Partial<Record<'x' | 'y' | 'z', number>>, coordinateSystem = 0): string {
  const axes = (['x', 'y', 'z'] as const)
    .filter(axis => offset[axis] !== undefined)
    .map(axis => `${axis.toUpperCase()}${offset[axis]!.toFixed(3)}`);
  return `G21 G10 L2 P${coordinateSystem} ${axes.join(' ')}`;
}
