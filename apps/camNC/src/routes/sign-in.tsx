import { FirebaseUIProvider } from '@/lib/firebase/ui';
import { createFileRoute } from '@tanstack/react-router';
import { SignInAuthScreen } from '@firebase-ui/react';

export const Route = createFileRoute('/sign-in')({
  component: SignInPage,
});

function SignInPage() {
  return (
    <FirebaseUIProvider>
      <div className="container mx-auto max-w-sm py-8">
        <SignInAuthScreen />
      </div>
    </FirebaseUIProvider>
  );
}
