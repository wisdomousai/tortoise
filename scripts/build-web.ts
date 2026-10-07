import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { readApplicationIdentity } from '../apps/desktop/src/application-identity';
const identity = readApplicationIdentity('app.config.json');
await mkdir('dist/web', { recursive: true });
const result = await Bun.build({
  entrypoints: ['apps/web/src/main.tsx'],
  outdir: 'dist/web',
  target: 'browser',
  minify: true,
  sourcemap: 'external',
  naming: 'app.[ext]',
  define: { 'process.env.NODE_ENV': '"production"' },
});
if (!result.success) throw new AggregateError(result.logs, 'Browser build failed');
const escapeHtml = (value: string) =>
  value.replace(
    /[&<>"']/g,
    (character) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]!,
  );
const template = await readFile('apps/web/index.html', 'utf8');
if (!/<title>[\s\S]*?<\/title>/i.test(template))
  throw new Error('Browser HTML template requires a title');
await writeFile(
  'dist/web/index.html',
  template.replace(
    /<title>[\s\S]*?<\/title>/i,
    () => `<title>${escapeHtml(identity.displayName)}</title>`,
  ),
);
console.log('Built shared browser/desktop frontend');
