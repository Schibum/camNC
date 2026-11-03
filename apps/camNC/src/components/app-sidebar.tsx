import { Link } from '@tanstack/react-router';
import { Box, Bug, Cctv, FlaskConical, Grid2x2, HardDriveDownload, Layers, Puzzle, Rocket, Scale3d } from 'lucide-react';
import { useLabs } from '@/cam/labs';
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
import { CamNcBrand } from './CamNcLogo';
import { CamSourceSelector } from './CamSourceSelector';
import { SidebarAuthStatus } from './sidebar-auth';

// Remove or comment out the mock data
// const data = {...}

type NavRoute = {
  title: string;
  to: string;
  icon: React.ComponentType<{ className?: string }>;
  exact?: boolean;
};

const routes: NavRoute[] = [
  {
    title: 'Top View',
    to: '/visualize/2DView',
    icon: Grid2x2,
  },
  {
    title: 'Get Started',
    to: '/start',
    icon: Rocket,
  },
];

// Behind Settings › Labs until the whole flow (model → boards → plan → cut) is there.
const kCamRoute: NavRoute = { title: 'CAM (beta)', to: '/cam', icon: Box };

const machineRoutes: NavRoute[] = [
  {
    title: 'FluidNC',
    to: '/setup/fluidnc',
    icon: Puzzle,
  },
  {
    title: 'Machine Bounds',
    to: '/setup/machine-bounds',
    icon: Scale3d,
  },
];

// Each camera's source and setup steps are on its own page, reached from here or the camera switcher.
const cameraRoutes: NavRoute[] = [
  {
    title: 'Cameras',
    to: '/setup/cameras',
    icon: Cctv,
  },
];
const settingsRoutes: NavRoute[] = [
  {
    title: 'Backup & Restore',
    to: '/settings/backup',
    icon: HardDriveDownload,
  },
  {
    title: 'Hide Machine',
    to: '/settings/hide-machine',
    icon: Layers,
  },
  {
    title: 'Labs',
    to: '/settings/labs',
    icon: FlaskConical,
  },
  {
    title: 'Debug',
    to: '/setup/edit-settings',
    icon: Bug,
  },
];

function NavRoutes({ routes, label }: { routes: NavRoute[]; label: string }) {
  return (
    <SidebarGroup>
      <SidebarGroupLabel>{label}</SidebarGroupLabel>
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
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        ))}
      </SidebarMenu>
    </SidebarGroup>
  );
}

type AppSidebarProps = React.ComponentProps<typeof Sidebar> & {};

export function AppSidebar({ ...props }: AppSidebarProps) {
  const location = useLocation({ select: l => l.pathname });
  const { setOpenMobile: setOpen } = useSidebar();
  const camBeta = useLabs(s => s.camBeta);
  // Auto-close the sidebar when the location changes
  useEffect(() => {
    setOpen(false);
  }, [location, setOpen]);
  return (
    <Sidebar variant="floating" {...props}>
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
        <NavRoutes routes={camBeta ? [...routes.slice(0, 1), kCamRoute, ...routes.slice(1)] : routes} label="Views" />
        <NavRoutes routes={machineRoutes} label="Machine" />
        <NavRoutes routes={cameraRoutes} label="Camera (optional)" />
        <NavRoutes routes={settingsRoutes} label="Settings" />
      </SidebarContent>
      <SidebarAuthStatus />
    </Sidebar>
  );
}
