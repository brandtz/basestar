// Netlify Function (v2). All /api/* requests land here.
import { getStore } from '@netlify/blobs';
import type { Config } from '@netlify/functions';
import { createApp } from '../../server/app';
import { BlobsKV } from '../../server/store';

let app: ReturnType<typeof createApp> | undefined;

export default async (req: Request) => {
  app ??= createApp(new BlobsKV(getStore({ name: 'basestar', consistency: 'strong' })), {
    jwtSecret: process.env.JWT_SECRET,
  });
  return app(req);
};

export const config: Config = { path: '/api/*' };
