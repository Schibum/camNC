import { ConfigProvider } from '@firebase-ui/react';
import { ui } from './clientApp';
import type { ReactNode } from 'react';

export function FirebaseUIProvider({ children }: { children: ReactNode }) {
  return (
    <ConfigProvider ui={ui} policies={{ termsOfServiceUrl: '#', privacyPolicyUrl: '#' }}>
      {children}
    </ConfigProvider>
  );
}
