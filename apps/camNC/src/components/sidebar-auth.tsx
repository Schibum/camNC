import { Link } from '@tanstack/react-router';
import { Avatar, AvatarFallback, AvatarImage } from '@wbcnc/ui/components/avatar';
import { SidebarFooter, SidebarMenu, SidebarMenuButton, SidebarMenuItem } from '@wbcnc/ui/components/sidebar';
import { signOut } from 'firebase/auth';
import { auth } from '@/lib/firebase/clientApp';
import { useUser } from '@/lib/firebase/hooks';

export function SidebarAuthStatus() {
  const user = useUser();
  return (
    <SidebarFooter className="mt-auto">
      <SidebarMenu>
        <SidebarMenuItem>
          {user ? (
            <SidebarMenuButton size="sm" className="gap-2" onClick={() => signOut(auth)}>
              <Avatar className="size-4 rounded">
                <AvatarImage src={user.photoURL ?? undefined} />
                <AvatarFallback className="rounded">U</AvatarFallback>
              </Avatar>
              <span className="truncate">{user.displayName ?? user.email}</span>
            </SidebarMenuButton>
          ) : (
            <SidebarMenuButton asChild size="sm">
              <Link to="/sign-in">Sign in</Link>
            </SidebarMenuButton>
          )}
        </SidebarMenuItem>
      </SidebarMenu>
    </SidebarFooter>
  );
}
