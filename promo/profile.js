const { chromium } = require('/opt/node-tools/node_modules/playwright');
const fs = require('fs');
(async () => {
  const b = await chromium.launch(); const p = await b.newPage();
  await p.goto('http://127.0.0.1:8811/'); await p.waitForTimeout(1200);
  const out = await p.evaluate(async () => {
    await document.fonts.ready;
    const S = 1080, res = {};
    const th = THEMES.ww2, craft = CRAFT_PLAYER[th.planes[0].shape];
    const variants = {
      sunset: { bg: ['#ffb067', '#ff6a2b', '#b8321c'], liv: 0, ring: '#0d111c', streak: 'rgba(255,255,255,.55)' },
      night: { bg: ['#28365a', '#141b30', '#080b14'], liv: 2, ring: '#ff8a3d', streak: 'rgba(255,138,61,.6)' },
      ocean: { bg: ['#52d3e6', '#1d97b8', '#0d4f73'], liv: 0, ring: '#ff8a3d', streak: 'rgba(255,255,255,.6)' },
    };
    for (const [name, v] of Object.entries(variants)) {
      const cv = document.createElement('canvas'); cv.width = cv.height = S; const c = cv.getContext('2d');
      const g = c.createRadialGradient(S * .42, S * .38, 20, S / 2, S / 2, S * .62);
      g.addColorStop(0, v.bg[0]); g.addColorStop(.55, v.bg[1]); g.addColorStop(1, v.bg[2]);
      c.fillStyle = g; c.fillRect(0, 0, S, S);
      // speed lines sweeping behind the plane (bottom-left to top-right)
      const a = -Math.PI / 4;
      c.save(); c.translate(S / 2 + 18, S / 2 + 22); c.rotate(a);
      c.lineCap = 'round';
      [[-250, -175, 15], [-360, -95, 10], [-300, 95, 10], [-420, 175, 15], [-470, 0, 8]].forEach(([x, y, w]) => {
        const gr = c.createLinearGradient(x - 330, 0, x, 0); gr.addColorStop(0, 'rgba(255,255,255,0)'); gr.addColorStop(1, v.streak);
        c.strokeStyle = gr; c.lineWidth = w; c.beginPath(); c.moveTo(x - 330, y); c.lineTo(x, y); c.stroke();
      });
      // twin tracer streams ahead
      c.strokeStyle = '#fff0b0'; c.lineWidth = 11;
      for (const sd of [-1, 1]) for (let k = 0; k < 2; k++) { const x = 300 + k * 95; c.beginPath(); c.moveTo(x, sd * 62); c.lineTo(x + 50, sd * 62); c.stroke(); }
      // drop shadow then plane
      c.save(); c.translate(22, 38); drawCraft(c, craft, null, 11, { shadow: 'rgba(0,0,0,.28)' }); c.restore();
      drawCraft(c, craft, colorsFor(th, 'player', v.liv), 11, { roll: 0, spin: 20, t: 0 });
      c.restore();
      // circular frame ring (visible after the platform's round crop)
      c.lineWidth = 34; c.strokeStyle = v.ring; c.beginPath(); c.arc(S / 2, S / 2, S / 2 - 17, 0, Math.PI * 2); c.stroke();
      res[name] = cv.toDataURL('image/png');
    }
    return res;
  });
  for (const [k, d] of Object.entries(out)) fs.writeFileSync(`pfp-${k}.png`, Buffer.from(d.split(',')[1], 'base64'));
  await b.close();
})();
