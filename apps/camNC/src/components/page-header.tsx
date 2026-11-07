import { Breadcrumb, BreadcrumbItem, BreadcrumbList, BreadcrumbPage } from '@wbcnc/ui/components/breadcrumb';
import { RailButtonSlot } from '@/components/nav/RailButtonSlot';
import { DemoHeaderMark } from '@/lib/demo/DemoHeaderMark';
import { cn } from '@wbcnc/ui/lib/utils';

export function PageHeader({
  title,
  className,
  children,
  hideDemoMark,
}: {
  title: string;
  className?: string;
  children?: React.ReactNode;
  /** For the machine view, which has the full demo bar. */
  hideDemoMark?: boolean;
}) {
  return (
    <header
      className={cn(
        'flex min-h-11 shrink-0 items-center gap-2 z-10 w-full border-b border-black/5 bg-background/75 shadow-sm backdrop-blur-md dark:border-white/10',
        className
      )}>
      <RailButtonSlot />
      <div className="flex items-center gap-2 px-4">
        <Breadcrumb>
          <BreadcrumbList>
            <BreadcrumbItem>
              <BreadcrumbPage>{title}</BreadcrumbPage>
            </BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>
      </div>
      {children}
      {!hideDemoMark && <DemoHeaderMark />}
    </header>
  );
}
