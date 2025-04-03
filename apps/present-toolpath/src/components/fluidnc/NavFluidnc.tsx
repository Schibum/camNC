import { SidebarGroup, SidebarGroupLabel } from '@/components/ui/sidebar';
import { SetZeroButton } from './SetZeroButton';

export function NavFluidnc() {
  return (
    <SidebarGroup className="group-data-[collapsible=icon]:hidden">
      <SidebarGroupLabel>FluidNC</SidebarGroupLabel>

      <SetZeroButton />
      {/* <SidebarMenu>
        <SidebarMenuItem>
          <SidebarMenuButton>
            <MoreHorizontal />
            <span>More</span>
          </SidebarMenuButton>
        </SidebarMenuItem>
      </SidebarMenu> */}
    </SidebarGroup>
  );
}
