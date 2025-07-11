import { Link } from '@tanstack/react-router';
import { Camera, Grid2x2, Grid3x3, HardDriveDownload, Layers, Puzzle, Route, Ruler, Scale3d, ScanQrCode, Settings } from 'lucide-react';
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
];

const setupRoutes: NavRoute[] = [
  {
    title: 'Camera Source',
    to: '/setup/url-entry',
    icon: Camera,
  },
  {
    title: 'Camera Calibration',
    to: '/setup/camera-calibration',
    icon: Grid3x3,
  },
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
  {
    title: 'Marker Positions',
    to: '/setup/marker-positions',
    icon: Ruler,
  },
  {
    title: 'Markers in Camera',
    to: '/setup/point-selection',
    icon: ScanQrCode,
  },
  {
    title: 'Debug',
    to: '/setup/edit-settings',
    icon: HardDriveDownload,
  },
];
const settingsRoutes: NavRoute[] = [
  {
    title: 'General',
    to: '/settings/general',
    icon: Settings,
  },
  {
    title: 'Hide Machine',
    to: '/settings/hide-machine',
    icon: Layers,
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
              <a href="#">
                <div className="bg-sidebar-primary text-sidebar-primary-foreground flex aspect-square size-8 items-center justify-center rounded-lg">
                  <Route className="size-4" />
                </div>
                <div className="grid flex-1 text-left text-sm leading-tight">
                  <span className="truncate font-medium">Toolpath Visualizer</span>
                  <span className="truncate text-xs">0.1</span>
                </div>
              </a>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>
      <SidebarContent>
        <NavRoutes routes={routes} label="Views" />
        <NavRoutes routes={setupRoutes} label="Setup" />
        <NavRoutes routes={settingsRoutes} label="Settings" />
      </SidebarContent>
    </Sidebar>
  );
}
