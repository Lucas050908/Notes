#!/usr/bin/env python3
"""Builds dist/index.html: one self-contained file (CSS, fonts, JSZip and app JS inlined)."""
import base64, glob, os, sys
root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
src = os.path.join(root, 'src')
html = open(os.path.join(src, 'index.html'), encoding='utf-8').read()
css = open(os.path.join(src, 'styles.css'), encoding='utf-8').read()
fonts = []
fdir = os.path.join(root, 'node_modules/@fontsource/newsreader/files')
for w in (500, 600):
    for sub, rng in (('latin', 'U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD'), ('latin-ext', 'U+0100-02BA,U+02BD-02C5,U+02C7-02CC,U+02CE-02D7,U+02DD-02FF,U+0304,U+0308,U+0329,U+1D00-1DBF,U+1E00-1E9F,U+1EF2-1EFF,U+2020,U+20A0-20AB,U+20AD-20C0,U+2113,U+2C60-2C7F,U+A720-A7FF')):
        b = base64.b64encode(open(f'{fdir}/newsreader-{sub}-{w}-normal.woff2', 'rb').read()).decode()
        fonts.append(f'@font-face{{font-family:"Newsreader";font-style:normal;font-weight:{w};font-display:swap;src:url(data:font/woff2;base64,{b}) format("woff2");unicode-range:{rng};}}')
cdir = os.path.join(root, 'node_modules/@fontsource/caveat/files')
for w in (600, 700):
    for sub, rng in (('latin', 'U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD'), ('latin-ext', 'U+0100-02BA,U+02BD-02C5,U+02C7-02CC,U+02CE-02D7,U+02DD-02FF,U+1E00-1E9F,U+2020,U+20A0-20C0,U+2C60-2C7F,U+A720-A7FF')):
        b = base64.b64encode(open(f'{cdir}/caveat-{sub}-{w}-normal.woff2', 'rb').read()).decode()
        fonts.append(f'@font-face{{font-family:"Caveat";font-style:normal;font-weight:{w};font-display:swap;src:url(data:font/woff2;base64,{b}) format("woff2");unicode-range:{rng};}}')
js = '\n'.join(open(p, encoding='utf-8').read() for p in sorted(glob.glob(os.path.join(src, 'js', '*.js'))))
jszip = open(os.path.join(root, 'node_modules/jszip/dist/jszip.min.js'), encoding='utf-8').read()
out = html.replace('/*FONTS*/', '\n'.join(fonts)).replace('/*CSS*/', css).replace('/*JSZIP*/', jszip).replace('/*JS*/', js)
os.makedirs(os.path.join(root, 'www'), exist_ok=True)
open(os.path.join(root, 'www/index.html'), 'w', encoding='utf-8').write(out)
print('www/index.html', len(out) // 1024, 'KB')
