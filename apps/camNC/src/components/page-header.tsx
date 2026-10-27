import { SignedIn, SignedOut, SignInButton, UserButton } from '@clerk/clerk-react';
import { Button } from '@heroui/react';
import { Separator } from '@radix-ui/react-separator';
import { Breadcrumb, BreadcrumbItem, BreadcrumbList, BreadcrumbPage } from '@wbcnc/ui/components/breadcrumb';
import { SidebarTrigger } from '@wbcnc/ui/components/sidebar';
import { isDemoMode } from '@/lib/demo/demo-mode';
import { isDesktopApp } from '@/lib/desktop/is-desktop';
import { cn } from '@wbcnc/ui/lib/utils';

export function PageHeader({ title, className, children }: { title: string; className?: string; children?: React.ReactNode }) {
  return (
    <header
      className={cn(
        'flex h-10 shrink-0 items-center gap-2 z-10 w-full border-b border-black/5 bg-background/75 shadow-sm backdrop-blur-md dark:border-white/10',
        className
      )}>
      <div className="flex items-center gap-2 px-4">
        <SidebarTrigger className="-ml-1" />
        <Separator orientation="vertical" className="mr-2 h-4" />
        <Breadcrumb>
          <BreadcrumbList>
            <BreadcrumbItem>
              <BreadcrumbPage>{title}</BreadcrumbPage>
            </BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>
      </div>
      {children}
      {/* The desktop app has no sign-in (no Clerk). */}
      {!isDesktopApp() && <AccountButtons />}
    </header>
  );
}

function AccountButtons() {
  return (
    <div className="ml-auto mr-2 flex items-center">
      <SignedIn>
        <UserButton
          appearance={{
            elements: {
              userButtonAvatarBox: { height: '1.5rem', width: '1.5rem' },
            },
          }}
        />
      </SignedIn>
      <SignedOut>
        {!isDemoMode() && (
          <SignInButton mode="modal" forceRedirectUrl="/">
            <Button variant="light" size="sm">
              Sign in
            </Button>
          </SignInButton>
        )}
      </SignedOut>
    </div>
  );
}
