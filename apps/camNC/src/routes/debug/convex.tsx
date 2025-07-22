import { UserButton } from '@clerk/tanstack-react-start';
import { convexQuery } from '@convex-dev/react-query';
import { api } from '@convex-gen/api';
import { Button } from '@heroui/react';
import { useSuspenseQuery } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import { Authenticated, useMutation } from 'convex/react';

export const Route = createFileRoute('/debug/convex')({
  component: Wrapper,
  beforeLoad: async ({ context }) => {
    if (!context.userId) {
      throw new Error('No user id');
    }
  },
  loader: async ({ context }) => {
    console.log('loader');
    context.queryClient.ensureQueryData(convexQuery(api.user.email, {}));
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
  console.log('mamaaain');
  const state = Route.useLoaderData();
  console.log('state', state);
  // const { data: user } = useSuspenseQuery(convexQuery(api.user.email, {}));
  const { data: user } = useSuspenseQuery(convexQuery(api.user.email, {}));
  return (
    <div>
      convex: {user} <br />
      {/* user: {user} <br /> */}
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
