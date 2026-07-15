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
    items: window.__oceanVoyager.items.length,
    shipScale: window.__oceanVoyager.player.scale.x,
    canvasWidth: document.querySelector('#scene').clientWidth,
  }));
  if (before.started || before.islands !== 5 || before.enemies < 6 || before.items < 12 || before.shipScale >= 0.8 || before.canvasWidth < 1000) {
    throw new Error(`Invalid initial state: ${JSON.stringify(before)}`);
  }

  await page.click('#start-button');
  await page.keyboard.down('KeyW');
  await new Promise((resolve) => setTimeout(resolve, 900));
  await page.keyboard.up('KeyW');
  await page.keyboard.press('Space');
  await new Promise((resolve) => setTimeout(resolve, 80));

  const after = await page.evaluate(() => ({
    started: window.__oceanVoyager.game.started,
    z: window.__oceanVoyager.player.position.z,
    health: window.__oceanVoyager.game.health,
    startHidden: document.querySelector('#start-screen').classList.contains('hidden'),
    cannonballs: window.__oceanVoyager.cannonballs.filter((ball) => !ball.hostile).length,
    audio: window.__oceanVoyager.audio,
  }));
  if (!after.started || !after.startHidden || after.z >= before.z || after.health <= 0 || after.cannonballs < 1 || !after.audio.active || after.audio.context !== 'running' || after.audio.gain < 0.9) {
    throw new Error(`Gameplay input failed: ${JSON.stringify({ before, after })}`);
  }

  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 1 });
  await new Promise((resolve) => setTimeout(resolve, 200));
  const mobile = await page.evaluate(() => ({
    touchDisplay: getComputedStyle(document.querySelector('.touch-controls')).display,
    width: document.documentElement.scrollWidth,
    viewport: window.innerWidth,
    joystickDisplay: getComputedStyle(document.querySelector('#joystick')).display,
  }));
  if (mobile.touchDisplay === 'none' || mobile.width > mobile.viewport) {
    throw new Error(`Mobile layout failed: ${JSON.stringify(mobile)}`);
  }

  const joystickHandle = await page.$('#joystick');
  const joystickBox = await joystickHandle.boundingBox();
  await page.mouse.move(joystickBox.x + joystickBox.width / 2, joystickBox.y + joystickBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(joystickBox.x + joystickBox.width / 2 + 34, joystickBox.y + joystickBox.height / 2 - 42, { steps: 5 });
  const motionBefore = await page.evaluate(() => ({ heading: window.__oceanVoyager.game.heading, speed: window.__oceanVoyager.game.speed }));
  await new Promise((resolve) => setTimeout(resolve, 300));
  const joystickState = await page.evaluate(() => ({
    ...window.__oceanVoyager.joystick,
    heading: window.__oceanVoyager.game.heading,
    speed: window.__oceanVoyager.game.speed,
  }));
  await page.mouse.up();
  if (!joystickState.active || joystickState.x < 0.3 || joystickState.y > -0.3) {
    throw new Error(`Joystick drag failed: ${JSON.stringify(joystickState)}`);
  }
  if (Math.abs(joystickState.heading - motionBefore.heading) < 0.12 || joystickState.speed <= motionBefore.speed) {
    throw new Error(`Joystick response too slow: ${JSON.stringify({ motionBefore, joystickState })}`);
  }
  if (errors.length) throw new Error(`Browser errors: ${errors.join(' | ')}`);

  console.log(JSON.stringify({ initial: before, gameplay: after, mobile, joystick: joystickState }, null, 2));
} finally {
  await browser.close();
}
