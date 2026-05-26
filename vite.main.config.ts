import { defineConfig } from 'vite';
import path from 'node:path';

/** CJS database drivers that must NOT be bundled into the main-process
 * build. Rollup's CJS → ESM rewrite breaks their internal lazy
 * circular requires (manifest as "Cannot access 'pg' before
 * initialization" at runtime), and they pull in dozens of sub-modules
 * we'd rather load on demand. Listed here as Rollup `external` so the
 * emitted main.js keeps them as `require(...)` calls resolved from
 * `node_modules/` at runtime. Electron Forge's auto-unpack-natives
 * plugin (and asar's `unpack` rule for `node_modules`) ensures they
 * stay on disk in the packaged build. */
const EXTERNAL_NODE_MODULES = [
  'pg',
  'pg-native',
  'mysql2',
  'mysql2/promise',
  'ssh2',
];

export default defineConfig({
  resolve: {
    alias: {
      '~main': path.resolve(__dirname, 'src/main'),
      '~shared': path.resolve(__dirname, 'src/shared'),
    },
    // Prefer Node-resolved modules in the main process (omit 'browser').
    mainFields: ['module', 'jsnext:main', 'jsnext'],
  },
  build: {
    rollupOptions: {
      external: ['electron', ...EXTERNAL_NODE_MODULES],
      output: {
        entryFileNames: 'main.js',
      },
    },
  },
});
