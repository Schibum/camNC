import { DepthViewPreset } from './DepthInspector';

export type ViewMode = 'top' | DepthViewPreset;

export const kViewModes: ViewMode[] = ['top', '3d', 'front', 'side'];

export const kViews: Record<ViewMode, { label: string; name: string; shortcut: string }> = {
  top: { label: 'Top', name: 'Top View', shortcut: '1' },
  '3d': { label: '3D', name: '3D View', shortcut: '2' },
  front: { label: 'Front', name: 'Front View (XZ)', shortcut: '3' },
  side: { label: 'Side', name: 'Side View (YZ)', shortcut: '4' },
};

export function viewModeTitle(view: ViewMode) {
  return kViews[view].name;
}
