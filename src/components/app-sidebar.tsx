import * as React from 'react';
import { Link } from '@tanstack/react-router';
import { Camera, Home, Info, Route, Settings2, Grid, Eye } from 'lucide-react';

import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarGroup,
  SidebarGroupLabel,
} from '@/components/ui/sidebar';
import { NavUser } from '@/components/nav-user';

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
    title: 'Home',
    to: '/',
    icon: Home,
    exact: true,
  },
  {
    title: 'About',
    to: '/about',
    icon: Info,
  },
  {
    title: 'Camera URL',
    to: '/setup/url-entry',
    icon: Camera,
  },
  {
    title: 'Machine Bounds',
    to: '/setup/point-selection',
    icon: Grid,
  },
  {
    title: 'Visualize',
    to: '/visualize',
    icon: Eye,
  },
  {
    title: 'Undistort',
    to: '/undistort2',
    icon: Settings2,
  },
];

function NavRoutes({ routes }: { routes: NavRoute[] }) {
  return (
    <SidebarGroup>
      <SidebarGroupLabel>Navigation</SidebarGroupLabel>
      <SidebarMenu>
        {routes.map(route => (
          <SidebarMenuItem key={route.to}>
            <SidebarMenuButton asChild tooltip={route.title}>
              <Link
                to={route.to}
                activeProps={{
                  className: 'font-bold',
                }}
                activeOptions={{ exact: route.exact }}
              >
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

type AppSidebarProps = React.ComponentProps<typeof Sidebar> & {
  extraContent?: React.ReactNode;
};

export function AppSidebar({ extraContent, ...props }: AppSidebarProps) {
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
        <NavRoutes routes={routes} />
        {extraContent}
      </SidebarContent>
      <SidebarFooter>
        <NavUser user={{ name: 'User', email: 'user@example.com', avatar: '/avatars/user.jpg' }} />
      </SidebarFooter>
    </Sidebar>
  );
}
