import { AppSidebar } from './app-sidebar';
export function AppRoot({
  children,
  extraSidebarContent: extraContent,
}: {
  children: React.ReactNode;
  extraSidebarContent?: React.ReactNode;
}) {
  return (
    <>
      <AppSidebar extraContent={extraContent} />
      {children}
    </>
  );
}
