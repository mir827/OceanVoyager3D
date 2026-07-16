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
    p99: pick(0.99),
    max: sorted.at(-1) ?? 0,
    longFrames: samples.filter((value) => value > 50).length,
  };
}

async function runProbe(page, label, scenario, options = {}) {
  const result = await page.evaluate(async ({ label: scenarioLabel, scenarioSource, scenarioOptions }) => {
    const runScenario = new Function(`return (${scenarioSource})`)();
    const frameTimes = [];
    const longTasks = [];
    let observer;
    if (globalThis.PerformanceObserver?.supportedEntryTypes?.includes('longtask')) {
      observer = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) longTasks.push(Math.round(entry.duration * 10) / 10);
      });
      observer.observe({ entryTypes: ['longtask'] });
    }
    const heapStart = performance.memory?.usedJSHeapSize ?? 0;
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

    await runScenario(window.__oceanVoyager, scenarioLabel, scenarioOptions);
    running = false;
    await framePromise;
    observer?.disconnect();
    return {
      frameTimes: frameTimes.slice(3),
      longTasks,
      heapDelta: (performance.memory?.usedJSHeapSize ?? 0) - heapStart,
      performanceProfile: window.__oceanVoyager.performanceProfile,
      audio: window.__oceanVoyager.audio,
    };
  }, { label, scenarioSource: scenario.toString(), scenarioOptions: options.scenarioOptions ?? {} });

  const stats = summarize(result.frameTimes);
  const budget = {
    minFrames: 45,
    maxP95: 48,
    maxFrame: 75,
    maxLongFrames: 6,
    maxLongTaskDuration: 100,
    maxSevereLongTasks: 0,
    ...options.budget,
  };
  const severeLongTasks = result.longTasks.filter((duration) => duration > budget.maxLongTaskDuration);
  if (
    stats.frames < budget.minFrames
    || stats.p95 > budget.maxP95
    || stats.max > budget.maxFrame
    || stats.longFrames > budget.maxLongFrames
    || severeLongTasks.length > budget.maxSevereLongTasks
  ) {
    throw new Error(`${label} frame budget failed: ${JSON.stringify({ stats, longTasks: result.longTasks, severeLongTasks, heapDelta: result.heapDelta, performanceProfile: result.performanceProfile, audio: result.audio })}`);
  }
  return { ...stats, longTasks: result.longTasks, severeLongTasks, heapDelta: result.heapDelta, performanceProfile: result.performanceProfile, audio: result.audio };
}

let page;

try {
  page = await browser.newPage();
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
  await page.evaluateOnNewDocument(() => { window.__OCEAN_PROFILE = true; });
  await page.goto('http://localhost:4173/OceanVoyager3D/', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__oceanVoyager?.player);
  await page.click('#start-button');
  await page.waitForFunction(() => window.__oceanVoyager.game.started && window.__oceanVoyager.audio.context === 'running');
  await page.evaluate(async () => {
    await document.fonts?.ready;
    await new Promise((resolve) => setTimeout(resolve, 1600));
  });

  const pickup = await runProbe(page, 'pickup', async (voyager) => {
    const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    voyager.game.speed = 0;
    for (const item of voyager.items.slice(0, 8)) {
      if (item.collected) continue;
      voyager.collectItem(item);
      await wait(110);
    }
    await wait(700);
  }, {
    budget: {
      minFrames: 42,
      maxP95: 52,
      maxFrame: 75,
      maxLongFrames: 6,
    },
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

  const enduranceMs = Number(process.env.PERF_ENDURANCE_MS ?? 30000);
  const endurance = await runProbe(page, 'mobile-endurance', async (voyager, _label, { durationMs }) => {
    const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    voyager.game.health = 100;
    voyager.game.supplies = 99;
    voyager.game.speed = 7;
    voyager.game.heading = 0;
    voyager.player.rotation.set(0, 0, 0);

    let enemyIndex = 0;
    let itemIndex = 0;
    let nextFire = 0;
    let nextTeleport = 0;
    let nextPickup = 0;
    const startedAt = performance.now();
    while (performance.now() - startedAt < durationMs) {
      const elapsed = performance.now() - startedAt;
      voyager.game.health = 100;
      voyager.game.speed = 7 + Math.sin(elapsed * 0.002) * 2.5;
      voyager.game.heading += 0.018 * Math.sin(elapsed * 0.004);
      voyager.player.rotation.y = voyager.game.heading;

      if (elapsed >= nextTeleport) {
        const enemy = voyager.enemies[enemyIndex % voyager.enemies.length];
        enemyIndex += 1;
        if (enemy?.active) {
          voyager.player.position.set(enemy.ship.position.x + 20, 0.28, enemy.ship.position.z + 18);
        }
        nextTeleport = elapsed + 4200;
      }
      if (elapsed >= nextFire) {
        voyager.fireCannon(voyager.player);
        nextFire = elapsed + 310;
      }
      if (elapsed >= nextPickup && itemIndex < voyager.items.length) {
        const item = voyager.items[itemIndex];
        itemIndex += 1;
        if (item && !item.collected) voyager.collectItem(item);
        nextPickup = elapsed + 2600;
      }
      await wait(120);
    }
    await wait(1000);
  }, {
    scenarioOptions: { durationMs: enduranceMs },
    budget: {
      minFrames: Math.floor((enduranceMs / 1000) * 45),
      maxP95: 48,
      maxFrame: 125,
      maxLongFrames: Math.max(12, Math.ceil(enduranceMs / 900)),
      maxLongTaskDuration: 100,
      maxSevereLongTasks: 0,
    },
  });

  const state = await page.evaluate(() => ({
    enemies: window.__oceanVoyager.enemies.length,
    activeEnemies: window.__oceanVoyager.enemies.filter((enemy) => enemy.active).length,
    particles: window.__oceanVoyager.particleCount,
    audio: window.__oceanVoyager.audio,
    cannonballs: window.__oceanVoyager.cannonballs.length,
    performanceProfile: window.__oceanVoyager.performanceProfile,
  }));
  if (
    state.enemies !== 20
    || state.activeEnemies <= 0
    || state.particles > 140
    || state.audio.source !== 'audio-file'
    || state.audio.style !== 'commercial-high-seas'
    || !state.audio.asset.endsWith('/audio/ocean-voyager-commercial-bgm.mp3')
    || state.audio.tempoBpm !== 126
    || state.audio.layers < 5
    || state.audio.readyState < 2
    || state.audio.duration < 30
    || !state.performanceProfile.compactDevice
    || state.performanceProfile.pixelRatio < 1.5
    || state.performanceProfile.pixelRatioCap < 1.75
    || !state.performanceProfile.shadows
    || state.performanceProfile.shadowMapSize < 1536
    || !state.performanceProfile.antialias
    || state.performanceProfile.maxParticles < 140
    || state.performanceProfile.maxCannonballs < 44
    || state.performanceProfile.pools.stats.particlesReused < 20
    || state.performanceProfile.pools.stats.cannonballsReused < 2
    || state.performanceProfile.pools.stats.lightsReused < 1
  ) {
    throw new Error(`Post-stress state failed: ${JSON.stringify(state)}`);
  }

  console.log(JSON.stringify({ pickup, rapidFire, endurance, state }, null, 2));
} finally {
  await page?.evaluate(() => {
    window.__oceanVoyager?.player && document.querySelectorAll('audio, video').forEach((media) => media.pause());
  }).catch(() => {});
  await page?.close().catch(() => {});
  await browser.close();
}
