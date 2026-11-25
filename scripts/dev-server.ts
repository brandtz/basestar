// Local API server for `pnpm dev` (no Netlify CLI needed). Data lives in ./.data as JSON files.
import { createServer } from 'node:http';
import { createApp } from '../server/app';
import { FileKV } from '../server/store';

const PORT = Number(process.env.API_PORT ?? 8788);
const app = createApp(new FileKV(process.env.DATA_DIR ?? '.data'), { jwtSecret: process.env.JWT_SECRET });

createServer(async (req, res) => {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  const host = req.headers['x-forwarded-host'] ?? req.headers.host ?? `localhost:${PORT}`;
  const headers = new Headers();
  for (const [k, v] of Object.entries(req.headers)) if (typeof v === 'string') headers.set(k, v);
  const request = new Request(`http://${host}${req.url}`, {
    method: req.method,
    headers,
    body: req.method === 'GET' || req.method === 'HEAD' ? undefined : Buffer.concat(chunks),
  });
  const response = await app(request);
  const out: Record<string, string | string[]> = {};
  response.headers.forEach((v, k) => { if (k !== 'set-cookie') out[k] = v; });
  const cookies = response.headers.getSetCookie();
  if (cookies.length) out['set-cookie'] = cookies;
  res.writeHead(response.status, out);
  res.end(Buffer.from(await response.arrayBuffer()));
}).listen(PORT, () => console.log(`API on http://localhost:${PORT} (data in ${process.env.DATA_DIR ?? '.data'})`));
