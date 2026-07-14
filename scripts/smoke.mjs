import puppeteer from 'puppeteer-core';

const browser = await puppeteer.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true,
  args: ['--no-sandbox', '--use-angle=metal'],
});

try {
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 });
  await page.goto('http://localhost:4173/', { waitUntil: 'networkidle0' });
  await page.waitForFunction(() => window.__oceanVoyager?.player);

  const before = await page.evaluate(() => ({
    started: window.__oceanVoyager.game.started,
    z: window.__oceanVoyager.player.position.z,
    islands: window.__oceanVoyager.islands.length,
    enemies: window.__oceanVoyager.enemies.length,
    canvasWidth: document.querySelector('#scene').clientWidth,
  }));
  if (before.started || before.islands !== 5 || before.enemies !== 3 || before.canvasWidth < 1000) {
    throw new Error(`Invalid initial state: ${JSON.stringify(before)}`);
  }

  await page.click('#start-button');
  await page.keyboard.down('KeyW');
  await new Promise((resolve) => setTimeout(resolve, 900));
  await page.keyboard.up('KeyW');
  await page.keyboard.press('Space');
  await new Promise((resolve) => setTimeout(resolve, 300));

  const after = await page.evaluate(() => ({
    started: window.__oceanVoyager.game.started,
    z: window.__oceanVoyager.player.position.z,
    health: window.__oceanVoyager.game.health,
    startHidden: document.querySelector('#start-screen').classList.contains('hidden'),
  }));
  if (!after.started || !after.startHidden || after.z >= before.z || after.health <= 0) {
    throw new Error(`Gameplay input failed: ${JSON.stringify({ before, after })}`);
  }

  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 1 });
  await new Promise((resolve) => setTimeout(resolve, 200));
  const mobile = await page.evaluate(() => ({
    touchDisplay: getComputedStyle(document.querySelector('.touch-controls')).display,
    width: document.documentElement.scrollWidth,
    viewport: window.innerWidth,
  }));
  if (mobile.touchDisplay === 'none' || mobile.width > mobile.viewport) {
    throw new Error(`Mobile layout failed: ${JSON.stringify(mobile)}`);
  }
  if (errors.length) throw new Error(`Browser errors: ${errors.join(' | ')}`);

  console.log(JSON.stringify({ initial: before, gameplay: after, mobile }, null, 2));
} finally {
  await browser.close();
}
