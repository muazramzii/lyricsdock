// Bundles the extension into dist/ (load that folder in brave://extensions).
import { build, context } from 'esbuild';
import { cp, mkdir, rm } from 'node:fs/promises';

const watch = process.argv.includes('--watch');
const out = 'dist';

await rm(out, { recursive: true, force: true });
await mkdir(`${out}/icons`, { recursive: true });

const common = {
  bundle: true,
  target: 'chrome116',
  minify: !watch,
  sourcemap: watch ? 'inline' : false,
  legalComments: 'none',
  logLevel: 'info',
};

const entries = [
  { entryPoints: ['src/background/background.ts'], outfile: `${out}/background.js`, format: 'esm' },
  // Content scripts are classic scripts: wrap in an IIFE.
  { entryPoints: ['src/content/content.ts'], outfile: `${out}/content.js`, format: 'iife' },
  { entryPoints: ['src/popup/popup.ts'], outfile: `${out}/popup.js`, format: 'esm' },
];

await Promise.all([
  cp('manifest/manifest.json', `${out}/manifest.json`),
  cp('src/popup/popup.html', `${out}/popup.html`),
  cp('src/popup/popup.css', `${out}/popup.css`),
  cp('icons', `${out}/icons`, { recursive: true }),
]);

if (watch) {
  for (const e of entries) await (await context({ ...common, ...e })).watch();
} else {
  await Promise.all(entries.map((e) => build({ ...common, ...e })));
}
