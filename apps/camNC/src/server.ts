// src/server.ts
import { createClerkHandler } from '@clerk/tanstack-react-start/server';
import { createStartHandler, defaultStreamHandler, RequestHandler } from '@tanstack/react-start/server';
import { createRouter } from './router';

const handler = createClerkHandler(
  createStartHandler({
    createRouter,
  })
)(defaultStreamHandler);

// HACK: tanstack start registerGlobalMiddleware does not seem to work
const withHeaders: RequestHandler = async ctx => {
  const resp = await handler(ctx);
  resp.headers.set('Cross-Origin-Opener-Policy', 'same-origin');
  resp.headers.set('Cross-Origin-Embedder-Policy', 'require-corp');
  return resp;
};

export default withHeaders;
