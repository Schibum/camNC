import { Breadcrumb, BreadcrumbItem, BreadcrumbList, BreadcrumbPage } from './breadcrumb';
import { Separator } from '@radix-ui/react-separator';
import { SidebarTrigger } from './sidebar';
import { cn } from '@/lib/utils';

export function PageHeader({ title, className }: { title: string; className?: string }) {
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
    </header>
  );
}
