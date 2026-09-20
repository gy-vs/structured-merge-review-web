import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from './app.js';
import { InMemorySessionStore } from './storage.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const port = Number(process.env.PORT ?? 3001);

const app = createApp(new InMemorySessionStore());

// 生产模式：托管 Vite 构建产物（开发时由 Vite dev server 代理 /api）
const clientDist = path.resolve(__dirname, '../client/dist');
app.use((await import('express')).default.static(clientDist));
app.get('*', (_req, res, next) => {
  if (_req.path.startsWith('/api/')) return next();
  res.sendFile(path.join(clientDist, 'index.html'), (err) => err && next());
});

app.listen(port, () => {
  console.log(`merge-workbench server listening on http://localhost:${port}`);
});
