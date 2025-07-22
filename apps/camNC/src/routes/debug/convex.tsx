import { useAuth, useClerk, UserButton } from '@clerk/tanstack-react-start';
import { convexQuery } from '@convex-dev/react-query';
import { api } from '@convex-gen/api';
import { Button } from '@heroui/react';
import { useSuspenseQuery } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import { useConvexAuth, useMutation } from 'convex/react';
import { ReactNode } from 'react';

export const Route = createFileRoute('/debug/convex')({
  component: Wrapper,
  beforeLoad: async ({ context }) => {
    if (!context.userId) {
      throw new Error('No user id');
    }
  },
  loader: async ({ context }) => {
    const userName = await context.convexClient.query(api.user.email);
    console.log('userName', userName, context.userId);
    return { userId: context.userId, userName };
  },
  ssr: true,
});
export function Authenticated2({ children }: { children: ReactNode }) {
  'use no memo';
  const { isLoading, isAuthenticated } = useConvexAuth();
  console.log('isLoading', isLoading, isAuthenticated);
  if (isLoading || !isAuthenticated) {
    return null;
  }
  return <>{children}</>;
}

function Wrapper() {
  console.log(useConvexAuth());
  const { isLoading, isAuthenticated } = useConvexAuth();
  if (isLoading || !isAuthenticated) {
    return null;
  }
  return <RouteComponent />;
}

function RouteComponent() {
  const state = Route.useLoaderData();
  console.log('state', state);
  // const { data: user } = useSuspenseQuery(convexQuery(api.user.email, {}));
  const { data: user } = useSuspenseQuery(convexQuery(api.user.email, {}));
  const userH = useAuth();
  const clerk = useClerk();
  clerk.addListener(e => {
    console.log('clerk', e);
  });
  console.log('clerk', clerk.user);
  return (
    <div>
      your id is {state.userId} <br />
      convex: {user} <br />
      {/* user: {user} <br /> */}
      userH: {userH.isSignedIn ? 'signed in' : 'signed out'} <br />
      userH: {userH.userId} <br />
      <UserButton />
    </div>
  );
}

function RouteComponentX() {
  const addRow = useMutation(api.posts.add);
  const { data: user } = useSuspenseQuery(convexQuery(api.user.email, {}));
  const { data: posts } = useSuspenseQuery(convexQuery(api.posts.list, {}));
  const onClick = async () => {
    await addRow({
      title: 'Hello ' + new Date().toISOString(),
      body: 'World',
    });
  };
  return (
    <div>
      Hello "/debug/convex"! user: {user}
      <UserButton />
      {/* <ConvexCamSourceSync /> */}
      <div>
        <Button onPress={onClick}>Add Row</Button>
      </div>
      <ul>
        {posts?.map(post => (
          <li key={post.id}>{post.title}</li>
        ))}
      </ul>
    </div>
  );
}
