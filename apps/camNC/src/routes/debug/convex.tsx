import { useAuth, useClerk, UserButton } from '@clerk/tanstack-react-start';
import { convexQuery } from '@convex-dev/react-query';
import { api } from '@convex-gen/api';
import { Button } from '@heroui/react';
import { useSuspenseQuery } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import { createServerFn } from '@tanstack/react-start';
import { getHeaders } from '@tanstack/react-start/server';
import { ConvexHttpClient } from 'convex/browser';
import { Authenticated, useMutation } from 'convex/react';

const testServerFn = createServerFn({ method: 'GET' }).handler(async ctx => {
  const client = new ConvexHttpClient(process.env.VITE_CONVEX_URL!);
  const userName = await client.query(api.posts.list);
  console.log('hhh', getHeaders());
  console.log('userName', ctx);
  return userName[0].title;
});

export const Route = createFileRoute('/debug/convex')({
  component: RouteComponent,
  beforeLoad: async ({ context }) => {
    if (!context.userId) {
      throw new Error('No user id');
    }
  },
  loader: async ({ context }) => {
    const result = await testServerFn();
    console.log('server fn result', result);
    return { userId: context.userId, userName: result };
  },
  ssr: true,
});

function Wrapper() {
  return (
    <Authenticated>
      <RouteComponent />
    </Authenticated>
  );
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
