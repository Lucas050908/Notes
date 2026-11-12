/* ===== 03-md: Markdown <-> note HTML, and HTML sanitizing ===== */

const MD = {
  inline(s) {
    let t = esc(s);
    const codes = [];
    t = t.replace(/`([^`]+)`/g, (_, c) => { codes.push(c); return `\u0000${codes.length - 1}\u0000`; });
    t = t.replace(/\[\[([^\]]+)\]\]/g, (_, title) => {
      const n = findNoteByTitle(title.replace(/&amp;/g, '&'));
      return n ? `<a class="wl" data-note="${n.id}" href="#">${esc(noteTitle(n))}</a>` : `<a class="wl missing" data-title="${title}" href="#">${title}</a>`;
    });
    t = t.replace(/\[([^\]]+)\]\(note:([\w-]+)\)/g, (_, txt, id) => `<a class="wl" data-note="${id}" href="#">${txt}</a>`);
    t = t.replace(/\[([^\]]+)\]\(((?:https?:|mailto:)[^)\s]+)\)/g, (_, txt, url) => `<a href="${url}" target="_blank" rel="noopener">${txt}</a>`);
    t = t.replace(/(^|[\s(])((?:https?:\/\/)[^\s<)]+[^\s<).,!?:;])/g, (_, pre, url) => `${pre}<a href="${url}" target="_blank" rel="noopener">${url}</a>`);
    t = t.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>').replace(/__([^_]+)__/g, '<strong>$1</strong>');
    t = t.replace(/(^|[^*])\*([^*\s][^*]*)\*/g, '$1<em>$2</em>').replace(/(^|\W)_([^_\s][^_]*)_(?=\W|$)/g, '$1<em>$2</em>');
    t = t.replace(/~~([^~]+)~~/g, '<s>$1</s>').replace(/==([^=]+)==/g, '<mark class="hl-yellow">$1</mark>');
    t = t.replace(/\u0000(\d+)\u0000/g, (_, i) => `<code>${codes[+i]}</code>`);
    return t;
  },
  toHtml(md) {
    const lines = String(md || '').replace(/\r\n?/g, '\n').split('\n');
    const out = []; let i = 0;
    const isTableSep = l => /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(l);
    while (i < lines.length) {
      const line = lines[i];
      if (/^\s*```/.test(line)) {
        const buf = []; i++;
        while (i < lines.length && !/^\s*```/.test(lines[i])) buf.push(lines[i++]);
        i++; out.push(`<pre><code>${esc(buf.join('\n'))}</code></pre>`); continue;
      }
      let m;
      if ((m = line.match(/^(#{1,6})\s+(.*)$/))) { const l = Math.min(3, m[1].length); out.push(`<h${l}>${this.inline(m[2])}</h${l}>`); i++; continue; }
      if (/^\s*(---|\*\*\*|___)\s*$/.test(line)) { out.push('<hr>'); i++; continue; }
      if (/^\s*>/.test(line)) {
        const buf = []; while (i < lines.length && /^\s*>/.test(lines[i])) buf.push(lines[i++].replace(/^\s*>\s?/, ''));
        out.push(`<blockquote>${buf.map(b => this.inline(b)).join('<br>')}</blockquote>`); continue;
      }
      if (/\|/.test(line) && i + 1 < lines.length && isTableSep(lines[i + 1])) {
        const cells = l => l.trim().replace(/^\||\|$/g, '').split('|').map(c => this.inline(c.trim()));
        const head = cells(line); i += 2; const rows = [];
        while (i < lines.length && /\|/.test(lines[i]) && lines[i].trim()) rows.push(cells(lines[i++]));
        out.push(`<div class="tw"><table><thead><tr>${head.map(c => `<th>${c}</th>`).join('')}</tr></thead><tbody>${rows.map(r => `<tr>${head.map((_, j) => `<td>${r[j] || ''}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`);
        continue;
      }
      if (/^\s*([-*+]|\d+[.)])\s+/.test(line)) { const r = this.list(lines, i); out.push(r.html); i = r.next; continue; }
      if (!line.trim()) { i++; continue; }
      const buf = [];
      while (i < lines.length && lines[i].trim() && !/^\s*(#{1,6}\s|```|>|([-*+]|\d+[.)])\s+|---\s*$)/.test(lines[i])) buf.push(lines[i++]);
      if (!buf.length) buf.push(lines[i++]);
      out.push(`<p>${buf.map(b => this.inline(b)).join('<br>')}</p>`);
    }
    return out.join('') || '<p></p>';
  },
  list(lines, start) {
    const items = []; let i = start;
    const baseIndent = lines[start].match(/^\s*/)[0].length;
    while (i < lines.length) {
      const l = lines[i]; const m = l.match(/^(\s*)([-*+]|\d+[.)])\s+(.*)$/);
      if (!m) { if (l.trim() && /^\s{2,}/.test(l) && items.length) { items[items.length - 1].text += ' ' + l.trim(); i++; continue; } break; }
      const ind = m[1].length;
      if (ind < baseIndent) break;
      if (ind > baseIndent && items.length) { const r = this.list(lines, i); items[items.length - 1].sub += r.html; i = r.next; continue; }
      items.push({ ordered: /\d/.test(m[2]), text: m[3], sub: '' }); i++;
    }
    const groups = [];
    for (const it of items) {
      const cm = it.text.match(/^\[( |x|X)\]\s*(.*)$/);
      const type = cm ? 'check' : it.ordered ? 'ol' : 'ul';
      if (!groups.length || groups[groups.length - 1].type !== type) groups.push({ type, items: [] });
      groups[groups.length - 1].items.push({ ...it, checked: cm && cm[1] !== ' ', text: cm ? cm[2] : it.text });
    }
    const html = groups.map(g => {
      if (g.type === 'check') return `<ul class="checklist">${g.items.map(it => {
        let text = it.text, due = '';
        const dm = text.match(/\s*(?:@|📅\s*)(\d{4}-\d{2}-\d{2})\s*$/);
        if (dm) { text = text.slice(0, dm.index); due = dueChip(dm[1]); }
        return `<li data-checked="${it.checked}">${this.inline(text)}${due}${it.sub}</li>`;
      }).join('')}</ul>`;
      return `<${g.type}>${g.items.map(it => `<li>${this.inline(it.text)}${it.sub}</li>`).join('')}</${g.type}>`;
    }).join('');
    return { html, next: i };
  },

  fromHtml(html) {
    const t = document.createElement('template'); t.innerHTML = html || '';
    const inl = (node) => {
      let s = '';
      for (const c of node.childNodes) {
        if (c.nodeType === 3) { s += c.textContent.replace(/ /g, ' '); continue; }
        if (c.nodeType !== 1) continue;
        const tag = c.tagName.toLowerCase(), inner = inl(c);
        if (tag === 'strong' || tag === 'b') s += inner.trim() ? `**${inner}**` : inner;
        else if (tag === 'em' || tag === 'i') s += inner.trim() ? `*${inner}*` : inner;
        else if (tag === 's' || tag === 'strike') s += `~~${inner}~~`;
        else if (tag === 'u') s += inner;
        else if (tag === 'mark') s += `==${inner}==`;
        else if (tag === 'code') s += '`' + c.textContent + '`';
        else if (tag === 'br') s += '\n';
        else if (tag === 'a') {
          if (c.dataset.note) { const n = Store.get(c.dataset.note); s += `[[${n ? noteTitle(n) : inner}]]`; }
          else s += `[${inner}](${c.getAttribute('href') || ''})`;
        } else if (tag === 'span' && c.classList.contains('due')) s += ` @${c.dataset.due}`;
        else if (tag === 'img') s += `![billede](${c.dataset.blob ? 'blob:' + c.dataset.blob : ''})`;
        else if (tag === 'ul' || tag === 'ol') { /* handled by block */ }
        else s += inner;
      }
      return s;
    };
    const block = (node, depth = 0) => {
      const out = [];
      for (const c of node.childNodes) {
        if (c.nodeType === 3) { if (c.textContent.trim()) out.push(c.textContent.trim()); continue; }
        if (c.nodeType !== 1) continue;
        const tag = c.tagName.toLowerCase();
        if (/^h[1-6]$/.test(tag)) out.push('#'.repeat(+tag[1]) + ' ' + inl(c).trim());
        else if (tag === 'p' || tag === 'div' && !c.classList.contains('tw') && !c.classList.contains('att')) { const s = inl(c); out.push(s.trim() ? s : ''); }
        else if (tag === 'blockquote') out.push(inl(c).split('\n').map(l => '> ' + l).join('\n'));
        else if (tag === 'pre') out.push('```\n' + c.textContent.replace(/\n$/, '') + '\n```');
        else if (tag === 'hr') out.push('---');
        else if (tag === 'ul' || tag === 'ol') out.push(listMd(c, depth));
        else if (tag === 'div' && c.classList.contains('tw') || tag === 'table') {
          const tb = tag === 'table' ? c : c.querySelector('table'); if (!tb) continue;
          const rows = $$('tr', tb).map(tr => $$('th,td', tr).map(td => inl(td).replace(/\|/g, '\\|').replace(/\n/g, ' ').trim()));
          if (!rows.length) continue;
          const w = Math.max(...rows.map(r => r.length));
          const line = r => '| ' + Array.from({ length: w }, (_, j) => r[j] || '').join(' | ') + ' |';
          out.push([line(rows[0]), '| ' + Array(w).fill('---').join(' | ') + ' |', ...rows.slice(1).map(line)].join('\n'));
        } else if (tag === 'div' && c.classList.contains('att')) out.push(`📎 ${c.dataset.name || 'Vedhæftning'}`);
        else if (tag === 'img') out.push(inl({ childNodes: [c] }));
        else out.push(inl(c));
      }
      return out.join('\n\n');
    };
    const listMd = (list, depth) => {
      const ordered = list.tagName === 'OL', check = list.classList.contains('checklist'); let k = 1;
      return $$(':scope > li', list).map(li => {
        const clone = li.cloneNode(true); const subs = $$(':scope > ul, :scope > ol', clone); subs.forEach(s => s.remove());
        const pad = '  '.repeat(depth);
        const mark = check ? `- [${li.dataset.checked === 'true' ? 'x' : ' '}] ` : ordered ? `${k++}. ` : '- ';
        let s = pad + mark + inl(clone).trim();
        for (const sub of $$(':scope > ul, :scope > ol', li)) s += '\n' + listMd(sub, depth + 1);
        return s;
      }).join('\n');
    };
    return block(t.content).replace(/\n{3,}/g, '\n\n').trim();
  },
};

function dueChip(d) { return `<span class="due ${dueClass(d)}" contenteditable="false" data-due="${d}">${esc(fmtDue(d))}</span>`; }
function findNoteByTitle(title) {
  const t = norm(title).trim(); if (!t) return null;
  for (const n of Store.active()) if (norm(noteTitle(n)).trim() === t) return n;
  return null;
}

/* ----- Sanitizer: everything that enters a note (paste, import, AI) passes through here ----- */
const SAFE_TAGS = new Set(['p', 'br', 'h1', 'h2', 'h3', 'ul', 'ol', 'li', 'blockquote', 'pre', 'code', 'strong', 'b', 'em', 'i', 'u', 's', 'strike', 'a', 'img', 'table', 'thead', 'tbody', 'tr', 'th', 'td', 'span', 'mark', 'div', 'hr']);
const SAFE_CLASS = /^(checklist|hl-(yellow|green|blue|pink|orange)|c-(red|orange|green|blue|purple|gray)|wl|missing|due|over|today|att|tw)$/;
function sanitizeHtml(html, { keepDataImages = true } = {}) {
  const t = document.createElement('template'); t.innerHTML = html;
  const walk = (node) => {
    for (const c of [...node.childNodes]) {
      if (c.nodeType === 8) { c.remove(); continue; }
      if (c.nodeType !== 1) continue;
      let tag = c.tagName.toLowerCase();
      if (['script', 'style', 'iframe', 'object', 'embed', 'meta', 'link', 'title', 'head', 'svg', 'canvas', 'video', 'audio', 'form', 'input', 'button', 'select', 'textarea', 'noscript'].includes(tag)) { c.remove(); continue; }
      if (/^h[4-6]$/.test(tag)) { const n = document.createElement('h3'); n.append(...c.childNodes); c.replaceWith(n); walk(n); continue; }
      if (!SAFE_TAGS.has(tag)) {
        const block = /^(section|article|header|footer|main|aside|nav|figure|figcaption|dl|dt|dd|address)$/.test(tag);
        const frag = document.createDocumentFragment(); frag.append(...c.childNodes);
        if (block) { const p = document.createElement('div'); p.append(frag); c.replaceWith(p); walk(p); }
        else { const kids = [...frag.childNodes]; c.replaceWith(frag); kids.forEach(k => k.nodeType === 1 && walk({ childNodes: [k] })); }
        continue;
      }
      const style = c.getAttribute('style') || '';
      const keep = {};
      for (const a of [...c.attributes]) {
        const n = a.name.toLowerCase(), v = a.value;
        if (n === 'href' && tag === 'a' && /^(https?:|mailto:|#)/i.test(v.trim())) keep.href = v.trim();
        else if (/^data-(note|checked|blob|due|name|size|type|title)$/.test(n)) keep[n] = v;
        else if (n === 'class') { const cls = v.split(/\s+/).filter(x => SAFE_CLASS.test(x)).join(' '); if (cls) keep.class = cls; }
        else if ((n === 'colspan' || n === 'rowspan') && /^\d+$/.test(v)) keep[n] = v;
        else if (n === 'src' && tag === 'img' && keepDataImages && /^data:image\//.test(v)) keep.src = v;
      }
      for (const a of [...c.attributes]) c.removeAttribute(a.name);
      for (const k in keep) c.setAttribute(k, keep[k]);
      if (tag === 'a' && keep.href && !/^#/.test(keep.href)) { c.setAttribute('target', '_blank'); c.setAttribute('rel', 'noopener'); }
      if ((c.classList.contains('due') || c.classList.contains('att'))) c.setAttribute('contenteditable', 'false');
      if (tag === 'img' && !keep.src && !keep['data-blob']) { c.remove(); continue; }
      if (tag === 'span' && !c.attributes.length) {
        let wrap = null;
        if (/font-weight:\s*(bold|[6-9]00)/i.test(style)) wrap = 'strong';
        else if (/font-style:\s*italic/i.test(style)) wrap = 'em';
        else if (/text-decoration[^;]*underline/i.test(style)) wrap = 'u';
        if (wrap) { const w = document.createElement(wrap); w.append(...c.childNodes); c.replaceWith(w); walk(w); continue; }
        const frag = document.createDocumentFragment(); const kids = [...c.childNodes]; frag.append(...kids); c.replaceWith(frag);
        kids.forEach(k => k.nodeType === 1 && walk({ childNodes: [k] })); continue;
      }
      if (tag === 'div' && !c.classList.contains('att') && !c.classList.contains('tw')) {
        const hasBlock = [...c.children].some(k => /^(P|DIV|H[1-6]|UL|OL|BLOCKQUOTE|PRE|TABLE|HR)$/.test(k.tagName));
        if (!hasBlock) { const p = document.createElement('p'); p.append(...c.childNodes); c.replaceWith(p); walk(p); continue; }
      }
      walk(c);
    }
  };
  walk(t.content);
  // Unwrap plain block divs into their children so the top level stays a flat list of blocks.
  for (const d of $$('div:not(.att):not(.tw)', t.content)) { const f = document.createDocumentFragment(); f.append(...d.childNodes); d.replaceWith(f); }
  // Wrap tables for horizontal scroll.
  for (const tb of $$('table', t.content)) if (!tb.parentElement || !tb.parentElement.classList.contains('tw')) { const w = document.createElement('div'); w.className = 'tw'; tb.replaceWith(w); w.append(tb); }
  // Bare text at the top level becomes paragraphs.
  const frag = t.content; let p = null;
  for (const c of [...frag.childNodes]) {
    const inline = c.nodeType === 3 ? !!c.textContent.trim() : (c.nodeType === 1 && /^(A|STRONG|B|EM|I|U|S|SPAN|MARK|CODE|BR|IMG)$/.test(c.tagName));
    if (inline) { if (!p) { p = document.createElement('p'); c.before(p); } p.append(c); }
    else { p = null; if (c.nodeType === 3) c.remove(); }
  }
  return t.innerHTML;
}
