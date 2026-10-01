const resolutions = [{ w: 1920, h: 1080 }, { w: 1440, h: 900 }, { w: 1366, h: 768 }];
const N = 14;
const cardW = 132, cardH = 48;
const fourLanes = [-72, -128, 24, 80];

for (const res of resolutions) {
  const safeLeft = 24, safeTop = 72, safeRight = res.w - 380 - 24, safeBottom = res.h - 190;
  const safeWidth = safeRight - safeLeft, safeHeight = safeBottom - safeTop;
  const stepX = (safeWidth - 280) / 13;
  const safeYCenter = (safeTop + safeBottom) / 2;
  const safeAmp = safeHeight * 0.12;

  const P = [];
  for (let i = 0; i < N; i++) {
    P.push({
      x: safeLeft + 90 + i * stepX,
      y: safeYCenter + Math.sin(i * 0.85) * safeAmp
    });
  }

  const useFourLanes = (2 * stepX) < (cardW + 12);
  const cardLayouts = [];

  for (let i = 0; i < N; i++) {
    const p = P[i];
    let preferredLane = useFourLanes ? (i % 4) : ((i % 2 === 0) ? 0 : 2);
    // Candidate lanes in preference order: if 2-lanes, try [0, 1, 3, 2] or [2, 3, 1, 0]
    let candidateLanes;
    if (useFourLanes) {
      candidateLanes = [preferredLane, (preferredLane + 1) % 4, (preferredLane + 2) % 4, (preferredLane + 3) % 4];
    } else {
      candidateLanes = (preferredLane === 0) ? [0, 1, 3, 2] : [2, 3, 1, 0];
    }

    let bestLane = preferredLane;
    let bestCx = Math.max(safeLeft, Math.min(safeRight - 150 - 16 - cardW, p.x - cardW / 2));
    let bestCy = Math.max(safeTop, Math.min(safeBottom - cardH, p.y + fourLanes[preferredLane]));

    for (const lane of candidateLanes) {
      const cx = Math.max(safeLeft, Math.min(safeRight - 150 - 16 - cardW, p.x - cardW / 2));
      const cy = Math.max(safeTop, Math.min(safeBottom - cardH, p.y + fourLanes[lane]));
      let collides = false;
      for (let j = 0; j < i; j++) {
        // Must clear both X and Y
        if (Math.abs(cx - cardLayouts[j].cx) < (cardW + 2) && Math.abs(cy - cardLayouts[j].cy) < (cardH + 2)) {
          collides = true;
          break;
        }
      }
      if (!collides) {
        bestLane = lane;
        bestCx = cx;
        bestCy = cy;
        break;
      }
    }
    cardLayouts.push({ i, cx: bestCx, cy: bestCy, laneIdx: bestLane });
  }

  let overlaps = 0;
  for (let j = 0; j < N; j++) {
    for (let k = j + 1; k < N; k++) {
      if (Math.abs(cardLayouts[j].cx - cardLayouts[k].cx) < (cardW + 2) &&
          Math.abs(cardLayouts[j].cy - cardLayouts[k].cy) < (cardH + 2)) {
        overlaps++;
        console.log(`Collision at ${res.w}x${res.h} between ${j} and ${k}`);
      }
    }
  }
  console.log(`Res ${res.w}x${res.h}: overlaps = ${overlaps}`);
}
