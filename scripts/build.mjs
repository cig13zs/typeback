import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));
const copy = JSON.parse(readFileSync(path.join(root, 'src/copy.json'), 'utf8'));
const outDir = path.join(root, 'dist');

await build({
  configFile: false,
  root: path.join(root, 'src'),
  base: './',
  publicDir: path.join(root, 'public'),
  build: {
    outDir,
    emptyOutDir: true,
    sourcemap: false,
    modulePreload: false,
    rollupOptions: {
      input: {
        popup: path.join(root, 'src/popup/index.html'),
        options: path.join(root, 'src/options/index.html'),
      },
    },
  },
});

await build({
  configFile: false,
  root,
  publicDir: false,
  build: {
    outDir,
    emptyOutDir: false,
    sourcemap: false,
    lib: {
      entry: path.join(root, 'src/background/index.ts'),
      formats: ['es'],
      fileName: () => 'background',
    },
    rollupOptions: {
      output: {
        format: 'es',
        entryFileNames: 'background.js',
        codeSplitting: false,
      },
    },
  },
});

await build({
  configFile: false,
  root,
  publicDir: false,
  build: {
    outDir,
    emptyOutDir: false,
    sourcemap: false,
    lib: {
      entry: path.join(root, 'src/content/index.ts'),
      name: 'TypebackContent',
      formats: ['iife'],
      fileName: () => 'content',
    },
    rollupOptions: {
      output: {
        format: 'iife',
        entryFileNames: 'content.js',
        extend: true,
        codeSplitting: false,
      },
    },
  },
});

const manifest = {
  manifest_version: 3,
  name: copy.storeName,
  short_name: copy.brand,
  description: copy.shortDescription,
  version: pkg.version,
  minimum_chrome_version: '116',
  action: {
    default_title: copy.storeName,
    default_popup: 'popup/index.html',
    default_icon: {
      16: 'icons/icon-16.png',
      32: 'icons/icon-32.png',
    },
  },
  options_ui: {
    page: 'options/index.html',
    open_in_tab: true,
  },
  background: {
    service_worker: 'background.js',
    type: 'module',
  },
  permissions: ['storage', 'contextMenus', 'alarms'],
  commands: {
    'restore-typed-text': {
      suggested_key: {
        default: 'Ctrl+Shift+Y',
        mac: 'Command+Shift+Y',
      },
      description: copy.shortcutDescription,
    },
  },
  icons: {
    16: 'icons/icon-16.png',
    32: 'icons/icon-32.png',
    48: 'icons/icon-48.png',
    128: 'icons/icon-128.png',
  },
  content_scripts: [
    {
      matches: ['http://*/*', 'https://*/*'],
      js: ['content.js'],
      all_frames: true,
      match_about_blank: true,
      run_at: 'document_end',
    },
  ],
};

mkdirSync(outDir, { recursive: true });
writeFileSync(path.join(outDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`Built ${copy.brand} ${pkg.version}`);
