// Renders the home-screen / PWA icons into public/ (run once: node scripts/make-icons.mjs). Drawn here, no source art.
import { chromium } from 'playwright';
const svg = (s) => `<svg xmlns="http://www.w3.org/2000/svg" width="${s}" height="${s}" viewBox="0 0 512 512">
  <defs><radialGradient id="g" cx="50%" cy="45%" r="70%"><stop offset="0" stop-color="#0d1a1f"/><stop offset="1" stop-color="#000"/></radialGradient>
  <filter id="b"><feGaussianBlur stdDeviation="6"/></filter></defs>
  <rect width="512" height="512" fill="url(#g)"/>
  <g font-family="Helvetica Neue, Arial, sans-serif" font-weight="800" font-size="150" letter-spacing="6" text-anchor="middle">
    <text x="256" y="250" fill="#74e4ff" filter="url(#b)" opacity=".55">COLD</text>
    <text x="256" y="250" fill="#d8f6ff">COLD</text>
    <text x="256" y="395" fill="#74e4ff" filter="url(#b)" opacity=".55">BOOT</text>
    <text x="256" y="395" fill="#d8f6ff">BOOT</text>
  </g>
  <rect x="96" y="292" width="320" height="3" fill="#74e4ff" opacity=".8"/>
</svg>`;
const b = await chromium.launch();
const p = await b.newPage();
for (const [s, name] of [[180, 'apple-touch-icon.png'], [192, 'icon-192.png'], [512, 'icon-512.png']]) {
  await p.setViewportSize({ width: s, height: s });
  await p.setContent(`<body style="margin:0">${svg(s)}</body>`);
  await p.screenshot({ path: `public/${name}`, clip: { x: 0, y: 0, width: s, height: s } });
}
await b.close();
