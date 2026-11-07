import { CamNcLogoIcon } from '@/components/CamNcLogo';
import { AppSidebar } from '@/components/app-sidebar';
import { isDemoMode } from '@/lib/demo/demo-mode';
import { isDesktopApp } from '@/lib/desktop/is-desktop';
import { SignedIn, SignedOut, SignInButton, UserButton } from '@clerk/clerk-react';
import { Link } from '@tanstack/react-router';
import { useSidebar } from '@wbcnc/ui/components/sidebar';
import { cn } from '@wbcnc/ui/lib/utils';
import { ChevronsLeft, FolderOpen, LogIn, Menu, type LucideIcon } from 'lucide-react';
import { useLayoutEffect, type ComponentProps } from 'react';
import { useAppRail } from './appRailStore';
import { StepControl } from './StepControl';
import { useRoomForFullPanel } from './useRoomForFullPanel';
import { useAppSteps, type AppStep } from './useAppSteps';

const kRailItem = 'flex h-13 w-16 flex-col items-center justify-center gap-0.5 rounded-lg text-[11px] leading-tight [&_svg]:size-[18px]';
const kRailOther = 'text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-foreground';

function RailButton({ icon: Icon, label, ...props }: { icon: LucideIcon; label: string } & ComponentProps<'button'>) {
  return (
    <button type="button" className={cn(kRailItem, kRailOther)} {...props}>
      <Icon aria-hidden />
      {label}
    </button>
  );
}

function RailStep({ step, className }: { step: AppStep; className?: string }) {
  const Icon = step.icon;
  return (
    <StepControl
      step={step}
      className={cn(
        kRailItem,
        step.current ? 'bg-primary text-primary-foreground' : kRailOther,
        step.disabled && 'cursor-not-allowed text-sidebar-foreground/30 hover:bg-transparent hover:text-sidebar-foreground/30',
        className
      )}>
      <Icon aria-hidden />
      {step.label}
    </StepControl>
  );
}

function RailAccount() {
  // The demo has no sign-in, and the desktop app has no Clerk: it keeps its settings on this computer.
  if (isDesktopApp() || isDemoMode()) return null;
  return (
    <div className="flex h-10 items-center justify-center">
      <SignedIn>
        <UserButton appearance={{ elements: { userButtonAvatarBox: { height: '1.5rem', width: '1.5rem' } } }} />
      </SignedIn>
      <SignedOut>
        <SignInButton mode="modal" forceRedirectUrl="/">
          <RailButton icon={LogIn} label="Sign in" />
        </SignInButton>
      </SignedOut>
    </div>
  );
}

/**
 * The app's navigation, always there: a panel on the left (full, icons or hidden, see `appRailStore`) and tabs at the
 * bottom of a phone. It sits outside the pages, so it stays put going from view to view and while one loads.
 */
export function AppRail() {
  const { steps } = useAppSteps();
  const { toggleSidebar } = useSidebar();
  const rail = useAppRail(s => s.rail);
  const setRail = useAppRail(s => s.setRail);
  const roomForFull = useRoomForFullPanel();
  const shown = rail === 'full' && !roomForFull ? 'icons' : rail;
  // For what's fixed at the page's lower left, like the demo bar, to stay clear of the panel.
  useLayoutEffect(() => {
    document.documentElement.style.setProperty('--app-rail', { full: '14.5rem', icons: '4.5rem', hidden: '0rem' }[shown]);
  }, [shown]);
  return (
    <>
      {shown === 'full' && (
        <AppSidebar pinned collapsible="none" className="sticky top-0 hidden h-dvh w-58 shrink-0 border-r border-sidebar-border md:flex" />
      )}
      {shown === 'icons' && (
        <nav
          aria-label="Steps and app menu"
          className="dark sticky top-0 hidden h-dvh w-18 shrink-0 flex-col items-center gap-1 overflow-y-auto border-r border-sidebar-border bg-sidebar px-1 py-1.5 text-sidebar-foreground scheme-dark md:flex">
          <Link to="/visualize/2DView" aria-label="camNC" className="mb-1 flex h-10 items-center justify-center">
            <CamNcLogoIcon className="size-7" />
          </Link>
          <Link
            to="/cam"
            className={cn(kRailItem, kRailOther)}
            activeOptions={{ exact: true }}
            activeProps={{ className: 'text-sidebar-foreground font-semibold' }}>
            <FolderOpen aria-hidden />
            CAM/CAD
          </Link>
          <span className="my-1 h-px w-10 shrink-0 bg-sidebar-border" />
          {steps.map(step => (
            <RailStep key={step.key} step={step} />
          ))}
          <span className="grow" />
          <RailButton icon={Menu} label="Menu" onClick={toggleSidebar} />
          <RailButton icon={ChevronsLeft} label="Hide" onClick={() => setRail('hidden')} />
          <RailAccount />
        </nav>
      )}
      <nav
        aria-label="Steps"
        className="dark fixed inset-x-0 bottom-0 z-40 flex h-14 border-t border-sidebar-border bg-sidebar text-sidebar-foreground scheme-dark md:hidden">
        {steps.map(step => (
          <RailStep key={step.key} step={step} className="h-full w-auto flex-1 rounded-none" />
        ))}
        <button type="button" onClick={toggleSidebar} className={cn(kRailItem, kRailOther, 'h-full w-auto flex-1 rounded-none')}>
          <Menu aria-hidden />
          Menu
        </button>
      </nav>
    </>
  );
}

/** In the top bar while the panel is hidden: where you are, and the way to everything else. Not on a phone, which has tabs. */
export function HiddenRailButton({ className }: { className?: string }) {
  const { current } = useAppSteps();
  const { toggleSidebar } = useSidebar();
  return (
    <button
      type="button"
      onClick={toggleSidebar}
      aria-label={current ? `Open the menu, current step ${current.label}` : 'Open the menu'}
      className={cn(
        'hidden h-8 shrink-0 items-center gap-1.5 rounded-md bg-primary px-2.5 text-sm text-primary-foreground md:inline-flex [&_svg]:size-4',
        className
      )}>
      <Menu aria-hidden />
      {current?.label}
    </button>
  );
}
