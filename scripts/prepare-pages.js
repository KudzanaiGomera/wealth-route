const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const output = path.join(root, 'dist');
const assets = [
  'index.html',
  'tests.html',
  'manifest.webmanifest',
  'service-worker.js',
  'favicon-16.png',
  'favicon-32.png',
  'icon-192.png',
  'icon-512.png',
  'icon-512-maskable.png',
  'vendor/purify.min.js',
  'vendor/papaparse.min.js',
  'vendor/jspdf.umd.min.js',
];

for (const asset of assets) {
  const source = path.join(root, asset);
  if (!fs.existsSync(source)) throw new Error(`Missing Cloudflare Pages asset: ${asset}`);
  const destination = path.join(output, asset);
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.copyFileSync(source, destination);
}

console.log(`Prepared ${assets.length} Cloudflare Pages assets in dist/.`);
