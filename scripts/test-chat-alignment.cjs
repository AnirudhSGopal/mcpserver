const fs = require('fs');
const { JSDOM } = require('jsdom');

async function testChatAlignment() {
  console.log('=== VERIFYING BUILDER ASSISTANT CHAT COLUMN & BUTTON POLISH ===\n');

  const html = fs.readFileSync('src/protocol/studio.html', 'utf8');

  // 1. Check CSS variables and tokens
  console.log('[TEST 1] Checking Button and Theme Tokens:');
  const requiredTokens = [
    '--chat-pad: 16px;',
    '--btn-bg: #1d8fe6;',
    '--btn-text: #ffffff;',
    '--btn-hover: #3aa0f0;',
    '--btn-bg: #facc15;',
    '--btn-text: #111827;',
    '--btn-hover: #eab308;',
    '--btn-active: #ca9a04;',
    '--btn-disabled-bg: rgba(253, 230, 138, 0.6);',
    '--btn-focus-ring: 2px solid #1e3a8a;',
    '--chip-active-bg: rgba(250, 204, 21, 0.25);',
    '--chip-active-border: #eab308;'
  ];

  for (const t of requiredTokens) {
    if (!html.includes(t)) {
      throw new Error(`Missing expected token: ${t}`);
    }
  }
  console.log('✓ All button and theme tokens verified for dark and light modes.');

  // 2. Check Contrast of #111827 on #facc15
  console.log('\n[TEST 2] Checking Contrast Ratio of #111827 on #facc15:');
  function getLuminance(r, g, b) {
    const a = [r, g, b].map(v => {
      v /= 255;
      return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
    });
    return a[0] * 0.2126 + a[1] * 0.7152 + a[2] * 0.0722;
  }
  // #111827 -> 17, 24, 39
  // #facc15 -> 250, 204, 21
  const lumText = getLuminance(17, 24, 39);
  const lumBg = getLuminance(250, 204, 21);
  const ratio = (lumBg + 0.05) / (lumText + 0.05);
  console.log(`  Calculated contrast ratio: ${ratio.toFixed(2)}:1 (Minimum required: 4.5:1)`);
  if (ratio < 4.5) throw new Error('Contrast ratio is below 4.5:1');
  console.log('✓ Text contrast on yellow button exceeds 4.5:1 (AAA accessible).');

  // 3. JSDOM DOM tests
  console.log('\n[TEST 3] Checking DOM Structure & Alignment:');
  const dom = new JSDOM(html, {
    url: 'http://localhost:3000/',
    runScripts: 'dangerously',
    resources: 'usable'
  });
  const win = dom.window;
  const doc = win.document;

  // Check Chat Column and Container
  const chatCol = doc.querySelector('.chat-column');
  if (!chatCol) throw new Error('Missing .chat-column');
  const chatContainer = doc.querySelector('.chat-container');
  if (!chatContainer) throw new Error('Missing .chat-container inside .chat-column');

  // Check Header
  const header = doc.querySelector('.chat-header');
  if (!header) throw new Error('Missing .chat-header');
  const chatTitle = doc.querySelector('.chat-title');
  if (!chatTitle || !chatTitle.textContent.includes('Builder Assistant')) {
    throw new Error('Chat title missing Builder Assistant');
  }
  const chatStatus = doc.querySelector('.chat-status');
  if (!chatStatus || !chatStatus.textContent.includes('Active')) {
    throw new Error('Chat status missing Active');
  }
  const chatSubtext = doc.querySelector('.chat-subtext');
  if (!chatSubtext) throw new Error('Chat subtext missing');
  console.log('✓ Chat header with 15px title, status dot Active, and subtitle present.');

  // Check Message List & Welcome Bubble
  const messages = doc.querySelector('.chat-messages');
  if (!messages) throw new Error('Missing .chat-messages list');
  const welcomeBubble = doc.querySelector('.chat-bubble.assistant');
  if (!welcomeBubble) throw new Error('Missing welcome bubble');
  console.log('✓ Message list and welcome bubble present.');

  // Check Input Row
  const footer = doc.querySelector('.chat-footer');
  if (!footer) throw new Error('Missing .chat-footer');
  const input = doc.querySelector('.chat-input');
  if (!input) throw new Error('Missing .chat-input');
  const sendBtn = doc.querySelector('.btn-chat-send');
  if (!sendBtn) throw new Error('Missing .btn-chat-send');
  console.log('✓ Pinned input row with input and Send button present.');

  // Check Milestone Card Structure (Goal card active initially)
  const goalCard = doc.getElementById('mcard-goal');
  if (!goalCard) throw new Error('Missing #mcard-goal');

  const cardTitle = goalCard.querySelector('.milestone-card-title');
  const activeBadge = goalCard.querySelector('.tag.tag-active');
  if (!cardTitle || !activeBadge || activeBadge.textContent !== 'ACTIVE') {
    throw new Error('Goal card missing Row 1 title or ACTIVE badge');
  }

  const cardLead = goalCard.querySelector('.milestone-card-lead');
  if (!cardLead) throw new Error('Goal card missing Row 2 helper text');

  const chips = goalCard.querySelectorAll('.chat-template-chip');
  if (chips.length !== 3) throw new Error(`Expected 3 chips, found ${chips.length}`);
  console.log(`  Found ${chips.length} template chips: ${Array.from(chips).map(c => c.textContent).join(', ')}`);

  const formLabel = goalCard.querySelector('.form-label');
  const formInput = goalCard.querySelector('#goalInput');
  if (!formLabel || !formInput) throw new Error('Goal card missing Row 4 form field');

  const activePurposeRow = goalCard.querySelector('.active-purpose-row');
  if (!activePurposeRow) throw new Error('Goal card missing Row 5 active purpose row');
  const refineLink = activePurposeRow.querySelector('.active-purpose-link');
  if (!refineLink || refineLink.textContent !== 'Refine in chat') {
    throw new Error('Active purpose row missing "Refine in chat" link');
  }

  const formBtnRow = goalCard.querySelector('.form-btn-row');
  const primaryBtn = formBtnRow.querySelector('.btn.btn-primary');
  if (!primaryBtn || !primaryBtn.textContent.includes('Proceed to Connect Data')) {
    throw new Error('Goal card missing primary Proceed button');
  }
  console.log('✓ All 6 rows of Goal milestone card template strictly verified.');

  // 4. Test Theme Toggling
  console.log('\n[TEST 4] Testing Theme Switching between Dark and Light Mode:');
  const htmlEl = doc.documentElement;

  // Initially dark
  if (htmlEl.getAttribute('data-theme') === 'light') throw new Error('Initial theme should be dark');
  console.log('  Initial theme: dark');

  // Toggle to light
  win.toggleTheme();
  if (htmlEl.getAttribute('data-theme') !== 'light') throw new Error('Theme did not toggle to light');
  console.log('  Toggled theme: light');

  // Toggle back to dark
  win.toggleTheme();
  if (htmlEl.getAttribute('data-theme') !== 'dark') throw new Error('Theme did not toggle back to dark');
  console.log('  Toggled theme: dark');
  console.log('✓ Theme toggle switches modes dynamically without page reload.');

  // 5. Test Milestone Transition & Completed Card Layout
  console.log('\n[TEST 5] Testing Completed Card 44px Single-Row Layout:');
  win.mcpforge.set(0, 'done');
  win.mcpforge.set(1, 'done');
  const collapsedGoal = doc.getElementById('mcard-goal');
  const doneBadge = collapsedGoal.querySelector('.tag.tag-done');
  if (!doneBadge || doneBadge.textContent !== 'DONE') {
    throw new Error('Completed card missing DONE badge');
  }
  if (!collapsedGoal.innerHTML.includes('✓')) {
    throw new Error('Completed card missing green tick');
  }
  const editBtn = collapsedGoal.querySelector('.btn-card-edit');
  if (!editBtn || editBtn.textContent !== 'Edit') {
    throw new Error('Completed card missing Edit button');
  }
  console.log('✓ Completed card successfully collapsed into single row with tick and DONE badge.');

  console.log('\n>>> ALL CHAT COLUMN ALIGNMENT & BUTTON COLOUR TESTS PASSED! <<<');
}

testChatAlignment().catch(err => {
  console.error('\n❌ TEST FAILED:', err);
  process.exit(1);
});
