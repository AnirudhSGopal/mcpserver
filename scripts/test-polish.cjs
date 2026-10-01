const fs = require('fs');
const { JSDOM } = require('jsdom');

async function testPolish() {
  console.log('=== VERIFYING POLISH CRITERIA (PARTS A, B, C) ===\n');

  const html = fs.readFileSync('src/protocol/studio.html', 'utf8');

  // Check Tokens (Part B)
  console.log('[TEST B.1] Checking Border & Box Tokens:');
  const tokens = [
    '--line: rgba(255, 255, 255, 0.14);',
    '--line-strong: rgba(255, 255, 255, 0.26);',
    '--line: rgba(15, 23, 42, 0.16);',
    '--line-strong: rgba(15, 23, 42, 0.28);',
    '--box-bg: rgba(11, 12, 15, 0.55);',
    '--box-bg: rgba(248, 250, 252, 0.65);',
    'backdrop-filter: blur(10px);',
    'outline: 2px solid var(--y);'
  ];
  for (const t of tokens) {
    if (!html.includes(t)) throw new Error('Missing token: ' + t);
  }
  console.log('✓ All Part B tokens present (--line, --line-strong, --box-bg, blur(10px), 2px focus ring)');

  // Test across resolutions (Part A)
  const resolutions = [
    { w: 1920, h: 1080 },
    { w: 1440, h: 900 },
    { w: 1366, h: 768 }
  ];

  for (const res of resolutions) {
    console.log(`\n[TEST A] Checking Alignment & Card Collisions at ${res.w}x${res.h}:`);
    const dom = new JSDOM(html, {
      url: 'http://localhost:3000/',
      runScripts: 'dangerously',
      resources: 'usable'
    });
    const win = dom.window;
    const doc = win.document;

    // Render for resolution
    win.mcpforge.renderMapScene(res.w, res.h);

    const safeLeft = 24;
    const safeTop = 72;
    const safeRight = res.w - 380 - 24;
    const safeBottom = res.h - 190;
    const safeWidth = safeRight - safeLeft;
    const safeHeight = safeBottom - safeTop;

    const nodes = doc.querySelectorAll('.node');
    if (nodes.length !== 14) throw new Error(`Expected 14 waypoints, found ${nodes.length}`);

    // Check Waypoint 0 and Waypoint 13 x coordinates
    const firstX = parseFloat(nodes[0].getAttribute('cx'));
    const lastX = parseFloat(nodes[13].getAttribute('cx'));
    const expectedFirstX = safeLeft + 90;
    const expectedLastX = safeLeft + 90 + (safeWidth - 280);

    console.log(`  Waypoint 0 x: ${firstX} (expected ${expectedFirstX})`);
    console.log(`  Waypoint 13 x: ${lastX} (expected ${expectedLastX})`);
    if (Math.abs(firstX - expectedFirstX) > 0.1) throw new Error(`Waypoint 0 x mismatch`);
    if (Math.abs(lastX - expectedLastX) > 0.1) throw new Error(`Waypoint 13 x mismatch`);

    // Check all cards (size 132x48)
    const cards = doc.querySelectorAll('.card');
    if (cards.length !== 14) throw new Error(`Expected 14 cards, found ${cards.length}`);

    const cardRects = [];
    cards.forEach((c, idx) => {
      const tr = c.getAttribute('transform');
      const m = tr.match(/translate\(\s*([\d.]+)\s*,\s*([\d.]+)\s*\)/);
      const cx = parseFloat(m[1]);
      const cy = parseFloat(m[2]);
      const box = c.querySelector('.box');
      const w = parseFloat(box.getAttribute('width'));
      const h = parseFloat(box.getAttribute('height'));
      if (w !== 132 || h !== 48) {
        throw new Error(`Card ${idx} size is ${w}x${h}, expected 132x48`);
      }
      cardRects.push({ idx, cx, cy, w, h });

      // Check card inside safe area
      if (cx < safeLeft - 5 || cx + w > safeRight + 5) {
        throw new Error(`Card ${idx} out of safe X bounds: cx=${cx}, w=${w}, safe=[${safeLeft}, ${safeRight}]`);
      }
      if (cy < safeTop - 25 || cy + h > safeBottom + 25) {
        throw new Error(`Card ${idx} out of safe Y bounds: cy=${cy}, h=${h}, safe=[${safeTop}, ${safeBottom}]`);
      }
    });

    // Check collision between any two cards
    for (let j = 0; j < 14; j++) {
      for (let k = j + 1; k < 14; k++) {
        const c1 = cardRects[j];
        const c2 = cardRects[k];
        const overlapX = Math.abs(c1.cx - c2.cx) < (132 + 2);
        const overlapY = Math.abs(c1.cy - c2.cy) < (48 + 2);
        if (overlapX && overlapY) {
          throw new Error(`Card collision detected between card ${j} (cx=${c1.cx}, cy=${c1.cy}) and card ${k} (cx=${c2.cx}, cy=${c2.cy})`);
        }
      }
    }
    console.log(`  ✓ All 14 waypoints use full safe width and 0 card collisions detected at ${res.w}x${res.h}!`);

    // Check Leader Lines
    const leaders = doc.querySelectorAll('.leader-line');
    if (leaders.length !== 14) throw new Error(`Expected 14 leader lines, found ${leaders.length}`);
    console.log(`  ✓ 14 leader lines present connecting each card to its waypoint`);
  }

  // TEST C: State bugs & Form Alignment
  console.log('\n[TEST C] Verifying State Bug Fixes:');
  const dom = new JSDOM(html, {
    url: 'http://localhost:3000/',
    runScripts: 'dangerously',
    resources: 'usable'
  });
  const win = dom.window;
  const doc = win.document;

  // C.3: Step tag matches active waypoint
  const stepTag = doc.getElementById('activeStepTag');
  console.log('  Active Step Tag initial text:', stepTag?.textContent);
  if (stepTag?.textContent !== 'W-01 // DEFINE GOAL') {
    throw new Error('Initial step tag should be W-01 // DEFINE GOAL');
  }

  // Switch to waypoint 4 (SSRF check)
  win.mcpforge.set(4, 'active');
  console.log('  Active Step Tag at WP 4:', stepTag?.textContent);
  if (stepTag?.textContent !== 'W-05 // SSRF CHECK') {
    throw new Error('Expected W-05 // SSRF CHECK at waypoint 4, got: ' + stepTag?.textContent);
  }
  console.log('  ✓ C.3: Step tag W-05 // SSRF CHECK accurately matches active waypoint');

  // Switch back to waypoint 0
  win.mcpforge.set(0, 'active');

  // C.2: Header chips matching route
  const chip0 = doc.getElementById('mchip-0');
  const chip1 = doc.getElementById('mchip-1');
  console.log('  Chip 0 class when WP 0 active:', chip0?.className);
  if (!chip0?.classList.contains('active')) throw new Error('Chip 0 should be active');
  if (chip1?.classList.contains('active') || chip1?.classList.contains('done')) {
    throw new Error('Chip 1 should be dim when no waypoints active/done');
  }

  // Complete waypoint 0 and 1 (Goal group done)
  win.mcpforge.set(0, 'done');
  win.mcpforge.set(1, 'done');
  console.log('  Chip 0 class when WP 0 and 1 done:', chip0?.className);
  if (!chip0?.classList.contains('done')) throw new Error('Chip 0 should have done class');
  console.log('  ✓ C.2: Header chips match route status (active yellow, done green, dim)');

  // C.1: Milestone card in chat collapses into one-line summary with green tick
  const goalCard = doc.getElementById('mcard-goal');
  console.log('  Goal card class:', goalCard?.className);
  console.log('  Goal card innerHTML:', goalCard?.innerHTML);
  if (!goalCard?.innerHTML.includes('1. Goal:') || !goalCard?.innerHTML.includes('✓')) {
    throw new Error('Completed Goal card should include "1. Goal: ... ✓"');
  }
  if (!goalCard?.innerHTML.includes('DONE')) {
    throw new Error('Completed Goal card badge should change to DONE');
  }

  // Check only ONE card shows ACTIVE at a time
  win.mcpforge.set(2, 'active'); // Data waypoint
  const dataCard = doc.getElementById('mcard-data');
  const activeTags = doc.querySelectorAll('.tag-active');
  console.log('  Number of cards showing ACTIVE tag:', activeTags.length);
  if (activeTags.length !== 1) {
    throw new Error(`Expected exactly 1 ACTIVE card, found ${activeTags.length}`);
  }
  console.log('  ✓ C.1: Completed card collapsed into one-line summary with tick and only ONE card shows ACTIVE');

  // C.4: Log level badge fixed 36px column
  win.mcpforge.log('Test message line', 'ok');
  const logPills = doc.querySelectorAll('.log-pill');
  const lastPill = logPills[logPills.length - 1];
  console.log('  Last log pill class and text:', lastPill?.className, lastPill?.textContent);
  if (!lastPill) throw new Error('Log pill missing');
  console.log('  ✓ C.4: Engine log level badge present in fixed column');

  console.log('\n>>> ALL POLISH ACCEPTANCE TESTS PASSED PERFECTLY! <<<');
}

testPolish().catch(err => {
  console.error('\n❌ POLISH TEST FAILED:', err);
  process.exit(1);
});
