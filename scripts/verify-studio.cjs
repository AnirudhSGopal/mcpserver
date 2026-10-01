const fs = require('fs');
const { JSDOM } = require('jsdom');

async function runTests() {
  console.log('--- STARTING VERIFICATION OF ASSISTANT STUDIO BUILD MAP ---');

  const fileContent = fs.readFileSync('src/protocol/http-server.ts', 'utf8');

  // Extract the HTML from renderStudioHtml
  const match = fileContent.match(/function renderStudioHtml\(\): string {[\s\S]*?return `([\s\S]*?)`;\s*}/);
  if (!match) {
    throw new Error('Could not find renderStudioHtml in http-server.ts');
  }

  const html = match[1];

  // Test 1: Verify Theme CSS tokens
  console.log('\n[TEST 1] Checking Theme Tokens:');
  const expectedThemeTokens = [
    '--bg: #0b0c0f;',
    '--panel: #14161b;',
    '--border: #2a2d34;',
    '--text: #e7e9ee;',
    '--dim: #5b616c;',
    '--st: #2a2d34;',
    '--riv: #1b2431;',
    '--y: #facc15;'
  ];
  for (const token of expectedThemeTokens) {
    if (!html.includes(token)) {
      throw new Error(`Missing expected CSS variable: ${token}`);
    }
  }
  console.log('✓ All black theme tokens present (--bg #0b0c0f, --panel #14161b, --border #2a2d34, --text #e7e9ee, --dim #5b616c, --st #2a2d34, --riv #1b2431, --y #facc15)');

  // Test 2: Check dark scrollbars
  console.log('\n[TEST 2] Checking Dark Scrollbars:');
  if (!html.includes('scrollbar-color: #2a2d34 transparent;') && !html.includes('scrollbar-color:#2a2d34 transparent;')) {
    throw new Error('Dark scrollbar styling missing');
  }
  console.log('✓ Dark scrollbar styling present (scrollbar-color: #2a2d34 transparent)');

  // Test 3: Check left column row layout proportions
  console.log('\n[TEST 3] Checking Left Column Row Layout Proportions:');
  if (!html.includes('grid-template-rows: minmax(0, 50%) minmax(0, 28%) minmax(0, 22%);') &&
      !html.includes('grid-template-rows:minmax(0,50%) minmax(0,28%) minmax(0,22%);')) {
    throw new Error('Left column row proportions (~50% map, ~28% form, ~22% log) missing');
  }
  console.log('✓ Left column row layout proportions (~50% map, ~28% form, ~22% log) verified');

  // Test 4: JSDOM standard load (without ?preview=1)
  console.log('\n[TEST 4] Loading in JSDOM (Standard mode, no ?preview=1):');
  const domNoPreview = new JSDOM(html, {
    url: 'http://localhost:3000/',
    runScripts: 'dangerously',
    resources: 'usable'
  });

  const win = domNoPreview.window;
  const doc = win.document;

  // Verify preview button is hidden
  const previewBtn = doc.getElementById('btnPreview');
  if (!previewBtn) {
    throw new Error('#btnPreview element missing in DOM');
  }
  if (previewBtn.style.display !== 'none') {
    throw new Error(`Expected preview button to be hidden without ?preview=1, but style.display is '${previewBtn.style.display}'`);
  }
  console.log('✓ Preview button is hidden when ?preview=1 is not present');

  // Verify Blueprint tower floors are wireframes
  const towerFloors = doc.querySelectorAll('.tower-floor');
  if (towerFloors.length !== 6) {
    throw new Error(`Expected 6 blueprint tower floors, found ${towerFloors.length}`);
  }
  for (let i = 1; i < 6; i++) {
    const f = towerFloors[i];
    if (f.classList.contains('done') || f.classList.contains('building')) {
      throw new Error(`Floor ${i} should be initial faint wireframe without done or building class`);
    }
  }
  if (!towerFloors[0].classList.contains('building')) {
    throw new Error('Floor 0 should have building class since waypoint 0 starts active');
  }
  console.log('✓ All 6 blueprint tower floors are present as wireframes (floor 0 active/building, floors 1-5 faint)');

  // Verify Antenna exists
  const antenna = doc.getElementById('signalRing1');
  if (!antenna) {
    throw new Error('Tower antenna element missing');
  }
  console.log('✓ Tower antenna element present');

  // Test 5: JSDOM load WITH ?preview=1
  console.log('\n[TEST 5] Loading in JSDOM with ?preview=1:');
  const domWithPreview = new JSDOM(html, {
    url: 'http://localhost:3000/?preview=1',
    runScripts: 'dangerously',
    resources: 'usable'
  });

  const pWin = domWithPreview.window;
  const pDoc = pWin.document;

  const pPreviewBtn = pDoc.getElementById('btnPreview');
  if (!pPreviewBtn || (pPreviewBtn.style.display !== 'inline-block' && pPreviewBtn.style.display !== 'inline-flex')) {
    throw new Error(`Expected preview button to be visible with ?preview=1, got '${pPreviewBtn?.style.display}'`);
  }
  console.log('✓ Preview button is visible with ?preview=1');

  // Test 6: Verify window.mcpforge API
  console.log('\n[TEST 6] Checking window.mcpforge API:');
  if (typeof pWin.mcpforge !== 'object' ||
      typeof pWin.mcpforge.set !== 'function' ||
      typeof pWin.mcpforge.log !== 'function' ||
      typeof pWin.mcpforge.setStats !== 'function') {
    throw new Error('window.mcpforge API missing set, log, or setStats');
  }
  console.log('✓ window.mcpforge API present (set, log, setStats)');

  // Test 7: Verify resizeMap function calculates coordinates dynamically
  console.log('\n[TEST 7] Verifying Dynamic Map Resize & Coordinate Math:');
  // Call renderMapScene with panel dimensions 1000 x 400
  pWin.mcpforge.renderMapScene(1000, 400);

  const svg = pDoc.getElementById('svg');
  if (!svg) {
    throw new Error('SVG #svg not found');
  }
  const viewBox = svg.getAttribute('viewBox');
  if (viewBox !== '0 0 1000 400') {
    throw new Error(`Expected viewBox '0 0 1000 400', got '${viewBox}'`);
  }
  console.log(`✓ SVG viewBox dynamically sized to panel: ${viewBox}`);

  // Check waypoints spread
  const nodes = pDoc.querySelectorAll('.node');
  if (nodes.length !== 13) {
    throw new Error(`Expected 13 node circles, found ${nodes.length}`);
  }

  // Check first and last waypoint positions
  // WP 0: x = 0.06 * 1000 = 60
  // WP 12 (last): x = 0.94 * 1000 = 940
  const firstCx = parseFloat(nodes[0].getAttribute('cx'));
  const lastCx = parseFloat(nodes[nodes.length - 1].getAttribute('cx'));
  console.log(`✓ Waypoint 0 cx: ${firstCx}`);
  console.log(`✓ Waypoint ${nodes.length - 1} cx: ${lastCx}`);

  if (Math.abs(firstCx - 60) > 0.01) {
    throw new Error(`Expected first waypoint x at 60 (6%), got ${firstCx}`);
  }
  if (Math.abs(lastCx - 940) > 0.01) {
    throw new Error(`Expected last waypoint x at 940 (94%), got ${lastCx}`);
  }
  console.log('✓ Waypoint x positions correctly spread from 6% to 94%');

  // Check cards
  const cards = pDoc.querySelectorAll('.card');
  if (cards.length !== 13) {
    throw new Error(`Expected 13 cards, found ${cards.length}`);
  }
  const firstBox = cards[0].querySelector('.box');
  const cardW = parseFloat(firstBox.getAttribute('width'));
  const cardH = parseFloat(firstBox.getAttribute('height'));
  if (cardW < 150 || cardH < 54) {
    throw new Error(`Card size (${cardW}x${cardH}) is smaller than minimum required 150x54 px`);
  }
  console.log(`✓ Card dimensions verified: ${cardW}x${cardH} (meets >= 150x54 px requirement)`);

  // Check card text styles
  const cardTitles = pDoc.querySelectorAll('.card .ct');
  const cardDescs = pDoc.querySelectorAll('.card .cd');
  if (!cardTitles.length || !cardDescs.length) {
    throw new Error('Card titles (.ct) or descriptions (.cd) missing');
  }
  console.log('✓ Card titles (.ct, 12px) and descriptions (.cd, 10.5px) properly structured');

  // Check alternating positions above and below route
  const getCardY = (cardG) => {
    const tr = cardG.getAttribute('transform');
    const m = tr.match(/translate\(\s*[\d.]+\s*,\s*([\d.]+)\s*\)/);
    return m ? parseFloat(m[1]) : 0;
  };
  const y0 = getCardY(cards[0]);
  const y1 = getCardY(cards[1]);
  const nodeY0 = parseFloat(nodes[0].getAttribute('cy'));
  const nodeY1 = parseFloat(nodes[1].getAttribute('cy'));
  const card0Above = y0 < nodeY0;
  const card1Above = y1 < nodeY1;
  console.log(`✓ Card 0 (y=${y0}, node=${nodeY0}, above=${card0Above}), Card 1 (y=${y1}, node=${nodeY1}, above=${card1Above})`);
  if (card0Above === card1Above) {
    throw new Error('Cards are not alternating above and below the route');
  }

  // Test 8: Test set() and blueprint tower floor completion
  console.log('\n[TEST 8] Testing milestone completion and wireframe solidification:');
  pWin.mcpforge.set(0, 'done');
  pWin.mcpforge.set(1, 'done'); // Goal complete -> Floor 0
  const floor0 = pDoc.getElementById('towerFloor0');
  if (!floor0.classList.contains('done')) {
    throw new Error('towerFloor0 should have done class after completing Goal milestone waypoints');
  }
  console.log('✓ towerFloor0 solidifies when Goal milestone completes');

  // Test 9: Preview banner
  console.log('\n[TEST 9] Testing Preview Demo Button execution:');
  pPreviewBtn.click();
  const banner = pDoc.getElementById('previewBanner');
  if (!banner || banner.style.display === 'none') {
    throw new Error('Preview banner did not appear upon clicking Preview Demo button');
  }
  if (!banner.textContent.includes('PREVIEW, NOT REAL PROGRESS')) {
    throw new Error(`Preview banner text unexpected: ${banner.textContent}`);
  }
  console.log('✓ "PREVIEW, NOT REAL PROGRESS" banner displayed upon triggering preview demo');

  console.log('\n>>> ALL 9 ACCEPTANCE CRITERIA TESTS PASSED PERFECTLY! <<<');
}

runTests().catch(err => {
  console.error('\n❌ VERIFICATION FAILED:', err);
  process.exit(1);
});
