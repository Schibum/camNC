import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { Button } from '@wbcnc/ui/components/button';
import { GoogleAuthProvider, signInWithPopup } from 'firebase/auth';
import { auth } from '@/lib/firebase/clientApp';

export const Route = createFileRoute('/sign-in')({
  component: SignInPage,
});

function SignInPage() {
  const navigate = useNavigate();
  async function handleSignIn() {
    await signInWithPopup(auth, new GoogleAuthProvider());
    navigate({ to: '/' });
  }
  return (
    <div className="flex h-dvh items-center justify-center">
      <Button onClick={handleSignIn}>Sign in with Google</Button>
    </div>
  );
}
