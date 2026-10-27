import { readFileSync } from 'node:fs';
import { build } from 'esbuild';

const { version } = JSON.parse(readFileSync('package.json', 'utf8'));
await build({
  entryPoints: ['src/cli.tsx'],
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  jsx: 'automatic',
  outfile: 'dist/veng.mjs',
  define: { __VERSION__: JSON.stringify(version), 'process.env.NODE_ENV': '"production"' },
  // ink chỉ dùng devtools khi DEV=true — thay bằng module rỗng cho khỏi kéo theo cả gói.
  plugins: [
    {
      name: 'no-devtools',
      setup(b) {
        b.onResolve({ filter: /^react-devtools-core$/ }, () => ({ path: 'stub', namespace: 'stub' }));
        b.onLoad({ filter: /.*/, namespace: 'stub' }, () => ({
          contents: 'export default { initialize() {}, connectToDevTools() {} };',
        }));
      },
    },
  ],
  // một số gói CJS bên trong cần require().
  banner: {
    js: "#!/usr/bin/env node\nimport { createRequire } from 'node:module'; const require = createRequire(import.meta.url);",
  },
  minify: true,
  legalComments: 'none',
});
