import { createServer } from 'node:http';
import { createReadStream, existsSync, readFileSync } from 'node:fs';
import { extname, join, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(fileURLToPath(new URL('.', import.meta.url)), 'public');
const port = Number(process.env.PORT || 4173);
const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml' };

createServer((req, res) => {
  const pathname = new URL(req.url, `http://${req.headers.host}`).pathname;
  if (pathname === '/config.js') {
    const localConfigPath = join(root, 'config.js');
    if ((!process.env.SUPABASE_URL || !process.env.SUPABASE_PUBLISHABLE_KEY) && existsSync(localConfigPath)) {
      res.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8', 'cache-control': 'no-store' });
      res.end(readFileSync(localConfigPath, 'utf8'));
      return;
    }
    const config = {
      supabaseUrl: process.env.SUPABASE_URL || '',
      supabasePublishableKey: process.env.SUPABASE_PUBLISHABLE_KEY || ''
    };
    res.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8', 'cache-control': 'no-store' });
    res.end(`window.APP_CONFIG = ${JSON.stringify(config)};`);
    return;
  }
  const requested = pathname === '/' ? 'index.html' : decodeURIComponent(pathname).replace(/^\/+/, '');
  const file = normalize(join(root, requested));
  if (!(file === root || file.startsWith(`${root}${sep}`)) || !existsSync(file)) {
    res.writeHead(404);
    res.end('Not found');
    return;
  }
  res.writeHead(200, { 'content-type': types[extname(file)] || 'application/octet-stream' });
  createReadStream(file).pipe(res);
}).listen(port, '127.0.0.1', () => {
  console.log(`班級薪資銀行已啟動：http://localhost:${port}`);
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_PUBLISHABLE_KEY) {
    console.log('請設定 SUPABASE_URL 與 SUPABASE_PUBLISHABLE_KEY，或先以 GitHub Pages 部署設定。');
  }
});
