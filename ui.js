// Piezas de interfaz reutilizables: ventanas desde abajo (hojas) con
// formularios, confirmaciones, avisos y gráficos.
(function () {
  'use strict';
  var CG = window.CG;

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }

  function button(className, text, onClick) {
    var b = el('button', className, text);
    b.type = 'button';
    if (onClick) b.addEventListener('click', onClick);
    return b;
  }

  // ---------- Hojas ----------
  function openDialog(dialog) {
    if (dialog.open) return;
    if (typeof dialog.showModal === 'function') dialog.showModal();
    else dialog.setAttribute('open', '');
  }

  function closeDialog(dialog) {
    if (typeof dialog.close === 'function') dialog.close();
    else dialog.removeAttribute('open');
  }

  // Cerrar al tocar fuera de la hoja y con los botones [data-close].
  function wireDialog(dialog) {
    dialog.addEventListener('click', function (e) {
      if (e.target === dialog && !dialog.hasAttribute('data-sticky')) closeDialog(dialog);
    });
    dialog.addEventListener('click', function (e) {
      if (e.target.closest && e.target.closest('[data-close]')) closeDialog(dialog);
    });
  }

  var sheet = null;
  function getSheet() {
    if (!sheet) {
      sheet = document.getElementById('sheet');
      wireDialog(sheet);
    }
    return sheet;
  }

  function sheetHead(title) {
    var head = el('div', 'sheet-head');
    head.appendChild(el('h2', null, title));
    var x = button('icon-btn small', '✕');
    x.setAttribute('data-close', '');
    x.setAttribute('aria-label', 'Cerrar');
    head.appendChild(x);
    return head;
  }

  // Abre una hoja con contenido libre. build(body, close) arma el contenido.
  function openSheet(title, build, opts) {
    var d = getSheet();
    d.innerHTML = '';
    if (opts && opts.sticky) d.setAttribute('data-sticky', ''); else d.removeAttribute('data-sticky');
    d.appendChild(sheetHead(title));
    var body = el('div', 'sheet-body');
    d.appendChild(body);
    build(body, function () { closeDialog(d); });
    openDialog(d);
    return d;
  }

  // ---------- Formularios ----------
  // fields: [{ name, type, label, value, ... }]
  //   type: text | money | date | month | day | select | segmented | icon | color | checkbox | note
  //   showIf(values) -> bool   (se evalúa al cambiar cualquier campo)
  // opts: { title, fields, submitLabel, onSubmit(values) -> mensaje de error | undefined,
  //         deleteLabel, onDelete(), extra(body) }
  function openForm(opts) {
    return openSheet(opts.title, function (body, close) {
      var form = el('form', 'form');
      form.noValidate = true;
      form.autocomplete = 'off';
      var controls = {};
      var wrappers = {};

      opts.fields.forEach(function (f) {
        var wrap = buildField(f, controls);
        wrappers[f.name || ('_' + Math.random())] = { el: wrap, field: f };
        form.appendChild(wrap);
      });

      var error = el('p', 'form-error');
      error.setAttribute('role', 'alert');
      error.hidden = true;
      form.appendChild(error);

      var actions = el('div', 'sheet-actions');
      if (opts.onDelete) {
        actions.appendChild(button('btn danger ghost', opts.deleteLabel || 'Borrar', function () {
          close();
          opts.onDelete();
        }));
      }
      var submit = el('button', 'btn primary', opts.submitLabel || 'Guardar');
      submit.type = 'submit';
      actions.appendChild(submit);
      form.appendChild(actions);

      function values() {
        var v = {};
        Object.keys(controls).forEach(function (k) { v[k] = controls[k].get(); });
        return v;
      }

      function refresh() {
        var v = values();
        Object.keys(wrappers).forEach(function (k) {
          var w = wrappers[k];
          if (w.field.showIf) w.el.hidden = !w.field.showIf(v);
          if (w.field.update) w.field.update(w.el, v);
        });
      }

      form.addEventListener('input', refresh);
      form.addEventListener('change', refresh);
      form.addEventListener('submit', function (e) {
        e.preventDefault();
        var v = values();
        // Los campos ocultos no cuentan.
        Object.keys(wrappers).forEach(function (k) {
          if (wrappers[k].el.hidden && wrappers[k].field.name) delete v[wrappers[k].field.name];
        });
        var msg = opts.onSubmit(v);
        if (msg) {
          error.textContent = msg;
          error.hidden = false;
          return;
        }
        close();
      });

      body.appendChild(form);
      if (opts.extra) opts.extra(body);
      refresh();
      var first = form.querySelector('input[type=text]:not([hidden]), input[inputmode=decimal]');
      if (first && opts.autofocus !== false) setTimeout(function () { first.focus(); }, 50);
    });
  }

  function labeled(f, input) {
    var wrap = el('label', 'field');
    wrap.appendChild(el('span', null, f.label));
    wrap.appendChild(input);
    if (f.hint) wrap.appendChild(el('small', 'hint', f.hint));
    return wrap;
  }

  function buildField(f, controls) {
    var input, wrap;
    switch (f.type) {
      case 'note':
        wrap = el('p', 'form-note', f.text);
        return wrap;

      case 'money':
        input = el('input');
        input.type = 'text';
        input.inputMode = 'decimal';
        input.placeholder = f.placeholder || '0,00';
        input.value = f.value ? (f.value < 0 ? '-' : '') + CG.centsToInput(Math.abs(f.value)) : '';
        controls[f.name] = {
          get: function () {
            var s = input.value.trim();
            if (!s) return f.optional ? 0 : NaN;
            var neg = f.allowNegative && /^-/.test(s);
            var v = CG.parseAmount(s.replace(/^-/, ''));
            return neg ? -v : v;
          }
        };
        return labeled(f, input);

      case 'text':
      case 'date':
      case 'month':
        input = el('input');
        input.type = f.type;
        if (f.max) input.maxLength = f.max;
        if (f.placeholder) input.placeholder = f.placeholder;
        input.value = f.value || '';
        controls[f.name] = { get: function () { return input.value.trim(); } };
        return labeled(f, input);

      case 'day':
        input = el('select');
        for (var d = 1; d <= 31; d++) {
          var o = el('option', null, d === 31 ? '31 (o último día)' : String(d));
          o.value = d;
          input.appendChild(o);
        }
        input.value = String(f.value || 1);
        controls[f.name] = { get: function () { return parseInt(input.value, 10); } };
        return labeled(f, input);

      case 'select':
        input = el('select');
        f.options.forEach(function (opt) {
          var o = el('option', null, opt.label);
          o.value = opt.value;
          input.appendChild(o);
        });
        if (f.value != null) input.value = f.value;
        controls[f.name] = { get: function () { return input.value; } };
        wrap = labeled(f, input);
        // Permite cambiar las opciones según otros campos.
        if (f.optionsFor) {
          f.update = function (w, v) {
            var sel = w.querySelector('select');
            var opts = f.optionsFor(v);
            var key = opts.map(function (o) { return o.value; }).join('|');
            if (sel.getAttribute('data-key') === key) return;
            var cur = sel.value;
            sel.innerHTML = '';
            opts.forEach(function (opt) {
              var o = el('option', null, opt.label);
              o.value = opt.value;
              sel.appendChild(o);
            });
            sel.setAttribute('data-key', key);
            if (opts.some(function (o) { return o.value === cur; })) sel.value = cur;
          };
        }
        return wrap;

      case 'segmented':
        wrap = el('div', 'field');
        if (f.label) wrap.appendChild(el('span', null, f.label));
        var seg = el('div', 'segmented' + (f.className ? ' ' + f.className : ''));
        seg.setAttribute('role', 'radiogroup');
        var name = 'seg-' + f.name + '-' + Math.random().toString(36).slice(2, 6);
        f.options.forEach(function (opt) {
          var lab = el('label', 'seg-option');
          var r = el('input');
          r.type = 'radio';
          r.name = name;
          r.value = opt.value;
          if (opt.value === f.value) r.checked = true;
          lab.appendChild(r);
          lab.appendChild(el('span', opt.className || null, opt.label));
          seg.appendChild(lab);
        });
        if (!seg.querySelector('input:checked')) seg.querySelector('input').checked = true;
        wrap.appendChild(seg);
        controls[f.name] = { get: function () { var c = seg.querySelector('input:checked'); return c ? c.value : null; } };
        return wrap;

      case 'icon':
        return iconPicker(f, controls);

      case 'color':
        return colorPicker(f, controls);

      case 'checkbox':
        wrap = el('label', 'check');
        input = el('input');
        input.type = 'checkbox';
        input.checked = !!f.value;
        wrap.appendChild(input);
        wrap.appendChild(el('span', null, f.label));
        controls[f.name] = { get: function () { return input.checked; } };
        return wrap;
    }
    throw new Error('Tipo de campo desconocido: ' + f.type);
  }

  function iconPicker(f, controls) {
    var wrap = el('div', 'field');
    wrap.appendChild(el('span', null, f.label || 'Ícono'));
    var grid = el('div', 'icon-grid');
    var current = f.value || CG.ICONS[0];
    var custom = el('input', 'icon-custom');
    custom.type = 'text';
    custom.maxLength = 4;
    custom.placeholder = 'Otro';
    custom.setAttribute('aria-label', 'Escribe otro emoji');
    function select(icon) {
      current = icon;
      Array.prototype.forEach.call(grid.querySelectorAll('.icon-opt'), function (b) {
        b.classList.toggle('active', b.textContent === icon);
        b.setAttribute('aria-pressed', b.textContent === icon ? 'true' : 'false');
      });
    }
    var icons = CG.ICONS.slice();
    if (icons.indexOf(current) === -1) icons.unshift(current);
    icons.forEach(function (ic) {
      var b = button('icon-opt', ic, function () { select(ic); custom.value = ''; });
      grid.appendChild(b);
    });
    custom.addEventListener('input', function () {
      var v = custom.value.trim();
      if (v) select(v);
    });
    grid.appendChild(custom);
    wrap.appendChild(grid);
    select(current);
    controls[f.name] = { get: function () { return current; } };
    return wrap;
  }

  function colorPicker(f, controls) {
    var wrap = el('div', 'field');
    wrap.appendChild(el('span', null, f.label || 'Color'));
    var row = el('div', 'color-row');
    var current = f.value || CG.COLORS[0];
    CG.COLORS.forEach(function (c) {
      var b = button('color-opt', '', function () {
        current = c;
        Array.prototype.forEach.call(row.children, function (x) {
          x.classList.toggle('active', x === b);
        });
      });
      b.style.background = c;
      b.setAttribute('aria-label', 'Color ' + c);
      if (c === current) b.classList.add('active');
      row.appendChild(b);
    });
    wrap.appendChild(row);
    controls[f.name] = { get: function () { return current; } };
    return wrap;
  }

  // ---------- Confirmación ----------
  function confirmSheet(opts) {
    openSheet(opts.title, function (body, close) {
      if (opts.text) body.appendChild(el('p', 'sheet-text', opts.text));
      var actions = el('div', 'sheet-actions');
      actions.appendChild(button('btn ghost', opts.cancelLabel || 'Cancelar', function () {
        close();
        if (opts.onCancel) opts.onCancel();
      }));
      actions.appendChild(button('btn primary' + (opts.danger ? ' danger' : ''), opts.confirmLabel || 'Aceptar', function () {
        close();
        opts.onConfirm();
      }));
      body.appendChild(actions);
    }, { sticky: !!opts.sticky });
  }

  // ---------- Avisos ----------
  var toastTimer = null;
  function toast(text, actionLabel, action) {
    var t = document.getElementById('toast');
    var btn = document.getElementById('toast-action');
    document.getElementById('toast-text').textContent = text;
    btn.hidden = !actionLabel;
    btn.textContent = actionLabel || '';
    btn.onclick = function () {
      t.hidden = true;
      if (action) action();
    };
    t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.hidden = true; }, actionLabel ? 6000 : 3500);
  }

  // ---------- Gráficos ----------
  var NS = 'http://www.w3.org/2000/svg';
  function svgEl(tag, attrs, text) {
    var n = document.createElementNS(NS, tag);
    Object.keys(attrs || {}).forEach(function (k) { n.setAttribute(k, attrs[k]); });
    if (text != null) n.textContent = text;
    return n;
  }

  // Anillo de gastos por categoría. data: [{ label, value, color }]
  function donut(svg, data, centerLabel, centerValue) {
    svg.innerHTML = '';
    var total = data.reduce(function (s, d) { return s + d.value; }, 0);
    function circle(stroke) {
      return svgEl('circle', { cx: 60, cy: 60, r: 45, fill: 'none', stroke: stroke, 'stroke-width': 18 });
    }
    svg.appendChild(circle('var(--border)'));
    var offset = 0;
    var GAP = data.length > 1 ? 0.6 : 0;
    data.forEach(function (d) {
      var pct = d.value / total * 100;
      var len = Math.max(pct - GAP, 0.01);
      var seg = circle(d.color);
      seg.setAttribute('pathLength', 100);
      seg.setAttribute('stroke-dasharray', len + ' ' + (100 - len));
      seg.setAttribute('stroke-dashoffset', -offset);
      seg.setAttribute('transform', 'rotate(-90 60 60)');
      seg.appendChild(svgEl('title', {}, d.label + ': ' + CG.formatMoney(d.value) + ' (' + pct.toFixed(1) + '%)'));
      svg.appendChild(seg);
      offset += pct;
    });
    svg.appendChild(svgEl('text', { x: 60, y: 55, 'text-anchor': 'middle', 'class': 'center-label' }, centerLabel));
    svg.appendChild(svgEl('text', { x: 60, y: 69, 'text-anchor': 'middle', 'class': 'center-value' }, centerValue));
  }

  // Barras agrupadas por mes (ingresos y gastos) con escala única.
  // months: [{ label, full, income, expense }], onPick(index)
  function monthBars(container, months, onPick) {
    container.innerHTML = '';
    // El ancho del dibujo sigue al del contenedor para que el texto no se achique.
    var W = Math.max(300, Math.round(container.clientWidth || 640)), H = W < 480 ? 220 : 240;
    var left = 54, right = 4, top = 12, bottom = 26;
    var plotW = W - left - right, plotH = H - top - bottom;
    var max = 0;
    months.forEach(function (m) { max = Math.max(max, m.income, m.expense); });
    var step = niceStep(max / 4 || 100000);
    var yMax = Math.max(step * 4, step * Math.ceil(max / step));
    var y = function (v) { return top + plotH - (v / yMax) * plotH; };

    var svg = svgEl('svg', { viewBox: '0 0 ' + W + ' ' + H, 'class': 'bars', role: 'img',
      'aria-label': 'Ingresos y gastos por mes' });

    for (var t = 0; t <= yMax + 1; t += step) {
      svg.appendChild(svgEl('line', { x1: left, x2: W - right, y1: y(t), y2: y(t), 'class': t === 0 ? 'axis' : 'grid' }));
      svg.appendChild(svgEl('text', { x: left - 6, y: y(t) + 4, 'text-anchor': 'end', 'class': 'tick' }, CG.formatShort(t)));
    }

    var slot = plotW / months.length;
    var barW = Math.max(4, Math.min(16, (slot - 6) / 2));
    var tip = el('div', 'chart-tip');
    tip.hidden = true;

    months.forEach(function (m, i) {
      var cx = left + slot * i + slot / 2;
      [['income', m.income, cx - barW - 1], ['expense', m.expense, cx + 1]].forEach(function (b) {
        if (!b[1]) return;
        var h = Math.max(y(0) - y(b[1]), 1.5);
        svg.appendChild(svgEl('path', { d: roundedTop(b[2], y(0) - h, barW, h, 4), 'class': 'bar ' + b[0] }));
      });
      svg.appendChild(svgEl('text', { x: cx, y: H - 8, 'text-anchor': 'middle', 'class': 'tick' }, slot < 30 ? m.label.charAt(0) : m.label));

      // Zona sensible más grande que las barras.
      var hit = svgEl('rect', { x: left + slot * i, y: top, width: slot, height: plotH + bottom, 'class': 'hit' });
      hit.addEventListener('mouseenter', function () { show(i, cx); });
      hit.addEventListener('mouseleave', function () { tip.hidden = true; });
      hit.addEventListener('click', function () { if (onPick) onPick(i); });
      svg.appendChild(hit);
    });

    function show(i, cx) {
      var m = months[i];
      tip.innerHTML = '';
      tip.appendChild(el('strong', null, m.full));
      [['income', 'Ingresos', m.income], ['expense', 'Gastos', m.expense]].forEach(function (r) {
        var row = el('div', 'tip-row');
        row.appendChild(el('span', 'dot ' + r[0]));
        row.appendChild(el('span', null, r[1]));
        row.appendChild(el('b', null, CG.formatMoney(r[2])));
        tip.appendChild(row);
      });
      var net = m.income - m.expense;
      var row = el('div', 'tip-row');
      row.appendChild(el('span'));
      row.appendChild(el('span', null, 'Ahorro'));
      row.appendChild(el('b', null, CG.formatMoney(net)));
      tip.appendChild(row);
      tip.hidden = false;
      var pct = cx / W;
      tip.style.left = (pct * 100) + '%';
      tip.style.transform = 'translateX(' + (pct > 0.7 ? '-100%' : pct < 0.3 ? '0' : '-50%') + ')';
    }

    container.appendChild(svg);
    container.appendChild(tip);
  }

  function niceStep(raw) {
    var p = Math.pow(10, Math.floor(Math.log10(raw)));
    var n = raw / p;
    return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * p;
  }

  function roundedTop(x, yTop, w, h, r) {
    r = Math.min(r, w / 2, h);
    return 'M' + x + ',' + (yTop + h) +
      'V' + (yTop + r) +
      'Q' + x + ',' + yTop + ' ' + (x + r) + ',' + yTop +
      'H' + (x + w - r) +
      'Q' + (x + w) + ',' + yTop + ' ' + (x + w) + ',' + (yTop + r) +
      'V' + (yTop + h) + 'Z';
  }

  window.UI = {
    el: el,
    button: button,
    openDialog: openDialog,
    closeDialog: closeDialog,
    wireDialog: wireDialog,
    openSheet: openSheet,
    openForm: openForm,
    confirm: confirmSheet,
    toast: toast,
    donut: donut,
    monthBars: monthBars
  };
})();
