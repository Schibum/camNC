import { query } from './_generated/server';

export const profile = query({
  args: {},
  handler: ctx => ctx.auth.getUserIdentity(),
});

export const name = query({
  args: {},
  handler: async ctx => (await ctx.auth.getUserIdentity())?.name,
});
export const email = query({
  args: {},
  handler: async ctx => (await ctx.auth.getUserIdentity())?.email,
});
