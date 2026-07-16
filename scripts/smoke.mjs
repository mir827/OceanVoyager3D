import puppeteer from 'puppeteer-core';

const browser = await puppeteer.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true,
  args: ['--no-sandbox', '--use-angle=metal'],
});

let page;

try {
  page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 });
  await page.goto('http://localhost:4173/OceanVoyager3D/', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__oceanVoyager?.player);

  const before = await page.evaluate(() => ({
    started: window.__oceanVoyager.game.started,
    z: window.__oceanVoyager.player.position.z,
    islands: window.__oceanVoyager.islands.length,
    enemies: window.__oceanVoyager.enemies.length,
    items: window.__oceanVoyager.items.length,
    shipScale: window.__oceanVoyager.player.scale.x,
    ultimate: window.__oceanVoyager.game.ultimateCharge,
    ultimateButton: Boolean(document.querySelector('#ultimate-button')),
    canvasWidth: document.querySelector('#scene').clientWidth,
  }));
  if (before.started || before.islands !== 5 || before.enemies !== 20 || before.items < 12 || before.shipScale >= 0.8 || before.ultimate !== 40 || !before.ultimateButton || before.canvasWidth < 1000) {
    throw new Error(`Invalid initial state: ${JSON.stringify(before)}`);
  }

  await page.click('#start-button');
  await page.waitForFunction(() => window.__oceanVoyager.game.started && window.__oceanVoyager.audio.context === 'running');
  const enemyPositionsBefore = await page.evaluate(() => window.__oceanVoyager.enemies.map((enemy) => ({
    x: enemy.ship.position.x,
    z: enemy.ship.position.z,
    active: enemy.active,
  })));
  const missionOpen = await page.evaluate(() => ({
    collapsed: document.querySelector('#mission').classList.contains('collapsed'),
    expanded: document.querySelector('#mission').getAttribute('aria-expanded'),
    detailHeight: document.querySelector('#mission-detail').getBoundingClientRect().height,
  }));
  if (missionOpen.collapsed || missionOpen.expanded !== 'true' || missionOpen.detailHeight < 10) {
    throw new Error(`Mission did not start expanded: ${JSON.stringify(missionOpen)}`);
  }

  await new Promise((resolve) => setTimeout(resolve, 5200));
  const enemyMotion = await page.evaluate((startPositions) => {
    const movedEnemies = window.__oceanVoyager.enemies.filter((enemy, index) => {
      const start = startPositions[index];
      if (!enemy.active || !start?.active) return false;
      const dx = enemy.ship.position.x - start.x;
      const dz = enemy.ship.position.z - start.z;
      return dx * dx + dz * dz > 0.25;
    }).length;
    return { total: window.__oceanVoyager.enemies.length, movedEnemies };
  }, enemyPositionsBefore);
  if (enemyMotion.total !== 20 || enemyMotion.movedEnemies < 20) {
    throw new Error(`Enemy movement failed: ${JSON.stringify(enemyMotion)}`);
  }

  const missionCollapsed = await page.evaluate(() => ({
    collapsed: document.querySelector('#mission').classList.contains('collapsed'),
    expanded: document.querySelector('#mission').getAttribute('aria-expanded'),
    detailHeight: document.querySelector('#mission-detail').getBoundingClientRect().height,
    box: document.querySelector('#mission').getBoundingClientRect().toJSON(),
    labelDisplay: getComputedStyle(document.querySelector('#mission span')).display,
  }));
  if (!missionCollapsed.collapsed || missionCollapsed.expanded !== 'false' || missionCollapsed.detailHeight > 1 || missionCollapsed.box.width > 210 || missionCollapsed.box.height > 30 || missionCollapsed.labelDisplay !== 'none') {
    throw new Error(`Mission did not collapse after 5 seconds: ${JSON.stringify(missionCollapsed)}`);
  }

  await page.click('#mission');
  const missionClicked = await page.evaluate(() => ({
    collapsed: document.querySelector('#mission').classList.contains('collapsed'),
    expanded: document.querySelector('#mission').getAttribute('aria-expanded'),
    detailHeight: document.querySelector('#mission-detail').getBoundingClientRect().height,
  }));
  if (missionClicked.collapsed || missionClicked.expanded !== 'true' || missionClicked.detailHeight < 10) {
    throw new Error(`Mission click did not expand panel: ${JSON.stringify(missionClicked)}`);
  }

  await new Promise((resolve) => setTimeout(resolve, 5200));
  const missionRecollapsed = await page.evaluate(() => ({
    collapsed: document.querySelector('#mission').classList.contains('collapsed'),
    expanded: document.querySelector('#mission').getAttribute('aria-expanded'),
  }));
  if (!missionRecollapsed.collapsed || missionRecollapsed.expanded !== 'false') {
    throw new Error(`Mission did not collapse after click expansion: ${JSON.stringify(missionRecollapsed)}`);
  }
  await page.evaluate(() => document.querySelector('#mission').blur());

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
  if (
    !after.started
    || !after.startHidden
    || after.z >= before.z
    || after.health <= 0
    || after.cannonballs < 1
    || !after.audio.active
    || after.audio.context !== 'running'
    || after.audio.gain < 0.9
    || after.audio.source !== 'audio-file'
    || after.audio.style !== 'commercial-high-seas'
    || !after.audio.asset.endsWith('/audio/ocean-voyager-commercial-bgm.mp3')
    || after.audio.tempoBpm !== 126
    || after.audio.layers < 5
    || after.audio.readyState < 2
    || after.audio.duration < 30
  ) {
    throw new Error(`Gameplay input failed: ${JSON.stringify({ before, after })}`);
  }

  const cannonBefore = await page.evaluate(() => ({
    cooldown: window.__oceanVoyager.game.cannonCooldown,
    friendly: window.__oceanVoyager.cannonballs.filter((ball) => !ball.hostile).length,
    particles: window.__oceanVoyager.particleCount,
  }));
  await new Promise((resolve) => setTimeout(resolve, 470));
  await page.keyboard.press('Space');
  await new Promise((resolve) => setTimeout(resolve, 90));
  const cannonAfter = await page.evaluate(() => {
    const friendlyBalls = window.__oceanVoyager.cannonballs.filter((ball) => !ball.hostile);
    const newest = friendlyBalls.at(-1);
    return {
      cooldown: window.__oceanVoyager.game.cannonCooldown,
      friendly: friendlyBalls.length,
      particles: window.__oceanVoyager.particleCount,
      hasGlow: Boolean(newest?.object.material?.emissiveIntensity > 1),
      hasLight: Boolean(newest?.object.children.some((child) => child.isLight)),
    };
  });
  if (cannonBefore.cooldown > 0.46 || cannonAfter.friendly <= cannonBefore.friendly || cannonAfter.particles <= cannonBefore.particles || !cannonAfter.hasGlow || !cannonAfter.hasLight) {
    throw new Error(`Fast vivid cannon failed: ${JSON.stringify({ cannonBefore, cannonAfter })}`);
  }

  await page.evaluate(() => window.__oceanVoyager.chargeUltimate(60));
  await page.keyboard.press('KeyE');
  await new Promise((resolve) => setTimeout(resolve, 120));
  const ultimate = await page.evaluate(() => ({
    charge: window.__oceanVoyager.game.ultimateCharge,
    activeEnemies: window.__oceanVoyager.enemies.filter((enemy) => enemy.active).length,
    particles: document.querySelector('#ultimate-button').classList.contains('ready'),
  }));
  if (ultimate.charge !== 0 || ultimate.activeEnemies >= before.enemies || ultimate.particles) {
    throw new Error(`Ultimate failed: ${JSON.stringify(ultimate)}`);
  }

  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 1 });
  await new Promise((resolve) => setTimeout(resolve, 200));
  const mobile = await page.evaluate(() => ({
    touchDisplay: getComputedStyle(document.querySelector('.touch-controls')).display,
    width: document.documentElement.scrollWidth,
    viewport: window.innerWidth,
    joystickDisplay: getComputedStyle(document.querySelector('#joystick')).display,
    missionBox: document.querySelector('#mission').getBoundingClientRect().toJSON(),
  }));
  if (mobile.touchDisplay === 'none' || mobile.width > mobile.viewport || mobile.missionBox.width > 200) {
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
  if (Math.abs(joystickState.heading - motionBefore.heading) < 0.12 || joystickState.speed <= 0) {
    throw new Error(`Joystick response too slow: ${JSON.stringify({ motionBefore, joystickState })}`);
  }
  if (errors.length) throw new Error(`Browser errors: ${errors.join(' | ')}`);

  console.log(JSON.stringify({ initial: before, enemyMotion, mission: { missionOpen, missionCollapsed, missionClicked, missionRecollapsed }, gameplay: after, cannon: { cannonBefore, cannonAfter }, mobile, joystick: joystickState }, null, 2));
} finally {
  await page?.evaluate(() => {
    window.__oceanVoyager?.player && document.querySelectorAll('audio, video').forEach((media) => media.pause());
  }).catch(() => {});
  await page?.close().catch(() => {});
  await browser.close();
}
