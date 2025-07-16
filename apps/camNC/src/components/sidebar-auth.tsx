import { SignedIn, SignedOut, SignInButton, UserButton } from '@clerk/clerk-react';
import { SidebarFooter, SidebarMenu, SidebarMenuButton, SidebarMenuItem } from '@wbcnc/ui/components/sidebar';

export function SidebarAuthStatus() {
  return (
    <SidebarFooter className="mt-auto">
      <SidebarMenu>
        <SignedIn>
          <SidebarMenuItem>
            <SidebarMenuButton asChild size="sm">
              <UserButton />
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SignedIn>
        <SignedOut>
          <SidebarMenuItem>
            <SidebarMenuButton asChild>
              <SignInButton mode="modal">Sign in</SignInButton>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SignedOut>
      </SidebarMenu>
    </SidebarFooter>
  );
}
