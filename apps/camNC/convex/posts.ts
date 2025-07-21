import type { WithoutSystemFields } from 'convex/server';
import { v } from 'convex/values';
import { api, internal } from './_generated/api.js';
import type { Doc } from './_generated/dataModel';
import { action, internalMutation, mutation, query } from './_generated/server';

export const get = query({
  args: {
    postId: v.string(),
  },
  handler: async (ctx, { postId }) => {
    return await ctx.db
      .query('posts')
      .withIndex('id', q => q.eq('id', postId))
      .unique();
  },
});

export const add = mutation({
  args: {
    title: v.string(),
    body: v.string(),
  },
  handler: async (ctx, args) => {
    console.log('This TypeScript function is running on the server.');
    await ctx.db.insert('posts', {
      id: crypto.randomUUID(),
      title: args.title,
      body: args.body,
    });
  },
});
export const add2 = mutation(async (ctx, { title, body }: { title: string; body: string }) => {
  return await ctx.db.insert('posts', { id: crypto.randomUUID(), title: title + crypto.randomUUID(), body });
});

export const list = query(async ctx => {
  return await ctx.db.query('posts').collect();
});

export const insert = internalMutation((ctx, { post }: { post: WithoutSystemFields<Doc<'posts'>> }) => ctx.db.insert('posts', post));

export const count = query(async ctx => (await ctx.db.query('posts').collect()).length);

export const populate = action(async ctx => {
  const existing = await ctx.runQuery(api.posts.list);
  if (existing.length) {
    return;
  }
  const posts = (await (await fetch('https://jsonplaceholder.typicode.com/posts')).json()) as {
    userId: string;
    id: number;
    title: string;
    body: string;
  }[];
  await Promise.all(
    posts.slice(0, 10).map(post =>
      ctx.runMutation(internal.posts.insert, {
        post: {
          id: post.id.toString(),
          body: post.body,
          title: post.title,
        },
      })
    )
  );
});
