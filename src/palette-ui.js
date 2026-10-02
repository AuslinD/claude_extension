// Color chooser shared by the in-page picker and the toolbar popup:
// 57 named swatches (19 colors x light/normal/dark), your recent colors, and any custom color.
(function (root) {
  'use strict';

  function buildPalette(doc, { selected, recent = [], onPick, onPreview }) {
    const Colors = root.CCC.colors;
    const sel = (selected || '').toLowerCase();
    const wrap = doc.createElement('div');
    wrap.className = 'ccc-palette';

    const nameLine = doc.createElement('div');
    nameLine.className = 'ccc-pal-name';
    const showName = (hex) => { nameLine.textContent = hex ? `${Colors.nameFor(hex)}  ${hex}` : ''; };
    showName(sel);

    function swatch(hex, name) {
      const b = doc.createElement('button');
      b.type = 'button';
      b.className = 'ccc-pal-swatch' + (hex === sel ? ' ccc-selected' : '');
      b.style.background = hex;
      b.title = `${name} (${hex})`;
      b.setAttribute('aria-label', name);
      b.addEventListener('mouseenter', () => showName(hex));
      b.addEventListener('mouseleave', () => showName(sel));
      b.addEventListener('click', (e) => {
        e.stopPropagation();
        onPick(hex);
      });
      return b;
    }

    const grid = doc.createElement('div');
    grid.className = 'ccc-pal-grid';
    grid.style.gridTemplateColumns = `repeat(${Colors.FAMILIES.length}, 1fr)`;
    for (const s of Colors.SWATCHES) grid.appendChild(swatch(s.hex, s.name));
    wrap.appendChild(grid);

    const recentClean = recent.filter(Colors.isHex).slice(0, 10);
    if (recentClean.length) {
      const label = doc.createElement('div');
      label.className = 'ccc-pal-label';
      label.textContent = 'Recent';
      wrap.appendChild(label);
      const row = doc.createElement('div');
      row.className = 'ccc-pal-row';
      for (const hex of recentClean) row.appendChild(swatch(hex, Colors.nameFor(hex)));
      wrap.appendChild(row);
    }

    const custom = doc.createElement('div');
    custom.className = 'ccc-pal-row ccc-pal-custom';
    const input = doc.createElement('input');
    input.type = 'color';
    input.value = Colors.isHex(sel) ? sel : '#3b82f6';
    input.title = 'Any color';
    input.addEventListener('input', () => {
      showName(input.value);
      text.value = input.value;
      if (onPreview) onPreview(input.value);
    });
    input.addEventListener('change', () => onPick(input.value));
    const text = doc.createElement('input');
    text.type = 'text';
    text.placeholder = '#hex';
    text.value = Colors.isHex(sel) ? sel : '';
    text.maxLength = 7;
    text.spellcheck = false;
    const applyText = () => {
      let v = text.value.trim();
      if (/^[0-9a-f]{6}$/i.test(v)) v = '#' + v;
      if (Colors.isHex(v)) onPick(v.toLowerCase());
      else text.classList.add('ccc-invalid');
    };
    text.addEventListener('input', () => text.classList.remove('ccc-invalid'));
    text.addEventListener('keydown', (e) => {
      e.stopPropagation(); // keep claude.ai's shortcuts from stealing keystrokes
      if (e.key === 'Enter') applyText();
    });
    const lbl = doc.createElement('span');
    lbl.className = 'ccc-pal-label';
    lbl.textContent = 'Custom:';
    custom.append(lbl, input, text);
    wrap.appendChild(custom);
    wrap.appendChild(nameLine);
    return wrap;
  }

  root.CCC = root.CCC || {};
  root.CCC.paletteUI = { buildPalette };
})(typeof globalThis !== 'undefined' ? globalThis : this);
