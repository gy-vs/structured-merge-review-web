import express from 'express';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from './app';
import { InMemorySessionStore } from './storage';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = createApp(new InMemorySessionStore());

// 生产模式：若已构建前端则一并托管
const dist = path.resolve(__dirname, '../dist');
if (existsSync(dist)) {
  app.use(express.static(dist));
  app.get('*', (_req, res) => res.sendFile(path.join(dist, 'index.html')));
}

const port = Number(process.env.PORT ?? 3001);
app.listen(port, () => {
  console.log(`merge-workbench server listening on http://localhost:${port}`);
});
