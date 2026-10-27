import { useMachineBoundsOrNull } from '@/store/store';
import { Navigate, NavigateOptions } from '@tanstack/react-router';

/** Redirects to `to` while the machine bounds are not set up. */
export function EnsureHasMachineBounds({ children, to }: { children: React.ReactNode; to: NavigateOptions['to'] }) {
  const bounds = useMachineBoundsOrNull();
  if (!bounds) return <Navigate to={to} />;
  return children;
}
