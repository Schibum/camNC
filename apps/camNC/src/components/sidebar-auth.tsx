import { SignedIn, SignedOut, SignInButton, UserButton } from '@clerk/clerk-react';
import { SidebarFooter, SidebarMenu, SidebarMenuButton, SidebarMenuItem } from '@wbcnc/ui/components/sidebar';
import { LogIn } from 'lucide-react';

export function SidebarAuthStatus() {
  return (
    <SidebarFooter className="mt-auto">
      <SidebarMenu>
        <SignedIn>
          <SidebarMenuItem>
            <SidebarMenuButton asChild size="default" className="w-full">
              <UserButton
                showName={true}
                appearance={{
                  elements: {
                    root: 'w-full',
                    userButtonBox: {
                      flexDirection: 'row-reverse',
                      width: '100%',
                    },
                    userButtonTrigger: 'w-full justify-between',
                  },
                }}
              />
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SignedIn>
        <SignedOut>
          <SidebarMenuItem>
            <SidebarMenuButton asChild tooltip="Sign in" className="w-full cursor-pointer">
              <SignInButton mode="modal">
                <div className="flex items-center gap-2">
                  <LogIn className="size-4" />
                  <span>Sign in</span>
                  <span className="text-xs text-muted-foreground">to sync settings</span>
                </div>
              </SignInButton>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SignedOut>
      </SidebarMenu>
    </SidebarFooter>
  );
}
