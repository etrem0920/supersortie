// Captures the promo's gameplay frames from the real game, plus an event log for the soundtrack.
const { chromium } = require('/opt/node-tools/node_modules/playwright');
const fs = require('fs');
const OUT = process.argv[2];
const FPS = 30;
fs.mkdirSync(`${OUT}/frames`, { recursive: true });

// [theme, seconds, kicker, headline, mode]
const SEGMENTS = [
  { theme: 'ww2', sec: 3.4, kicker: 'Every pilot on Earth', head: 'Same dogfight.<br>Same day.', plane: 1 },
  { theme: 'ww1', sec: 1.6, kicker: '1917', head: 'Western Front', plane: 0, era: true },
  { theme: 'modern', sec: 1.6, kicker: '2026', head: 'Strike Package', plane: 2, era: true },
  { theme: 'space', sec: 1.6, kicker: '2389', head: 'Orbital Front', plane: 1, era: true },
  { theme: 'neon', sec: 1.6, kicker: '1986', head: 'Neon Skies', plane: 0, era: true },
  { theme: 'ww2', sec: 3.4, kicker: 'Wave 5', head: 'Then the ace<br>shows up.', ace: true, plane: 0 },
  { theme: 'modern', sec: 3.6, kicker: 'Up to 4 players', head: 'Squad up<br>in co-op.', coop: true, plane: 0 },
  { theme: 'space', sec: 2.8, kicker: 'Zen mode', head: 'Or fly forever.', plane: 2 },
];

(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 540, height: 960 }, deviceScaleFactor: 2 });
  const p = await ctx.newPage();
  const errs = [];
  p.on('pageerror', e => errs.push(e.message));
  await p.goto('http://127.0.0.1:8811/');
  await p.waitForTimeout(1500);
  await p.evaluate(async () => {
    await document.fonts.ready;
    const st = document.createElement('style');
    st.textContent = `
      #vo{position:fixed;left:0;right:0;top:0;height:42%;pointer-events:none;z-index:99;
        background:linear-gradient(180deg,rgba(6,8,14,.82) 0%,rgba(6,8,14,.55) 55%,rgba(6,8,14,0) 100%)}
      #vo .in{position:absolute;left:30px;right:30px;top:112px;text-align:center;transform-origin:50% 40%}
      #vo .k{font:700 22px 'Barlow Condensed';letter-spacing:.24em;text-transform:uppercase;color:var(--accent);margin-bottom:8px}
      #vo .h{font:900 70px/.9 'Big Shoulders Display';text-transform:uppercase;color:#f3f5fa;letter-spacing:.005em;
        text-shadow:0 4px 0 rgba(0,0,0,.35),0 0 30px rgba(0,0,0,.5)}
      #vo .h.era{font-size:78px}
      #flash{position:fixed;inset:0;background:#fff;opacity:0;pointer-events:none;z-index:100}
      .hud-wave, #hint, #boss, #toasts, #banner{opacity:0 !important} #squad{top:400px !important}`;
    document.head.appendChild(st);
    const vo = document.createElement('div'); vo.id = 'vo'; vo.innerHTML = '<div class="in"><div class="k"></div><div class="h"></div></div>';
    document.body.appendChild(vo);
    const fl = document.createElement('div'); fl.id = 'flash'; document.body.appendChild(fl);

    window.__ev = [];
    const ex = explode; window.explode = explode = function (x, y, s = 1) { __ev.push({ f: __frame, k: 'boom', s }); return ex(x, y, s); };
    window.__frame = 0;

    window.__nearest = (o) => { let best = null, bd = 1e9; for (const e of enemies) { const d = Math.hypot(e.x - o.x, e.y - o.y); if (d < bd) { bd = d; best = e; } } return [best, bd]; };
    window.__bot = () => {
      player.hp = player.maxHp;
      const [e, d] = __nearest(player);
      input.mode = 'pad';
      if (!e) { input.padA = player.a + 0.4; return; }
      const t = d / 1000;
      let aim = Math.atan2(e.y + Math.sin(e.a) * e.spec.speed * t - player.y, e.x + Math.cos(e.a) * e.spec.speed * t - player.x);
      if (d < 110) aim += 1.2;
      input.padA = aim;
      if (player.rollCd <= 0 && missiles.some(m => Math.hypot(m.x - player.x, m.y - player.y) < 170)) tryRoll();
    };
    window.__fakeSquad = () => {
      const names = ['MAVERICK', 'KESTREL', 'NOVA'];
      Coop.peers = {};
      names.forEach((n, i) => {
        const a = player.a + (i - 1) * 0.5, ox = -Math.cos(player.a) * (130 + i * 40) + Math.cos(player.a + Math.PI / 2) * (i - 1) * 170;
        Coop.peers['p' + i] = { id: 'p' + i, name: n, plane: i % 3, livery: i % 3, x: player.x + ox, y: player.y - Math.sin(player.a) * (130 + i * 40) + Math.sin(player.a + Math.PI / 2) * (i - 1) * 170,
          a, tx: 0, ty: 0, ta: a, roll: 0, hp: 3 - (i === 1 ? 1 : 0), mh: 3, seen: true, dead: false, trail: [], fireT: 0 };
        const pr = Coop.peers['p' + i]; pr.tx = pr.x; pr.ty = pr.y;
      });
    };
    window.__peerBot = (dt) => {
      for (const pr of Coop.peerList()) {
        const [e, d] = __nearest(pr);
        const want = e ? Math.atan2(e.y - pr.y, e.x - pr.x) + (d < 120 ? 1.1 : 0) : pr.ta;
        pr.ta = wrapAng(pr.ta + clamp(angDiff(want, pr.ta), -2.6 * dt, 2.6 * dt));
        if (e && d < 420 && Math.abs(angDiff(want, pr.ta)) < 0.25 && Math.random() < dt * 0.9) damageEnemy(e, 1, null);
      }
      Coop.tickPeers(dt);
    };
  });

  let frame = 0;
  const cuts = [];
  for (const [si, s] of SEGMENTS.entries()) {
    cuts.push(frame);
    await p.evaluate((s) => {
      applyTheme(s.theme);
      store.plane[s.theme] = s.plane;
      startRun('zen');
      zoom = s.coop ? 0.8 : 0.95;
      world.mod = Object.assign({}, world.mod, { dmg: 2 });
      run.zen.aceT = 999;
      const mix = s.theme === 'modern' ? ['fighter', 'interceptor', 'interceptor', 'scout', 'bomber'] : ['scout', 'fighter', 'fighter', 'bomber', 'scout'];
      mix.forEach((type, i) => spawnEnemy({ type, ang: player.a + (i - 2) * 0.45, phase: i }));
      for (const e of enemies) { e.x = player.x + (e.x - player.x) * 0.55; e.y = player.y + (e.y - player.y) * 0.55; }
      if (s.ace) { enemies = enemies.slice(0, 3); spawnEnemy({ type: 'ace', ang: player.a + 0.2, phase: 0, hpMul: 0.5 }); }
      if (s.coop) { __fakeSquad(); }
      __frame = -1;
      // warm up so the fight is already underway when the clip starts
      for (let i = 0; i < 60 * (s.era ? 2.2 : 1.6); i++) {
        __bot(); if (s.coop) __peerBot(1 / 60); update(1 / 60); updateCamera(1 / 60);
      }
      __ev = __ev.filter(e => e.f >= 0);
      const vo = document.getElementById('vo');
      vo.querySelector('.k').textContent = s.kicker;
      vo.querySelector('.h').innerHTML = s.head;
      vo.querySelector('.h').className = 'h' + (s.era ? ' era' : '');
      if (s.coop) { Coop.on = true; Coop.renderSquad(); show('squad'); Coop.on = false; }
    }, s);

    const n = Math.round(s.sec * FPS);
    for (let i = 0; i < n; i++) {
      await p.evaluate(({ i, s, frame }) => {
        __frame = frame;
        for (let k = 0; k < 2; k++) {
          __bot(); if (s.coop) __peerBot(1 / 60);
          update(1 / 60); updateCamera(1 / 60);
          if (s.coop) Coop.rBullets = Coop.rBullets.filter(b => (b.life -= 1 / 60) > 0).map(b => (b.x += b.vx / 60, b.y += b.vy / 60, b));
        }
        if (enemies.length < (s.coop ? 7 : 5)) { const tp = ['scout','fighter','fighter','interceptor'][frame % 4]; spawnEnemy({ type: tp, ang: player.a + (Math.random() - 0.5) * 1.6, phase: frame }); }
        Coop.on = !!s.coop;
        draw(); updateHUD(1 / 30); if (s.coop && i % 6 === 0) Coop.renderSquad();
        Coop.on = false;
        const t = i / 30, inn = document.querySelector('#vo .in');
        const pop = Math.min(1, t / 0.22), ease = 1 - Math.pow(1 - pop, 3);
        inn.style.opacity = ease; inn.style.transform = `translateY(${(1 - ease) * -18}px) scale(${1.12 - 0.12 * ease})`;
        document.getElementById('flash').style.opacity = Math.max(0, 0.55 - t * 4.5);
      }, { i, s, frame });
      await p.screenshot({ path: `${OUT}/frames/${String(frame).padStart(5, '0')}.jpg`, type: 'jpeg', quality: 92 });
      frame++;
    }
    console.log('segment', si, s.theme, 'done at frame', frame);
  }

  // End card: the real home screen with the call to action over it
  cuts.push(frame);
  await p.evaluate(() => {
    document.getElementById('vo').remove();
    openMenu(); applyTheme('ww2'); document.getElementById('menu').style.opacity = 0;
    const o = document.createElement('div');
    o.id = 'endcard';
    o.innerHTML = `
      <div style="position:fixed;inset:0;z-index:98;background:radial-gradient(120% 70% at 50% 40%,rgba(9,12,20,.62),rgba(9,12,20,.93));"></div>
      <div id="ecin" style="position:fixed;left:0;right:0;top:150px;z-index:99;text-align:center;color:#eef1f6">
        <div style="font:700 22px 'Barlow Condensed';letter-spacing:.26em;text-transform:uppercase;color:var(--accent)">A new sortie every day</div>
        <div style="font:900 150px/.8 'Big Shoulders Display';text-transform:uppercase;margin-top:18px">Super<br><span style="color:transparent;-webkit-text-stroke:3px #eef1f6">Sortie</span></div>
        <div style="display:flex;gap:8px;justify-content:center;margin-top:34px">${['#38d98a', '#38d98a', '#ffc53d', '#38d98a', '#ff8a3d'].map((c, i) => `<div style="width:52px;height:58px;background:${c};clip-path:polygon(9px 0,100% 0,100% calc(100% - 9px),calc(100% - 9px) 100%,0 100%,0 9px);display:grid;place-items:center;font:900 28px 'Big Shoulders Display';color:#0b0d14">${i + 1}</div>`).join('')}</div>
        <div style="font:600 25px/1.35 Barlow;color:#c3c9d6;margin:30px auto 0;max-width:420px">Free. In your browser.<br>Can you beat today's ace?</div>
        <div style="display:inline-block;margin-top:34px;padding:16px 30px;background:var(--accent);color:var(--accent-ink);font:800 40px 'Big Shoulders Display';letter-spacing:.06em;text-transform:uppercase;clip-path:polygon(12px 0,100% 0,100% calc(100% - 12px),calc(100% - 12px) 100%,0 100%,0 12px)">supersortie.io</div>
      </div>`;
    document.body.appendChild(o);
  });
  await p.waitForTimeout(500);
  const endN = Math.round(3.2 * FPS);
  for (let i = 0; i < endN; i++) {
    await p.evaluate((i) => {
      for (let k = 0; k < 2; k++) { update(1 / 60); updateCamera(1 / 60); }
      draw();
      const t = i / 30, pop = Math.min(1, t / 0.3), ease = 1 - Math.pow(1 - pop, 3);
      const e = document.getElementById('ecin'); e.style.opacity = ease; e.style.transform = `scale(${1.08 - 0.08 * ease})`;
      document.getElementById('flash').style.opacity = Math.max(0, 0.6 - t * 4);
    }, i);
    await p.screenshot({ path: `${OUT}/frames/${String(frame).padStart(5, '0')}.jpg`, type: 'jpeg', quality: 92 });
    frame++;
  }
  const ev = await p.evaluate(() => __ev);
  fs.writeFileSync(`${OUT}/events.json`, JSON.stringify({ fps: FPS, frames: frame, cuts, booms: ev }));
  console.log('frames', frame, 'booms', ev.length, 'errors', errs);
  await b.close();
})();
