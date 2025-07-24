import { SignedIn, SignedOut, SignInButton, UserButton } from '@clerk/tanstack-react-start';
import { Button } from '@heroui/react';
import { Separator } from '@radix-ui/react-separator';
import { Breadcrumb, BreadcrumbItem, BreadcrumbList, BreadcrumbPage } from '@wbcnc/ui/components/breadcrumb';
import { SidebarTrigger } from '@wbcnc/ui/components/sidebar';
import { cn } from '@wbcnc/ui/lib/utils';

export function PageHeader({ title, className, children }: { title: string; className?: string; children?: React.ReactNode }) {
  return (
    <header className={cn('flex h-10 shrink-0 items-center gap-2 z-10 bg-white/80 rounded-br-lg w-full', className)}>
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
          <SignInButton mode="modal" forceRedirectUrl="/">
            <Button variant="light" size="sm">
              Sign in
            </Button>
          </SignInButton>
        </SignedOut>
      </div>
    </header>
  );
}
