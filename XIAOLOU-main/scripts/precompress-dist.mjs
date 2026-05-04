import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { brotliCompressSync, constants, gzipSync } from 'node:zlib';

const distRoot = fileURLToPath(new URL('../dist/', import.meta.url));
const minBytes = 1024;
const compressibleExtensions = new Set([
  '.css',
  '.html',
  '.js',
  '.json',
  '.svg',
  '.txt',
  '.wasm',
  '.xml',
]);

function walk(directory) {
  const entries = readdirSync(directory, { withFileTypes: true });
  return entries.flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? walk(path) : [path];
  });
}

if (!existsSync(distRoot)) {
  throw new Error(`dist directory does not exist: ${distRoot.pathname}`);
}

let sourceFiles = 0;
let artifacts = 0;
let rawBytes = 0;
let artifactBytes = 0;

for (const filePath of walk(distRoot)) {
  if (filePath.endsWith('.br') || filePath.endsWith('.gz')) {
    continue;
  }

  const extension = extname(filePath);
  if (!compressibleExtensions.has(extension)) {
    continue;
  }

  const stats = statSync(filePath);
  if (stats.size < minBytes) {
    continue;
  }

  const source = readFileSync(filePath);
  const outputs = [
    [
      '.br',
      brotliCompressSync(source, {
        params: {
          [constants.BROTLI_PARAM_QUALITY]: 11,
        },
      }),
    ],
    ['.gz', gzipSync(source, { level: 9 })],
  ];

  sourceFiles += 1;
  rawBytes += source.length;

  for (const [suffix, compressed] of outputs) {
    if (compressed.length >= source.length) {
      continue;
    }

    writeFileSync(`${filePath}${suffix}`, compressed);
    artifacts += 1;
    artifactBytes += compressed.length;
  }
}

console.log(
  `[precompress] ${artifacts} artifacts from ${sourceFiles} files; raw=${rawBytes} bytes, compressed=${artifactBytes} bytes`,
);
