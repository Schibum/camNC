import { Separator } from '@radix-ui/react-separator';
import { cn } from '@wbcnc/ui/lib/utils';
import { Breadcrumb, BreadcrumbItem, BreadcrumbList, BreadcrumbPage } from './breadcrumb';
import { SidebarTrigger } from './sidebar';

export function PageHeader({ title, className, children }: { title: string; className?: string; children?: React.ReactNode }) {
  return (
    <header className={cn('flex h-10 shrink-0 items-center gap-2 z-10 bg-white/80 rounded-br-lg', className)}>
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
    </header>
  );
}
