import { SidebarGroup, SidebarGroupLabel } from '@/components/ui/sidebar';
import { FluidncApi } from '@/lib/fluidnc-api';
import { SetZeroButton } from './SetZeroButton';
const api = new FluidncApi();
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
