import puppeteer from 'puppeteer-core';

const browser = await puppeteer.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true,
  args: ['--no-sandbox', '--use-angle=metal', '--autoplay-policy=no-user-gesture-required'],
});

function summarize(samples) {
  const sorted = [...samples].sort((a, b) => a - b);
  const pick = (ratio) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * ratio))] ?? 0;
  return {
    frames: samples.length,
    avg: samples.reduce((sum, value) => sum + value, 0) / Math.max(1, samples.length),
    p95: pick(0.95),
    max: sorted.at(-1) ?? 0,
    longFrames: samples.filter((value) => value > 50).length,
  };
}

async function runProbe(page, label, scenario) {
  const samples = await page.evaluate(async ({ label: scenarioLabel, scenarioSource }) => {
    const runScenario = new Function(`return (${scenarioSource})`)();
    const frameTimes = [];
    let last = performance.now();
    let running = true;

    const framePromise = new Promise((resolve) => {
      const tick = (now) => {
        if (!running) {
          resolve();
          return;
        }
        frameTimes.push(now - last);
        last = now;
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });

    await runScenario(window.__oceanVoyager, scenarioLabel);
    running = false;
    await framePromise;
    return frameTimes.slice(3);
  }, { label, scenarioSource: scenario.toString() });

  const stats = summarize(samples);
  if (stats.frames < 45 || stats.p95 > 52 || stats.max > 100 || stats.longFrames > 6) {
    throw new Error(`${label} frame budget failed: ${JSON.stringify(stats)}`);
  }
  return stats;
}

try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 720, deviceScaleFactor: 1 });
  await page.goto('http://localhost:4173/', { waitUntil: 'networkidle0' });
  await page.waitForFunction(() => window.__oceanVoyager?.player);
  await page.click('#start-button');
  await page.waitForFunction(() => window.__oceanVoyager.audio.context === 'running');

  const pickup = await runProbe(page, 'pickup', async (voyager) => {
    const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    voyager.game.speed = 0;
    for (const item of voyager.items.slice(0, 8)) {
      if (item.collected) continue;
      voyager.player.position.set(item.group.position.x, 0.25, item.group.position.z);
      await wait(110);
    }
    await wait(700);
  });

  const rapidFire = await runProbe(page, 'rapid-fire', async (voyager) => {
    const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    voyager.game.supplies = 20;
    voyager.game.speed = 0;
    voyager.game.heading = 0;
    voyager.player.rotation.set(0, 0, 0);
    voyager.player.position.set(0, 0.25, 32);
    for (let i = 0; i < 12; i += 1) {
      voyager.fireCannon(voyager.player);
      await wait(285);
    }
    await wait(900);
  });

  const state = await page.evaluate(() => ({
    particles: window.__oceanVoyager.particleCount,
    audio: window.__oceanVoyager.audio,
    cannonballs: window.__oceanVoyager.cannonballs.length,
  }));
  if (
    state.particles > 140
    || state.audio.source !== 'audio-file'
    || state.audio.style !== 'commercial-high-seas'
    || !state.audio.asset.endsWith('/audio/ocean-voyager-commercial-bgm.mp3')
    || state.audio.tempoBpm !== 126
    || state.audio.layers < 5
    || state.audio.readyState < 2
    || state.audio.duration < 30
  ) {
    throw new Error(`Post-stress state failed: ${JSON.stringify(state)}`);
  }

  console.log(JSON.stringify({ pickup, rapidFire, state }, null, 2));
} finally {
  await browser.close();
}
