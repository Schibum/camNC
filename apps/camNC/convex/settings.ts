import { v } from 'convex/values';
import { mutation, query } from './_generated/server';

/**
 * Fetch the serialized camSource for the current user.
 */
export const getCamSource = query({
  args: {},
  returns: v.union(v.string(), v.null()),
  handler: async ctx => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return null;

    const existing = await ctx.db
      .query('user_settings')
      .withIndex('by_userId', q => q.eq('userId', identity.subject))
      .unique();

    return existing?.camSource ?? null;
  },
});

/**
 * Persist the serialized camSource for the current user.
 */
export const setCamSource = mutation({
  args: {
    camSource: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    console.log('identity is ', identity?.email);
    if (!identity) throw new Error('Not authenticated');

    const existing = await ctx.db
      .query('user_settings')
      .withIndex('by_userId', q => q.eq('userId', identity.subject))
      .unique();

    if (existing) {
      await ctx.db.patch(existing._id, { camSource: args.camSource });
    } else {
      await ctx.db.insert('user_settings', {
        userId: identity.subject,
        camSource: args.camSource,
      });
    }
    return null;
  },
});
