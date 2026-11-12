// Generates Android launcher icons + splash from assets/*.svg. Run: node scripts/make_icons.js
const sharp = require(process.env.SHARP_PATH || 'sharp');
const fs = require('fs'), path = require('path');
const res = path.join(__dirname, '..', 'android/app/src/main/res');
const dens = { mdpi: 1, hdpi: 1.5, xhdpi: 2, xxhdpi: 3, xxxhdpi: 4 };
const fg = fs.readFileSync(path.join(__dirname, '../assets/icon-foreground.svg'));
const full = fs.readFileSync(path.join(__dirname, '../assets/icon-full.svg'));
(async () => {
  for (const [d, k] of Object.entries(dens)) {
    const dir = path.join(res, 'mipmap-' + d); fs.mkdirSync(dir, { recursive: true });
    await sharp(fg, { density: 600 }).resize(Math.round(108 * k), Math.round(108 * k)).png().toFile(path.join(dir, 'ic_launcher_foreground.png'));
    const s = Math.round(48 * k);
    await sharp(full, { density: 600 }).resize(s, s).png().toFile(path.join(dir, 'ic_launcher.png'));
    const mask = Buffer.from(`<svg width="${s}" height="${s}"><circle cx="${s / 2}" cy="${s / 2}" r="${s / 2}"/></svg>`);
    await sharp(full, { density: 600 }).resize(s, s).composite([{ input: mask, blend: 'dest-in' }]).png().toFile(path.join(dir, 'ic_launcher_round.png'));
  }
  // splash: every splash.png in drawable* folders is replaced with the warm canvas + centred note
  for (const dir of fs.readdirSync(res).filter(x => x.startsWith('drawable'))) {
    const f = path.join(res, dir, 'splash.png'); if (!fs.existsSync(f)) continue;
    const { width, height } = await sharp(f).metadata();
    const icon = await sharp(fg, { density: 600 }).resize(Math.round(Math.min(width, height) * .42)).png().toBuffer();
    await sharp({ create: { width, height, channels: 4, background: '#12110f' } }).composite([{ input: icon, gravity: 'center' }]).png().toFile(f + '.tmp');
    fs.renameSync(f + '.tmp', f);
  }
  console.log('icons + splash done');
})();
// small monochrome notification icon (white with transparent strokes)
(async () => {
  const svg = fs.readFileSync(path.join(__dirname, '../assets/notif.svg'), 'utf8').replace('stroke="#000"', 'stroke="#000" style="mix-blend-mode:normal"');
  for (const [d, k] of Object.entries({ mdpi: 1, hdpi: 1.5, xhdpi: 2, xxhdpi: 3, xxxhdpi: 4 })) {
    const dir = path.join(res, 'drawable-' + d); fs.mkdirSync(dir, { recursive: true });
    const s = Math.round(24 * k);
    const base = await sharp(Buffer.from(svg), { density: 600 }).resize(s, s).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const px = base.data; for (let i = 0; i < px.length; i += 4) { if (px[i] < 128) px[i + 3] = 0; px[i] = px[i + 1] = px[i + 2] = 255; }
    await sharp(px, { raw: base.info }).png().toFile(path.join(dir, 'ic_stat_notabene.png'));
  }
  console.log('notification icon done');
})();
