import { Link } from '@tanstack/react-router';
import { Box, Bug, Cctv, ChevronsLeft, Gauge, HardDriveDownload, Layers, Pin, Puzzle, Rocket, Scale3d, Wrench } from 'lucide-react';
import * as React from 'react';

import { useLocation } from '@tanstack/react-router';
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from '@wbcnc/ui/components/sidebar';
import { useEffect } from 'react';
import { cn } from '@wbcnc/ui/lib/utils';
import { CamNcBrand } from './CamNcLogo';
import { CamSourceSelector } from './CamSourceSelector';
import { StepControl } from './nav/StepControl';
import { useRoomForFullPanel } from './nav/useRoomForFullPanel';
import { useAppRail } from './nav/appRailStore';
import { useAppSteps } from './nav/useAppSteps';
import { useIsMobile } from '@wbcnc/ui/hooks/use-mobile';
import { SidebarAuthStatus } from './sidebar-auth';

// Remove or comment out the mock data
// const data = {...}

type NavRoute = {
  title: string;
  to: string;
  icon: React.ComponentType<{ className?: string }>;
  exact?: boolean;
  /** Small label after the title, e.g. "Beta". */
  badge?: string;
};

const routes: NavRoute[] = [
  {
    title: 'CAM/CAD',
    to: '/cam',
    icon: Box,
    badge: 'Beta',
  },
  {
    title: 'Get started',
    to: '/start',
    icon: Rocket,
  },
];

// Each camera's source and setup steps are on its own page, reached from here or the camera switcher.
const machineRoutes: NavRoute[] = [
  {
    title: 'Connection',
    to: '/setup/fluidnc',
    icon: Puzzle,
  },
  {
    title: 'Work area',
    to: '/setup/machine-bounds',
    icon: Scale3d,
  },
  {
    title: 'Cameras',
    to: '/setup/cameras',
    icon: Cctv,
  },
  {
    title: 'Hide machine',
    to: '/settings/hide-machine',
    icon: Layers,
    badge: 'Beta',
  },
];

const toolRoutes: NavRoute[] = [
  {
    title: 'Bits',
    to: '/settings/bits',
    icon: Wrench,
  },
  {
    title: 'Cutting data',
    to: '/settings/cutting-data',
    icon: Gauge,
  },
];

const appRoutes: NavRoute[] = [
  {
    title: 'Backup & restore',
    to: '/settings/backup',
    icon: HardDriveDownload,
  },
  {
    title: 'Advanced settings',
    to: '/setup/edit-settings',
    icon: Bug,
  },
];

function NavRoutes({ routes, label }: { routes: NavRoute[]; label?: string }) {
  return (
    <SidebarGroup>
      {label && <SidebarGroupLabel>{label}</SidebarGroupLabel>}
      <SidebarMenu>
        {routes.map(route => (
          <SidebarMenuItem key={route.to}>
            <SidebarMenuButton asChild tooltip={route.title}>
              <Link
                to={route.to}
                activeProps={{
                  className: 'font-bold',
                }}
                activeOptions={{ exact: route.exact }}>
                <route.icon className="size-4" />
                <span>{route.title}</span>
                {route.badge && (
                  <span className="ml-auto rounded-full bg-violet-500/15 px-1.5 py-px text-[10px] font-medium uppercase tracking-wide text-violet-700 dark:text-violet-300">
                    {route.badge}
                  </span>
                )}
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        ))}
      </SidebarMenu>
    </SidebarGroup>
  );
}

/** The job's steps, on a phone they're in the tabs at the bottom. */
function JobSteps() {
  const { steps, jobName } = useAppSteps();
  return (
    <SidebarGroup>
      <SidebarGroupLabel className="truncate">{jobName}</SidebarGroupLabel>
      <SidebarMenu>
        {steps.map(step => (
          <SidebarMenuItem key={step.key}>
            <SidebarMenuButton asChild isActive={step.current} disabled={step.disabled} className="disabled:opacity-40">
              <StepControl step={step}>
                <step.icon className="size-4" />
                <span>{step.label}</span>
              </StepControl>
            </SidebarMenuButton>
          </SidebarMenuItem>
        ))}
      </SidebarMenu>
    </SidebarGroup>
  );
}

type AppSidebarProps = React.ComponentProps<typeof Sidebar> & {
  /** Open beside the page, rather than over it. */
  pinned?: boolean;
};

export function AppSidebar({ className, pinned = false, ...props }: AppSidebarProps) {
  const setRail = useAppRail(s => s.setRail);
  const roomForFull = useRoomForFullPanel();
  const phone = useIsMobile();
  const location = useLocation({ select: l => l.pathname });
  const { setOpenMobile: setOpen } = useSidebar();
  // Auto-close the sidebar when the location changes
  useEffect(() => {
    setOpen(false);
  }, [location, setOpen]);
  return (
    <Sidebar variant="floating" className={cn('dark scheme-dark text-sidebar-foreground', className)} {...props}>
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton size="lg" asChild>
              <Link to="/visualize/2DView">
                <CamNcBrand />
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
        <CamSourceSelector />
      </SidebarHeader>
      <SidebarContent>
        {!phone && <JobSteps />}
        <NavRoutes routes={routes} />
        <NavRoutes routes={machineRoutes} label="Machine setup" />
        <NavRoutes routes={toolRoutes} label="Tools" />
        <NavRoutes routes={appRoutes} label="App" />
      </SidebarContent>
      {!phone && (pinned || roomForFull) && (
        <div className="px-2 pb-1">
          <SidebarMenuButton onClick={() => (setOpen(false), setRail(pinned ? 'icons' : 'full'))}>
            {pinned ? <ChevronsLeft className="size-4" /> : <Pin className="size-4" />}
            <span>{pinned ? 'Collapse to icons' : 'Keep open'}</span>
          </SidebarMenuButton>
        </div>
      )}
      <SidebarAuthStatus />
    </Sidebar>
  );
}
