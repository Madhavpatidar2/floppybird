(() => {
  'use strict';

  // ---------- Setup ----------
  const W = 288, H = 512, GROUND_H = 64, GY = H - GROUND_H;
  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = false;

  const stage = document.getElementById('stage');
  const scoreEl = document.getElementById('score');
  const bestEl = document.getElementById('best');
  const panel = document.getElementById('panel');
  const panelTitle = document.getElementById('panelTitle');
  const panelScore = document.getElementById('panelScore');
  const panelText = document.getElementById('panelText');

  const INK = '#543847';
  const PIPE_W = 52, RIM_W = 60, RIM_H = 24, GAP = 122, SPACING = 176, SPEED = 2;
  const GRAVITY = 0.36, FLAP = -6.2, MAX_FALL = 9;
  const BIRD_X = 78, BIRD_W = 17, BIRD_H = 12; // hitbox in game px

  // ---------- Pixel-art sprites (drawn from code) ----------
  const make = (w, h, draw) => {
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const g = c.getContext('2d');
    g.imageSmoothingEnabled = false;
    draw(g);
    return c;
  };

  // Bird: 16x12 body map + 3 wing positions (up / mid / down)
  const BODY = [
    '....KKKKKK......',
    '..KKYYYYYYKK....',
    '.KYYYYYYYKWWK...',
    'KYYYYYYYYKWKWK..',
    'KYYYYYYYYKWWWK..',
    'KYYYYYYYYYKKKKKK',
    'KYYYYYYYYKRRRRRK',
    '.KYYYYYYYKKRRRRK',
    '.KLYYYYYYYYKKKKK',
    '..KKLLLYYYKK....',
    '....KKKKKK......',
  ];
  const BIRD_PAL = { K: INK, Y: '#f8b82f', L: '#fae17c', W: '#ffffff', R: '#e8512b' };
  const birdFrames = [2, 4, 6].map(wy => make(16, 12, g => {
    BODY.forEach((row, y) => [...row].forEach((ch, x) => {
      if (ch !== '.') { g.fillStyle = BIRD_PAL[ch]; g.fillRect(x, y, 1, 1); }
    }));
    g.fillStyle = INK;   g.fillRect(2, wy, 6, 4);
    g.fillStyle = '#fff8d6'; g.fillRect(3, wy + 1, 4, 2);
  }));

  // Pipe: shaded columns give a cylindrical look
  const BANDS = [[2, INK], [3, '#d4f0a2'], [4, '#a8dc5e'], [18, '#73bf2e'], [10, '#5ea626'], [9, '#4a8a1e'], [2, INK]];
  const bandColor = (x, w) => {
    let t = Math.floor(x * 48 / w), acc = 0;
    for (const [n, c] of BANDS) { acc += n; if (t < acc) return c; }
    return INK;
  };
  const pipeBody = make(PIPE_W, 1, g => {
    for (let x = 0; x < PIPE_W; x++) { g.fillStyle = bandColor(x, PIPE_W); g.fillRect(x, 0, 1, 1); }
  });
  const pipeRim = make(RIM_W, RIM_H, g => {
    for (let x = 0; x < RIM_W; x++) { g.fillStyle = bandColor(x, RIM_W); g.fillRect(x, 0, 1, RIM_H); }
    g.fillStyle = INK;
    g.fillRect(0, 0, RIM_W, 2); g.fillRect(0, RIM_H - 2, RIM_W, 2);
    g.fillStyle = 'rgba(0,0,0,.18)'; g.fillRect(2, RIM_H - 4, RIM_W - 4, 2);
  });

  // Background: sky, pixel clouds, minimalist city skyline, bushes (tiles horizontally)
  const bg = make(W, H, g => {
    g.fillStyle = '#70c5ce'; g.fillRect(0, 0, W, H);
    const both = fn => { fn(0); fn(-W); };
    const cloud = (cx, cy, s) => both(o => {
      g.fillStyle = '#ffffff'; g.globalAlpha = 0.75;
      g.fillRect(cx + o, cy, 10 * s, 3 * s);
      g.fillRect(cx + o + 2 * s, cy - 2 * s, 6 * s, 2 * s);
      g.fillRect(cx + o + 5 * s, cy - 3 * s, 3 * s, 1 * s);
      g.globalAlpha = 1;
    });
    cloud(20, 120, 4); cloud(170, 70, 5); cloud(110, 220, 3); cloud(220, 280, 4);

    // skyline
    const b = [[0,34,26],[26,52,22],[48,28,18],[66,60,24],[90,40,20],[110,70,22],[132,36,26],
               [158,56,20],[178,30,22],[200,64,24],[224,44,20],[244,58,22],[266,34,22]];
    b.forEach(([x, h, w]) => {
      g.fillStyle = '#c9ecd6'; g.fillRect(x, GY - 26 - h, w, h + 26);
      g.fillStyle = '#b4e0c8';
      for (let wy = GY - 26 - h + 6; wy < GY - 30; wy += 10)
        for (let wx = x + 4; wx < x + w - 4; wx += 7) g.fillRect(wx, wy, 3, 4);
    });
    // bushes
    g.fillStyle = '#8ed17a';
    for (let x = 0; x < W; x += 16) g.fillRect(x, GY - 26 + ((x / 16) % 3) * 3, 18, 30);
    g.fillStyle = '#5fb85a'; g.fillRect(0, GY - 8, W, 8);
  });

  const groundTile = make(24, GROUND_H, g => {
    g.fillStyle = INK; g.fillRect(0, 0, 24, 3);
    g.fillStyle = '#9be04f'; g.fillRect(0, 3, 24, 6);
    g.fillStyle = '#73bf2e';
    for (let i = 0; i < 24; i += 12) { g.fillRect(i, 3, 6, 6); }
    g.fillStyle = '#4a8a1e'; g.fillRect(0, 9, 24, 3);
    g.fillStyle = '#ded895'; g.fillRect(0, 12, 24, GROUND_H - 12);
    g.fillStyle = '#d2c87c'; g.fillRect(0, 14, 24, 2);
  });

  // ---------- State ----------
  let state = 'ready'; // ready | play | over
  let bird, pipes, score, best, groundX, bgX, flapT, lockUntil = 0;

  try { best = +localStorage.getItem('peepflap-best') || 0; } catch { best = 0; }
  bestEl.textContent = best;

  function reset() {
    bird = { y: H / 2 - 30, vy: 0, rot: 0 };
    pipes = [];
    score = 0; groundX = 0; bgX = 0; flapT = 0;
    scoreEl.textContent = '0';
    scoreEl.hidden = true;
    addPipe(W + 60);
  }

  function addPipe(x) {
    const min = 80, max = GY - 80 - GAP;
    pipes.push({ x, gapY: min + Math.random() * (max - min), passed: false });
  }

  function showPanel(mode) {
    panel.hidden = false;
    if (mode === 'ready') {
      panelTitle.textContent = 'Get ready';
      panelScore.hidden = true;
      panelText.textContent = 'Tap to flap. Slip through the pipes.';
    } else {
      panelTitle.textContent = 'Game over';
      panelScore.hidden = false;
      panelScore.textContent = `Score ${score}  Best ${best}`;
      panelText.textContent = 'Tap to try again.';
    }
  }

  function flap() {
    const now = performance.now();
    if (state === 'over') {
      if (now < lockUntil) return;
      reset(); state = 'ready'; showPanel('ready'); return;
    }
    if (state === 'ready') {
      state = 'play'; panel.hidden = true; scoreEl.hidden = false;
    }
    bird.vy = FLAP;
  }

  function die() {
    state = 'over';
    lockUntil = performance.now() + 450;
    if (score > best) {
      best = score; bestEl.textContent = best;
      try { localStorage.setItem('peepflap-best', best); } catch {}
    }
    stage.classList.remove('hit'); void stage.offsetWidth; stage.classList.add('hit');
    showPanel('over');
  }

  // ---------- Update (fixed 60 Hz step) ----------
  function step() {
    flapT++;
    if (state !== 'over') {
      groundX = (groundX + SPEED) % 24;
      bgX = (bgX + SPEED * 0.25) % W;
    }
    if (state === 'ready') {
      bird.y = H / 2 - 30 + Math.sin(flapT / 10) * 6;
      return;
    }
    bird.vy = Math.min(bird.vy + GRAVITY, MAX_FALL);
    bird.y += bird.vy;
    bird.rot = Math.max(-0.45, Math.min(1.3, bird.vy * 0.09));
    if (bird.y < 0) { bird.y = 0; bird.vy = 0; }

    if (state === 'over') {
      if (bird.y + BIRD_H > GY) { bird.y = GY - BIRD_H; bird.vy = 0; }
      return;
    }

    for (const p of pipes) p.x -= SPEED;
    if (pipes[0].x < -RIM_W) pipes.shift();
    const last = pipes[pipes.length - 1];
    if (last.x < W - SPACING + 20) addPipe(last.x + SPACING);

    const bx = BIRD_X, by = bird.y;
    for (const p of pipes) {
      const px = p.x - (RIM_W - PIPE_W) / 2 + (RIM_W - PIPE_W) / 2; // rim-aligned left edge
      const hitX = bx + BIRD_W > p.x && bx < p.x + RIM_W;
      if (hitX && (by < p.gapY || by + BIRD_H > p.gapY + GAP)) return die();
      if (!p.passed && p.x + RIM_W < bx) {
        p.passed = true; score++; scoreEl.textContent = score;
      }
    }
    if (by + BIRD_H >= GY) { bird.y = GY - BIRD_H; die(); }
  }

  // ---------- Draw ----------
  function draw() {
    ctx.clearRect(0, 0, W, H);
    const ox = -Math.floor(bgX);
    ctx.drawImage(bg, ox, 0);
    ctx.drawImage(bg, ox + W, 0);

    for (const p of pipes) {
      const x = Math.round(p.x), bodyX = x + (RIM_W - PIPE_W) / 2;
      const topEnd = Math.round(p.gapY), botStart = Math.round(p.gapY + GAP);
      ctx.drawImage(pipeBody, bodyX, 0, PIPE_W, topEnd - RIM_H);
      ctx.drawImage(pipeRim, x, topEnd - RIM_H);
      ctx.drawImage(pipeRim, x, botStart);
      ctx.drawImage(pipeBody, bodyX, botStart + RIM_H, PIPE_W, GY - botStart - RIM_H);
    }

    for (let x = -Math.floor(groundX); x < W; x += 24) ctx.drawImage(groundTile, x, GY);

    const frame = state === 'over' ? 1 : [0, 1, 2, 1][Math.floor(flapT / 5) % 4];
    ctx.save();
    ctx.translate(BIRD_X + BIRD_W / 2, Math.round(bird.y) + BIRD_H / 2);
    ctx.rotate(bird.rot);
    ctx.drawImage(birdFrames[frame], -8 * 1.1, -6 * 1.1, 17.6, 13.2);
    ctx.restore();
  }

  // ---------- Loop ----------
  let last = performance.now(), acc = 0;
  const DT = 1000 / 60;
  function loop(now) {
    acc += Math.min(now - last, 100);
    last = now;
    while (acc >= DT) { step(); acc -= DT; }
    draw();
    requestAnimationFrame(loop);
  }

  // ---------- Input ----------
  stage.addEventListener('pointerdown', e => { e.preventDefault(); flap(); });
  document.addEventListener('keydown', e => {
    if (e.repeat) return;
    if (['Space', 'ArrowUp', 'KeyW'].includes(e.code)) { e.preventDefault(); flap(); }
  });
  document.addEventListener('visibilitychange', () => { last = performance.now(); });

  reset();
  showPanel('ready');
  requestAnimationFrame(loop);
})();
