const puppeteer = require('puppeteer');
const TOKEN = process.argv[2];
const SS = '/tmp/claude-1000/-home-mckg-mi-agente/958cf44c-0202-4888-bb75-5d32412fb9fd/scratchpad/';

async function clickByText(page, text, exact = true) {
  const box = await page.evaluate((text, exact) => {
    const els = Array.from(document.querySelectorAll('button,div,a,span'));
    const el = els.find((l) => {
      const t = (l.textContent || '').trim();
      return exact ? t === text : t.includes(text);
    });
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  }, text, exact);
  if (!box) return false;
  await page.mouse.click(box.x, box.y);
  return true;
}

(async () => {
  const browser = await puppeteer.launch({
    executablePath: '/usr/bin/google-chrome',
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--window-size=1700,1050'],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1700, height: 1050 });
  page.on('pageerror', (err) => console.log('PAGEERROR:', err.message));

  await page.goto(`http://localhost:8081/app?_token=${TOKEN}`, { waitUntil: 'networkidle2', timeout: 30000 });
  await new Promise((r) => setTimeout(r, 1200));
  await clickByText(page, 'Diseño');
  await new Promise((r) => setTimeout(r, 1500));
  await clickByText(page, 'Studio visual');
  await new Promise((r) => setTimeout(r, 1500));
  await page.mouse.click(560, 598);
  await new Promise((r) => setTimeout(r, 2500));
  await page.screenshot({ path: SS + 'now_state.png' });

  // Zoom to fit fully so all text elements are reachable in viewport (zoom out button "-")
  for (let i = 0; i < 6; i++) {
    await page.mouse.click(1166, 26); // the "-" zoom button
    await new Promise((r) => setTimeout(r, 150));
  }
  await new Promise((r) => setTimeout(r, 400));
  await page.screenshot({ path: SS + 'zoomed_out.png' });

  // gather all text-element wrapper boxes: identified by cursor style move/text + group/elem class + not being chrome
  const rects = await page.evaluate(() => {
    const nodes = Array.from(document.querySelectorAll('div.group\\/elem'));
    return nodes.map((n, i) => {
      const cs = getComputedStyle(n);
      const r = n.getBoundingClientRect();
      return {
        i,
        cursor: cs.cursor,
        text: (n.textContent || '').trim().slice(0, 24),
        x: r.x, y: r.y, w: r.width, h: r.height,
        z: cs.zIndex,
      };
    }).filter(o => o.w > 0 && o.h > 0);
  });
  console.log('total group/elem nodes:', rects.length);
  console.log(JSON.stringify(rects, null, 0));

  await browser.close();
})();
