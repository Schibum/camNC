import { createFileRoute, redirect } from '@tanstack/react-router';

/** The demo's entry point. Demo mode itself is switched on in lib/demo/demo-mode.ts, before the app starts. */
export const Route = createFileRoute('/demo')({
  beforeLoad: () => {
    throw redirect({ to: '/visualize/2DView', search: { view: 'top' }, replace: true });
  },
});
