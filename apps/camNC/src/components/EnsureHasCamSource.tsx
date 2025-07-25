import { ICamSource, useCamSource } from '@/store/store';
import { Navigate, NavigateOptions } from '@tanstack/react-router';

/** Reactive client side check if given setup/predicate is fulfilled, redirects to target otherwise. */
export function EnsureHasCamSource({
  children,
  predicate,
  to,
}: {
  children: React.ReactNode;
  predicate?: (camSource: ICamSource) => boolean;
  to: NavigateOptions['to'];
}) {
  const camSource = useCamSource();
  if (!camSource || (predicate && !predicate(camSource))) {
    return <Navigate to={to} />;
  }

  return children;
}
