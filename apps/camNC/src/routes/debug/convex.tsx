import { convexQuery } from '@convex-dev/react-query';
import { api } from '@convex-gen/api';
import { Button } from '@heroui/react';
import { useSuspenseQuery } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import { useMutation } from 'convex/react';

export const Route = createFileRoute('/debug/convex')({
  component: RouteComponent,
});

function RouteComponent() {
  const addRow = useMutation(api.posts.add);
  const { data: posts } = useSuspenseQuery(convexQuery(api.posts.list, {}));
  const onClick = async () => {
    await addRow({
      title: 'Hello ' + new Date().toISOString(),
      body: 'World',
    });
  };
  return (
    <div>
      Hello "/debug/convex"!
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
