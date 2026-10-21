// Captures a promo video's frames from the real game, plus an event log for the soundtrack.
// Usage: node promo/capture.js <out-dir> promo/videos/<name>.json   (site served on 127.0.0.1:8811)
const { chromium } = require('/opt/node-tools/node_modules/playwright');
const fs = require('fs');
const OUT = process.argv[2];
const CFG = JSON.parse(fs.readFileSync(process.argv[3], 'utf8'));
const FPS = 30;
fs.mkdirSync(`${OUT}/frames`, { recursive: true });

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
      #vo .s{font:700 27px 'Barlow Condensed';letter-spacing:.08em;text-transform:uppercase;color:#f3f5fa;margin-top:14px;
        display:inline-block;padding:6px 14px;background:rgba(6,8,14,.55);border-left:4px solid var(--accent)}
      #vo .s:empty{display:none}
      #flash{position:fixed;inset:0;background:#fff;opacity:0;pointer-events:none;z-index:100}
      .hud-wave, #hint, #toasts, #banner{opacity:0 !important} #squad{top:400px !important}
      #boss{top:385px !important} .hud *{transition:none !important} body:not(.showboss) #boss{opacity:0 !important}`;
    document.head.appendChild(st);
    const vo = document.createElement('div'); vo.id = 'vo'; vo.innerHTML = '<div class="in"><div class="k"></div><div class="h"></div><div><span class="s"></span></div></div>';
    document.body.appendChild(vo);
    const fl = document.createElement('div'); fl.id = 'flash'; document.body.appendChild(fl);

    window.__ev = [];
    const ex = explode; window.explode = explode = function (x, y, s = 1) { __ev.push({ f: __frame, k: 'boom', s }); return ex(x, y, s); };
    window.__frame = 0;
    window.__popT = 0; window.__subT = 0; window.__aceLock = false; window.__killT = null;
    const de = damageEnemy; window.damageEnemy = damageEnemy = function (e, n, by) { if (__aceLock && e.type === 'ace') { e.flash = 0.07; return; } return de(e, n, by); };

    window.__nearest = (o, pref) => {
      let best = null, bd = 1e9;
      const pool = pref && enemies.some(e => e.type === pref) ? enemies.filter(e => e.type === pref) : enemies;
      for (const e of pool) { const d = Math.hypot(e.x - o.x, e.y - o.y); if (d < bd) { bd = d; best = e; } }
      return [best, bd];
    };
    window.__bot = (pref, cruise) => {
      player.hp = player.maxHp;
      input.mode = 'pad';
      if (cruise) { input.padA = player.a + Math.sin(__frame / 40) * 0.5; return; }
      const [e, d] = __nearest(player, pref);
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
        const a = player.a + (i - 1) * 0.5;
        const back = 130 + i * 40, side = (i - 1) * 170;
        const x = player.x - Math.cos(player.a) * back + Math.cos(player.a + Math.PI / 2) * side;
        const y = player.y - Math.sin(player.a) * back + Math.sin(player.a + Math.PI / 2) * side;
        Coop.peers['p' + i] = { id: 'p' + i, name: n, plane: i % 3, livery: i % 3, x, y, tx: x, ty: y, a, ta: a, roll: 0,
          hp: 3 - (i === 1 ? 1 : 0), mh: 3, seen: true, dead: false, trail: [], fireT: 0 };
      });
    };
    window.__peerBot = (dt) => {
      for (const pr of Coop.peerList()) {
        if (pr.dead) continue;
        const [e, d] = __nearest(pr);
        let want = e ? Math.atan2(e.y - pr.y, e.x - pr.x) + (d < 120 ? 1.1 : 0) : pr.ta;
        // stay in formation: wingmen who stray off screen head back toward the leader
        if (Math.hypot(player.x - pr.x, player.y - pr.y) > 300 || (e && Math.hypot(e.x - player.x, e.y - player.y) > 450)) want = Math.atan2(player.y - pr.y, player.x - pr.x);
        pr.ta = wrapAng(pr.ta + clamp(angDiff(want, pr.ta), -2.6 * dt, 2.6 * dt));
        if (e && d < 420 && Math.abs(angDiff(want, pr.ta)) < 0.25 && Math.random() < dt * 0.9) damageEnemy(e, 1, null);
      }
      Coop.tickPeers(dt);
    };
    window.__setCap = (c, pop) => {
      const vo = document.getElementById('vo');
      if ('kicker' in c) vo.querySelector('.k').textContent = c.kicker;
      if ('head' in c) { vo.querySelector('.h').innerHTML = c.head; vo.querySelector('.h').className = 'h' + (c.era ? ' era' : ''); }
      if ('sub' in c) { vo.querySelector('.s').textContent = c.sub || ''; __subT = 0; }
      if (pop) __popT = 0;
    };
  });

  let frame = 0;
  const cuts = [];
  for (const [si, s] of CFG.segments.entries()) {
    if (!s.keep) cuts.push(frame);
    await p.evaluate((s) => {
      applyTheme(s.theme);
      store.plane[s.theme] = s.plane || 0;
      store.livery = store.livery || {}; if (s.livery != null) store.livery[s.theme] = s.livery;
      startRun('zen');
      zoom = s.zoom || (s.coop ? 0.8 : 0.95);
      world.mod = Object.assign({}, world.mod, { dmg: 2 });
      run.zen.aceT = 999;
      const mix = s.mix || (s.theme === 'modern' ? ['fighter', 'interceptor', 'interceptor', 'scout', 'bomber'] : ['scout', 'fighter', 'fighter', 'bomber', 'scout']);
      mix.forEach((type, i) => spawnEnemy({ type, ang: player.a + (i - 2) * 0.45, phase: i }));
      for (const e of enemies) { e.x = player.x + (e.x - player.x) * 0.55; e.y = player.y + (e.y - player.y) * 0.55; }
      if (s.ace) { spawnEnemy({ type: 'ace', ang: player.a + 0.2, phase: 0 }); const a = enemies[enemies.length - 1]; a.x = player.x + (a.x - player.x) * 0.6; a.y = player.y + (a.y - player.y) * 0.6; }
      if (s.coop) __fakeSquad();
      __frame = -1;
      // warm up so the fight is already underway when the clip starts
      for (let i = 0; i < 60 * (s.warm || 1.6); i++) {
        __bot(s.ace ? 'ace' : null, s.cruise); if (s.coop) __peerBot(1 / 60); update(1 / 60); updateCamera(1 / 60);
        const ace = enemies.find(e => e.type === 'ace'); if (ace) ace.hp = ace.maxHp;
      }
      __ev = __ev.filter(e => e.f >= 0); __killT = null; __aceLock = false;
      if (!s.keep) __setCap({ kicker: s.kicker, head: s.head, era: s.era, sub: s.sub || '' }, true);
      else __setCap({ sub: s.sub || '' }, false);
      document.body.classList.toggle('showboss', !!s.boss);
      if (s.coop) { Coop.on = true; Coop.renderSquad(); show('squad'); Coop.on = false; }
    }, s);

    const n = Math.round(s.sec * FPS);
    for (let i = 0; i < n; i++) {
      await p.evaluate(({ i, s, frame }) => {
        __frame = frame;
        const t = i / 30;
        for (const c of s.caps || []) if (c.t !== 'kill' && Math.round(c.t * 30) === i) __setCap(c, c.pop !== false);
        let rate = 1;
        for (const [a, z, r] of s.rate || []) if (t >= a && t < z) rate = r;
        if (__killT != null && t - __killT < 1.3) rate = 0.3;
        const ace = enemies.find(e => e.type === 'ace');
        if (ace && s.killAt != null) {
          // the ace's armor wears down on a script, then breaks on camera once killAt has passed
          __aceLock = true;
          ace.hp = Math.max(2, Math.round(ace.maxHp * (1 - 0.88 * Math.min(1, t / s.killAt))));
          if (t >= s.killAt && Math.hypot(ace.x - player.x, ace.y - player.y) < 380) {
            __aceLock = false; ace.hp = 1; damageEnemy(ace, 1); __killT = t;
            for (const c of s.caps || []) if (c.t === 'kill') __setCap(c, true);
          }
        }
        if (s.missileAt != null && Math.round(s.missileAt * 30) === i) {
          const src = enemies.find(e => e.type === 'ace') || enemies[0];
          if (src) launchMissile(src);
        }
        if (s.coop && s.downAt != null && Math.round(s.downAt * 30) === i) {
          const pr = Coop.peers.p1; pr.dead = true; pr.hp = 0; explode(pr.x, pr.y, 1.4);
        }
        if (s.coop && s.reviveAt != null && Math.round(s.reviveAt * 30) === i) {
          const pr = Coop.peers.p1; pr.dead = false; pr.hp = 3; pr.trail = [];
          pr.x = pr.tx = player.x - Math.cos(player.a) * 120 + 90; pr.y = pr.ty = player.y - Math.sin(player.a) * 120 - 60; pr.ta = pr.a = player.a;
          floater(pr.x, pr.y - 40, 'REVIVED', '#38d98a', 1.4);
        }
        const steps = 2, dt = (1 / 60) * rate;
        for (let k = 0; k < steps; k++) {
          __bot(s.ace ? 'ace' : null, s.cruise); if (s.coop) __peerBot(dt);
          update(dt); updateCamera(dt);
          if (s.coop) Coop.rBullets = Coop.rBullets.filter(b => (b.life -= dt) > 0).map(b => (b.x += b.vx * dt, b.y += b.vy * dt, b));
        }
        const maxE = s.maxEnemies || (s.coop ? 7 : 5);
        if (enemies.length < maxE) { const tp = (s.refill || ['scout', 'fighter', 'fighter', 'interceptor'])[frame % (s.refill || [1, 2, 3, 4]).length]; spawnEnemy({ type: tp, ang: player.a + (Math.random() - 0.5) * 1.6, phase: frame }); }
        Coop.on = !!s.coop;
        draw(); updateHUD(1 / 30); if (s.coop && i % 6 === 0) Coop.renderSquad();
        Coop.on = false;
        __popT += 1 / 30; __subT += 1 / 30;
        const inn = document.querySelector('#vo .in'), sub = document.querySelector('#vo .s');
        const e1 = 1 - Math.pow(1 - Math.min(1, __popT / 0.22), 3), e2 = 1 - Math.pow(1 - Math.min(1, __subT / 0.18), 3);
        inn.style.opacity = e1; inn.style.transform = `translateY(${(1 - e1) * -18}px) scale(${1.12 - 0.12 * e1})`;
        sub.style.opacity = e2; sub.style.transform = `translateX(${(1 - e2) * -24}px)`;
        document.getElementById('flash').style.opacity = s.keep ? 0 : Math.max(0, 0.55 - t * 4.5);
      }, { i, s, frame });
      await p.screenshot({ path: `${OUT}/frames/${String(frame).padStart(5, '0')}.jpg`, type: 'jpeg', quality: 92 });
      frame++;
    }
    console.log('segment', si, s.theme, 'done at frame', frame);
  }

  // End card over the live sky
  const E = Object.assign({ kicker: 'A new sortie every day', line: "Free. In your browser.<br>Can you beat today's ace?", cta: 'supersortie.io', theme: 'ww2', sec: 3.2 }, CFG.end || {});
  cuts.push(frame);
  await p.evaluate((E) => {
    document.getElementById('vo').remove();
    document.body.classList.remove('showboss');
    openMenu(); applyTheme(E.theme); document.getElementById('menu').style.opacity = 0;
    const o = document.createElement('div');
    o.innerHTML = `
      <div style="position:fixed;inset:0;z-index:98;background:radial-gradient(120% 70% at 50% 40%,rgba(9,12,20,.62),rgba(9,12,20,.93));"></div>
      <div id="ecin" style="position:fixed;left:0;right:0;top:150px;z-index:99;text-align:center;color:#eef1f6">
        <div style="font:700 22px 'Barlow Condensed';letter-spacing:.26em;text-transform:uppercase;color:var(--accent)">${E.kicker}</div>
        <div style="font:900 150px/.8 'Big Shoulders Display';text-transform:uppercase;margin-top:18px">Super<br><span style="color:transparent;-webkit-text-stroke:3px #eef1f6">Sortie</span></div>
        <div style="display:flex;gap:8px;justify-content:center;margin-top:34px">${['#38d98a', '#38d98a', '#ffc53d', '#38d98a', '#ff8a3d'].map((c, i) => `<div style="width:52px;height:58px;background:${c};clip-path:polygon(9px 0,100% 0,100% calc(100% - 9px),calc(100% - 9px) 100%,0 100%,0 9px);display:grid;place-items:center;font:900 28px 'Big Shoulders Display';color:#0b0d14">${i + 1}</div>`).join('')}</div>
        <div style="font:600 25px/1.35 Barlow;color:#c3c9d6;margin:30px auto 0;max-width:440px">${E.line}</div>
        <div style="display:inline-block;margin-top:34px;padding:16px 30px;background:var(--accent);color:var(--accent-ink);font:800 40px 'Big Shoulders Display';letter-spacing:.06em;text-transform:uppercase;clip-path:polygon(12px 0,100% 0,100% calc(100% - 12px),calc(100% - 12px) 100%,0 100%,0 12px)">${E.cta}</div>
      </div>`;
    document.body.appendChild(o);
  }, E);
  await p.waitForTimeout(500);
  const endN = Math.round(E.sec * FPS);
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
  fs.writeFileSync(`${OUT}/events.json`, JSON.stringify({ fps: FPS, frames: frame, cuts, booms: ev, music: CFG.music || {} }));
  console.log('frames', frame, 'booms', ev.length, 'errors', errs);
  await b.close();
})();
