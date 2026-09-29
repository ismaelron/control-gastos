(function () {
  'use strict';

  // La publicación en GitHub Pages reemplaza 'dev' por la versión publicada,
  // para que el navegador descargue siempre los archivos nuevos.
  var APP_VERSION = 'dev';
  var MOVEMENTS_KEY = 'control-gastos:movimientos';
  var SETTINGS_KEY = 'control-gastos:ajustes';

  var CATEGORIES = [
    { id: 'comida', name: 'Comida', icon: '🍽️', color: '#e76f51' },
    { id: 'transporte', name: 'Transporte', icon: '🚌', color: '#2a9d8f' },
    { id: 'casa', name: 'Casa', icon: '🏠', color: '#457b9d' },
    { id: 'ocio', name: 'Ocio', icon: '🎉', color: '#9b5de5' },
    { id: 'salud', name: 'Salud', icon: '💊', color: '#e9c46a' },
    { id: 'otros', name: 'Otros', icon: '📦', color: '#8d99ae' }
  ];
  var CATEGORY_BY_ID = {};
  CATEGORIES.forEach(function (c) { CATEGORY_BY_ID[c.id] = c; });

  var numberFormat = new Intl.NumberFormat('es', { minimumFractionDigits: 2, maximumFractionDigits: 2, useGrouping: 'always' });
  var monthFormat = new Intl.DateTimeFormat('es', { month: 'long', year: 'numeric' });
  var dayFormat = new Intl.DateTimeFormat('es', { weekday: 'long', day: 'numeric', month: 'long' });

  // ---------- Estado ----------
  var firebaseConfig = window.FIREBASE_CONFIG || null;
  var cloud = null;          // API de cloud.js cuando Firebase está activo
  var cloudFailed = false;   // no se pudo cargar o conectar con Firebase
  var user = null;           // usuario con sesión iniciada
  var syncState = null;      // { pending, fromCache } del último snapshot
  var movements = [];
  var settings = { budget: 0, categoryBudgets: {} };
  var today = new Date();
  var currentYear = today.getFullYear();
  var currentMonth = today.getMonth(); // 0-11
  var filters = { text: '', type: 'todos', category: 'todas' };
  var editingId = null;
  var importOffered = false;
  var waitingFirstSnapshot = false;

  // ---------- Elementos ----------
  var $ = function (id) { return document.getElementById(id); };
  var movementSheet = $('movement-sheet');
  var settingsSheet = $('settings-sheet');
  var importSheet = $('import-sheet');
  var form = $('movement-form');
  var amountInput = $('amount');
  var dateInput = $('date');
  var noteInput = $('note');

  // ---------- Almacenamiento local ----------
  function loadLocalMovements() {
    try {
      var data = JSON.parse(localStorage.getItem(MOVEMENTS_KEY) || '[]');
      return Array.isArray(data) ? data.filter(isValidMovement) : [];
    } catch (e) {
      return [];
    }
  }

  function saveLocalMovements(list) {
    try {
      localStorage.setItem(MOVEMENTS_KEY, JSON.stringify(list));
    } catch (e) {
      showToast('No se pudieron guardar los datos en este navegador.');
    }
  }

  function loadLocalSettings() {
    try {
      return normalizeSettings(JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}'));
    } catch (e) {
      return normalizeSettings({});
    }
  }

  function saveLocalSettings(s) {
    try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(s)); } catch (e) { /* ignorar */ }
  }

  function normalizeSettings(s) {
    s = s || {};
    var cb = {};
    var src = s.categoryBudgets || {};
    CATEGORIES.forEach(function (c) {
      if (typeof src[c.id] === 'number' && src[c.id] > 0) cb[c.id] = src[c.id];
    });
    return { budget: typeof s.budget === 'number' && s.budget > 0 ? s.budget : 0, categoryBudgets: cb };
  }

  function isValidMovement(m) {
    return m && typeof m.id === 'string' &&
      (m.type === 'gasto' || m.type === 'ingreso') &&
      /^\d{4}-\d{2}-\d{2}$/.test(m.date) &&
      typeof m.amount === 'number' && isFinite(m.amount) &&
      typeof m.category === 'string';
  }

  function isCloud() { return !!(cloud && user); }

  // ---------- Operaciones sobre los datos ----------
  function persistMovement(m) {
    if (isCloud()) {
      cloud.save(m); // el cambio llega de vuelta por onMovements
      return;
    }
    var exists = false;
    movements = movements.map(function (x) {
      if (x.id === m.id) { exists = true; return m; }
      return x;
    });
    if (!exists) movements.push(m);
    saveLocalMovements(movements);
    render();
  }

  function deleteMovement(id) {
    if (isCloud()) {
      cloud.remove(id);
      return;
    }
    movements = movements.filter(function (x) { return x.id !== id; });
    saveLocalMovements(movements);
    render();
  }

  function persistSettings(s) {
    settings = normalizeSettings(s);
    if (isCloud()) cloud.saveSettings(settings);
    else saveLocalSettings(settings);
    render();
  }

  function newId() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  // ---------- Utilidades ----------
  function pad(n) { return (n < 10 ? '0' : '') + n; }

  function toISODate(d) {
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  }

  function parseISODate(s) {
    var p = s.split('-');
    return new Date(+p[0], +p[1] - 1, +p[2]);
  }

  function monthKey(year, month) { return year + '-' + pad(month + 1); }

  function isViewingCurrentMonth() {
    return currentYear === today.getFullYear() && currentMonth === today.getMonth();
  }

  function capitalize(s) { return s.charAt(0).toUpperCase() + s.slice(1); }

  // Montos guardados en centavos (enteros) para evitar errores de redondeo.
  function formatMoney(cents) {
    var sign = cents < 0 ? '-' : '';
    return sign + '$' + numberFormat.format(Math.abs(cents) / 100);
  }

  // Acepta "1234,56", "1.234,56", "1234.56" o "1,234.56".
  function parseAmount(text) {
    var s = String(text).trim().replace(/[\s$]/g, '');
    if (!s) return NaN;
    var lastComma = s.lastIndexOf(',');
    var lastDot = s.lastIndexOf('.');
    if (lastComma > -1 && lastDot > -1) {
      if (lastComma > lastDot) s = s.replace(/\./g, '').replace(',', '.');
      else s = s.replace(/,/g, '');
    } else if (lastComma > -1) {
      var parts = s.split(',');
      if (parts.length === 2 && parts[1].length <= 2) s = parts[0] + '.' + parts[1];
      else s = s.replace(/,/g, '');
    } else if (lastDot > -1) {
      var dotParts = s.split('.');
      if (dotParts.length > 2 || (dotParts.length === 2 && dotParts[1].length === 3)) s = s.replace(/\./g, '');
    }
    if (!/^\d+(\.\d+)?$/.test(s)) return NaN;
    return Math.round(parseFloat(s) * 100);
  }

  function centsToInput(cents) {
    return cents ? numberFormat.format(cents / 100).replace(/\s/g, '') : '';
  }

  function normalizeText(s) {
    return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  }

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }

  function categoryOf(m) { return CATEGORY_BY_ID[m.category] || CATEGORY_BY_ID.otros; }

  function sortByDateDesc(a, b) {
    if (a.date !== b.date) return a.date < b.date ? 1 : -1;
    return (b.createdAt || 0) - (a.createdAt || 0);
  }

  function movementsOfMonth(year, month) {
    var key = monthKey(year, month);
    return movements.filter(function (m) { return m.date.slice(0, 7) === key; }).sort(sortByDateDesc);
  }

  function applyFilters(list) {
    var q = normalizeText(filters.text.trim());
    return list.filter(function (m) {
      if (filters.type !== 'todos' && m.type !== filters.type) return false;
      if (filters.category !== 'todas' && m.category !== filters.category) return false;
      if (q) {
        var hay = normalizeText((m.note || '') + ' ' + categoryOf(m).name);
        if (hay.indexOf(q) === -1) return false;
      }
      return true;
    });
  }

  function isFiltering() {
    return filters.type !== 'todos' || filters.category !== 'todas' || filters.text.trim() !== '';
  }

  // ---------- Avisos ----------
  var toastTimer = null;
  function showToast(text, actionLabel, action) {
    var toast = $('toast');
    var btn = $('toast-action');
    $('toast-text').textContent = text;
    btn.hidden = !actionLabel;
    btn.textContent = actionLabel || '';
    btn.onclick = function () {
      toast.hidden = true;
      if (action) action();
    };
    toast.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { toast.hidden = true; }, actionLabel ? 6000 : 3500);
  }

  function friendlyError(err) {
    var code = (err && err.code) || '';
    if (code === 'auth/unauthorized-domain') {
      return 'Este sitio no está autorizado en Firebase. Agrégalo en Authentication → Settings → Authorized domains.';
    }
    if (code === 'auth/network-request-failed' || code === 'unavailable') {
      return 'Sin conexión a internet. Inténtalo de nuevo.';
    }
    if (code === 'permission-denied') {
      return 'Firebase rechazó el guardado. Revisa las reglas de Firestore (ver README).';
    }
    if (code === 'auth/operation-not-allowed') {
      return 'El inicio de sesión con Google no está activado en Firebase.';
    }
    return 'Ocurrió un error' + (code ? ' (' + code + ')' : '') + '. Inténtalo de nuevo.';
  }

  // ---------- Hojas (diálogos) ----------
  function openSheet(dialog) {
    if (typeof dialog.showModal === 'function') dialog.showModal();
    else dialog.setAttribute('open', '');
  }

  function closeSheet(dialog) {
    if (typeof dialog.close === 'function') dialog.close();
    else dialog.removeAttribute('open');
  }

  [movementSheet, settingsSheet, importSheet].forEach(function (dialog) {
    // Cerrar al tocar fuera de la hoja.
    dialog.addEventListener('click', function (e) {
      if (e.target === dialog && dialog !== importSheet) closeSheet(dialog);
    });
    Array.prototype.forEach.call(dialog.querySelectorAll('[data-close]'), function (b) {
      b.addEventListener('click', function () { closeSheet(dialog); });
    });
  });

  // ---------- Render ----------
  function render() {
    var monthList = movementsOfMonth(currentYear, currentMonth);

    $('month-name').textContent = capitalize(monthFormat.format(new Date(currentYear, currentMonth, 1)));
    $('today-month').hidden = isViewingCurrentMonth();

    renderAccount();
    renderSummary(monthList);
    renderBudget(monthList);
    renderChart(monthList);
    renderList(monthList);
  }

  function renderAccount() {
    var avatar = $('account-avatar');
    avatar.innerHTML = '';
    if (user && user.photo) {
      var img = document.createElement('img');
      img.src = user.photo;
      img.alt = '';
      img.referrerPolicy = 'no-referrer';
      avatar.appendChild(img);
    } else if (user) {
      avatar.textContent = (user.name || user.email || '?').charAt(0).toUpperCase();
    } else {
      avatar.textContent = '⚙️';
    }
    $('account-btn').setAttribute('aria-label', user ? 'Cuenta de ' + (user.name || user.email) : 'Cuenta y ajustes');
    // Con cuentas activadas y sin sesión, la invitación siempre está visible;
    // si Firebase no cargó, muestra el problema y un botón para reintentar.
    $('signin-banner').hidden = !(firebaseConfig && !user);
    var failed = !cloud && cloudFailed;
    $('signin-title').textContent = failed ? 'No se pudo conectar con el inicio de sesión' : 'Guarda tus datos en tu cuenta';
    $('signin-text').textContent = failed
      ? 'Revisa tu conexión a internet y pulsa Reintentar. Si sigue igual, recarga la página con Ctrl + F5.'
      : 'Inicia sesión con Google para no perder tus movimientos y verlos en el celular y en la computadora.';
    $('signin-btn').hidden = failed;
    $('retry-btn').hidden = !failed;

    var note;
    if (isCloud()) {
      note = 'Datos guardados en tu cuenta (' + (user.email || user.name) + '). ' + syncText();
    } else if (cloud) {
      note = 'Sin sesión: los datos se guardan solo en este navegador.';
    } else {
      note = 'Tus datos se guardan solo en este navegador.';
    }
    $('footer-note').textContent = note;

    renderAccountInfo();
  }

  function syncText() {
    if (!syncState) return '';
    if (syncState.pending && syncState.fromCache) return '📴 Sin conexión: los cambios se subirán al reconectar.';
    if (syncState.pending) return '⏳ Guardando cambios…';
    if (syncState.fromCache) return '📴 Sin conexión.';
    return '☁️ Todo guardado.';
  }

  function renderAccountInfo() {
    var box = $('account-info');
    box.innerHTML = '';
    if (!firebaseConfig) {
      box.appendChild(el('p', 'muted', 'Las cuentas de usuario no están activadas. Tus datos se guardan solo en este navegador. (Para activarlas, sigue la guía del README.)'));
      return;
    }
    if (!cloud) {
      box.appendChild(el('p', 'muted', 'No se pudo conectar con el servicio de cuentas. Por ahora los datos se guardan en este navegador. Recarga la página para reintentar.'));
      return;
    }
    if (!user) {
      box.appendChild(el('p', 'muted', 'Inicia sesión para guardar tus datos en tu cuenta y verlos en todos tus dispositivos.'));
      var btn = el('button', 'btn google block');
      btn.type = 'button';
      btn.setAttribute('data-action', 'signin');
      btn.appendChild(el('span', 'g-logo', 'G'));
      btn.appendChild(document.createTextNode(' Entrar con Google'));
      box.appendChild(btn);
      return;
    }
    var row = el('div', 'account-row');
    var av = el('span', 'avatar');
    if (user.photo) {
      var img = document.createElement('img');
      img.src = user.photo; img.alt = ''; img.referrerPolicy = 'no-referrer';
      av.appendChild(img);
    } else {
      av.textContent = (user.name || user.email || '?').charAt(0).toUpperCase();
    }
    row.appendChild(av);
    var who = el('div');
    who.appendChild(el('strong', null, user.name || 'Usuario'));
    who.appendChild(el('small', null, user.email));
    row.appendChild(who);
    box.appendChild(row);
    box.appendChild(el('p', 'sync-status', syncText()));
    var out = el('button', 'btn ghost block', 'Cerrar sesión');
    out.type = 'button';
    out.setAttribute('data-action', 'signout');
    box.appendChild(out);
  }

  function totalsOf(list) {
    var t = { income: 0, expense: 0 };
    list.forEach(function (m) {
      if (m.type === 'ingreso') t.income += m.amount; else t.expense += m.amount;
    });
    return t;
  }

  function renderSummary(list) {
    var t = totalsOf(list);
    var balance = t.income - t.expense;
    $('total-income').textContent = formatMoney(t.income);
    $('total-expense').textContent = formatMoney(t.expense);
    var balanceEl = $('total-balance');
    balanceEl.textContent = formatMoney(balance);
    balanceEl.className = 'hero-value ' + (balance < 0 ? 'expense' : balance > 0 ? 'income' : '');
  }

  function renderBudget(list) {
    var budget = settings.budget;
    $('budget-body').hidden = !budget;
    $('budget-empty').hidden = !!budget;
    if (!budget) return;

    var spent = totalsOf(list).expense;
    var ratio = spent / budget;
    var bar = $('budget-bar');
    bar.style.width = Math.min(ratio * 100, 100) + '%';
    bar.parentNode.className = 'progress' + (ratio > 1 ? ' over' : ratio >= 0.8 ? ' warn' : '');

    var text = $('budget-text');
    text.innerHTML = '';
    text.appendChild(document.createTextNode('Gastaste ' + formatMoney(spent) + ' de ' + formatMoney(budget) + '. '));
    var remaining = budget - spent;
    if (remaining >= 0) {
      text.appendChild(el('strong', null, 'Te quedan ' + formatMoney(remaining)));
      if (isViewingCurrentMonth()) {
        var lastDay = new Date(currentYear, currentMonth + 1, 0).getDate();
        var daysLeft = lastDay - today.getDate() + 1;
        text.appendChild(document.createTextNode(' (unos ' + formatMoney(Math.floor(remaining / daysLeft)) + ' por día).'));
      } else {
        text.appendChild(document.createTextNode('.'));
      }
    } else {
      text.appendChild(el('strong', 'over', 'Te pasaste por ' + formatMoney(-remaining) + '.'));
    }
  }

  function renderChart(list) {
    var totals = {};
    var total = 0;
    list.forEach(function (m) {
      if (m.type !== 'gasto') return;
      var c = categoryOf(m).id;
      totals[c] = (totals[c] || 0) + m.amount;
      total += m.amount;
    });

    var svg = $('chart');
    var legend = $('chart-legend');
    svg.innerHTML = '';
    legend.innerHTML = '';

    var hasData = total > 0;
    $('chart-empty').hidden = hasData;
    $('chart-wrap').hidden = !hasData;
    if (!hasData) return;

    var data = CATEGORIES
      .map(function (c) { return { cat: c, value: totals[c.id] || 0 }; })
      .filter(function (d) { return d.value > 0; })
      .sort(function (a, b) { return b.value - a.value; });

    var NS = 'http://www.w3.org/2000/svg';
    function circle(stroke) {
      var c = document.createElementNS(NS, 'circle');
      c.setAttribute('cx', 60); c.setAttribute('cy', 60); c.setAttribute('r', 45);
      c.setAttribute('fill', 'none');
      c.setAttribute('stroke', stroke);
      c.setAttribute('stroke-width', 18);
      return c;
    }
    svg.appendChild(circle('var(--border)'));

    var offset = 0;
    var GAP = data.length > 1 ? 0.6 : 0; // pequeño espacio entre porciones
    data.forEach(function (d) {
      var pct = d.value / total * 100;
      var len = Math.max(pct - GAP, 0.01);
      var seg = circle(d.cat.color);
      seg.setAttribute('pathLength', 100);
      seg.setAttribute('stroke-dasharray', len + ' ' + (100 - len));
      seg.setAttribute('stroke-dashoffset', -offset);
      seg.setAttribute('transform', 'rotate(-90 60 60)');
      var title = document.createElementNS(NS, 'title');
      title.textContent = d.cat.name + ': ' + formatMoney(d.value) + ' (' + pct.toFixed(1) + '%)';
      seg.appendChild(title);
      svg.appendChild(seg);
      offset += pct;
    });

    [['Total gastos', 55, 'center-label'], [formatMoney(total), 69, 'center-value']].forEach(function (t) {
      var node = document.createElementNS(NS, 'text');
      node.setAttribute('x', 60); node.setAttribute('y', t[1]);
      node.setAttribute('text-anchor', 'middle');
      node.setAttribute('class', t[2]);
      node.textContent = t[0];
      svg.appendChild(node);
    });

    data.forEach(function (d) {
      var pct = d.value / total * 100;
      var limit = settings.categoryBudgets[d.cat.id];
      var li = el('li');
      var swatch = el('span', 'swatch');
      swatch.style.background = d.cat.color;
      li.appendChild(swatch);
      li.appendChild(el('span', null, d.cat.icon + ' ' + d.cat.name));
      var amount = el('span', 'amount', formatMoney(d.value));
      amount.appendChild(el('span', 'pct', Math.round(pct) + '%'));
      li.appendChild(amount);
      var bar = el('span', 'bar');
      var fill = el('span');
      // Con presupuesto de categoría la barra muestra cuánto se ha usado de él.
      fill.style.width = (limit ? Math.min(d.value / limit * 100, 100) : pct) + '%';
      fill.style.background = limit && d.value > limit ? 'var(--danger)' : d.cat.color;
      bar.appendChild(fill);
      li.appendChild(bar);
      if (limit) {
        var over = d.value > limit;
        li.appendChild(el('span', 'limit' + (over ? ' over' : ''),
          over ? 'Te pasaste por ' + formatMoney(d.value - limit) + ' (presupuesto ' + formatMoney(limit) + ')'
               : 'Presupuesto ' + formatMoney(limit) + ' · quedan ' + formatMoney(limit - d.value)));
      }
      legend.appendChild(li);
    });
  }

  function dayLabel(iso) {
    var todayIso = toISODate(today);
    var y = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1);
    if (iso === todayIso) return 'Hoy';
    if (iso === toISODate(y)) return 'Ayer';
    return capitalize(dayFormat.format(parseISODate(iso)));
  }

  function renderCategoryChips() {
    var box = $('category-chips');
    if (box.childNodes.length) {
      Array.prototype.forEach.call(box.children, function (b) {
        b.classList.toggle('active', b.getAttribute('data-category') === filters.category);
      });
      return;
    }
    [{ id: 'todas', name: 'Todas', icon: '' }].concat(CATEGORIES).forEach(function (c) {
      var b = el('button', 'chip' + (filters.category === c.id ? ' active' : ''), (c.icon ? c.icon + ' ' : '') + c.name);
      b.type = 'button';
      b.setAttribute('data-category', c.id);
      box.appendChild(b);
    });
  }

  function renderList(monthList) {
    renderCategoryChips();
    Array.prototype.forEach.call($('type-chips').children, function (b) {
      b.classList.toggle('active', b.getAttribute('data-type') === filters.type);
    });

    var list = applyFilters(monthList);
    var box = $('movement-list');
    box.innerHTML = '';

    var summary = $('filter-summary');
    if (isFiltering() && monthList.length) {
      var t = totalsOf(list);
      var parts = [list.length + (list.length === 1 ? ' movimiento' : ' movimientos')];
      if (t.expense) parts.push('gastos ' + formatMoney(t.expense));
      if (t.income) parts.push('ingresos ' + formatMoney(t.income));
      summary.textContent = parts.join(' · ');
      summary.hidden = false;
    } else {
      summary.hidden = true;
    }

    $('list-empty').hidden = list.length > 0;
    $('list-empty-text').textContent = monthList.length
      ? 'Ningún movimiento coincide con la búsqueda.'
      : 'No hay movimientos en este mes.';
    $('empty-add').hidden = monthList.length > 0;

    var groups = [];
    list.forEach(function (m) {
      var g = groups[groups.length - 1];
      if (!g || g.date !== m.date) groups.push(g = { date: m.date, items: [] });
      g.items.push(m);
    });

    groups.forEach(function (g) {
      var group = el('div', 'day-group');
      var head = el('div', 'day-head');
      head.appendChild(el('span', null, dayLabel(g.date)));
      var t = totalsOf(g.items);
      var net = t.income - t.expense;
      head.appendChild(el('span', null, (net > 0 ? '+' : '') + formatMoney(net)));
      group.appendChild(head);

      g.items.forEach(function (m) {
        var cat = categoryOf(m);
        var item = el('button', 'movement');
        item.type = 'button';
        item.setAttribute('data-id', m.id);

        var icon = el('span', 'icon', cat.icon);
        icon.style.background = cat.color + '33';
        icon.setAttribute('aria-hidden', 'true');
        item.appendChild(icon);

        var info = el('span', 'info');
        info.appendChild(el('span', 'title', m.note || cat.name));
        info.appendChild(el('span', 'note', m.type === 'ingreso' ? cat.name + ' · Ingreso' : cat.name));
        item.appendChild(info);

        item.appendChild(el('span', 'amount ' + (m.type === 'ingreso' ? 'income' : 'expense'),
          (m.type === 'ingreso' ? '+' : '−') + formatMoney(m.amount)));
        item.setAttribute('aria-label', 'Editar: ' + (m.note || cat.name) + ', ' +
          (m.type === 'ingreso' ? 'ingreso de ' : 'gasto de ') + formatMoney(m.amount));

        group.appendChild(item);
      });
      box.appendChild(group);
    });
  }

  // ---------- Formulario de movimiento ----------
  function buildCategoryGrid() {
    var grid = $('category-grid');
    CATEGORIES.forEach(function (c) {
      var label = el('label', 'cat-option');
      label.style.setProperty('--cat-color', c.color);
      label.style.setProperty('--cat-soft', c.color + '26');
      var input = document.createElement('input');
      input.type = 'radio';
      input.name = 'category';
      input.value = c.id;
      label.appendChild(input);
      var span = el('span');
      span.appendChild(el('b', null, c.icon));
      span.appendChild(document.createTextNode(c.name));
      label.appendChild(span);
      grid.appendChild(label);
    });
  }

  function defaultDate() {
    // Si se está viendo otro mes, proponer una fecha de ese mes.
    return isViewingCurrentMonth() ? toISODate(today) : monthKey(currentYear, currentMonth) + '-01';
  }

  function showFormError(msg) {
    $('form-error').textContent = msg;
    $('form-error').hidden = !msg;
  }

  function openMovementSheet(m) {
    form.reset();
    showFormError('');
    editingId = m ? m.id : null;
    $('sheet-title').textContent = m ? 'Editar movimiento' : 'Nuevo movimiento';
    $('submit-btn').textContent = m ? 'Guardar cambios' : 'Guardar';
    $('delete-btn').hidden = !m;
    form.querySelector('input[name="type"][value="' + (m ? m.type : 'gasto') + '"]').checked = true;
    amountInput.value = m ? centsToInput(m.amount) : '';
    dateInput.value = m ? m.date : defaultDate();
    noteInput.value = m ? m.note || '' : '';
    if (m) {
      var radio = form.querySelector('input[name="category"][value="' + categoryOf(m).id + '"]');
      if (radio) radio.checked = true;
    }
    openSheet(movementSheet);
    if (!m) amountInput.focus();
  }

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    var type = form.querySelector('input[name="type"]:checked').value;
    var amount = parseAmount(amountInput.value);
    var catInput = form.querySelector('input[name="category"]:checked');
    var date = dateInput.value;
    var note = noteInput.value.trim();

    if (!(amount > 0)) { showFormError('Escribe un monto mayor que cero (ej.: 1250,50).'); amountInput.focus(); return; }
    if (!catInput) { showFormError('Elige una categoría.'); return; }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) { showFormError('Elige una fecha válida.'); dateInput.focus(); return; }

    var existing = editingId && movements.find(function (x) { return x.id === editingId; });
    var m = {
      id: existing ? existing.id : newId(),
      type: type,
      date: date,
      amount: amount,
      category: catInput.value,
      note: note,
      createdAt: existing ? existing.createdAt || Date.now() : Date.now()
    };

    // Mostrar el mes del movimiento guardado.
    var d = parseISODate(date);
    currentYear = d.getFullYear();
    currentMonth = d.getMonth();

    persistMovement(m);
    closeSheet(movementSheet);
    render();
    showToast(existing ? 'Cambios guardados' : (type === 'gasto' ? 'Gasto guardado' : 'Ingreso guardado'));
    editingId = null;
  });

  $('delete-btn').addEventListener('click', function () {
    var m = movements.find(function (x) { return x.id === editingId; });
    closeSheet(movementSheet);
    editingId = null;
    if (!m) return;
    deleteMovement(m.id);
    showToast('Movimiento borrado', 'Deshacer', function () { persistMovement(m); });
  });

  // ---------- Ajustes y presupuesto ----------
  function buildBudgetFields() {
    var box = $('category-budget-fields');
    CATEGORIES.forEach(function (c) {
      var label = el('label', 'field');
      label.appendChild(el('span', null, c.icon + ' ' + c.name));
      var input = document.createElement('input');
      input.type = 'text';
      input.inputMode = 'decimal';
      input.placeholder = '—';
      input.setAttribute('data-budget-category', c.id);
      label.appendChild(input);
      box.appendChild(label);
    });
  }

  function openSettingsSheet(focusBudget) {
    $('budget-total').value = centsToInput(settings.budget);
    Array.prototype.forEach.call(document.querySelectorAll('[data-budget-category]'), function (input) {
      input.value = centsToInput(settings.categoryBudgets[input.getAttribute('data-budget-category')] || 0);
    });
    $('budget-error').hidden = true;
    renderAccountInfo();
    openSheet(settingsSheet);
    if (focusBudget) {
      $('budget-section').scrollIntoView({ block: 'start' });
      $('budget-total').focus();
    }
  }

  $('budget-form').addEventListener('submit', function (e) {
    e.preventDefault();
    var error = '';
    function read(input) {
      if (!input.value.trim()) return 0;
      var v = parseAmount(input.value);
      if (!(v >= 0)) error = 'Revisa los montos del presupuesto (ej.: 500000 o 1.250,50).';
      return v || 0;
    }
    var next = { budget: read($('budget-total')), categoryBudgets: {} };
    Array.prototype.forEach.call(document.querySelectorAll('[data-budget-category]'), function (input) {
      var v = read(input);
      if (v > 0) next.categoryBudgets[input.getAttribute('data-budget-category')] = v;
    });
    if (error) {
      $('budget-error').textContent = error;
      $('budget-error').hidden = false;
      return;
    }
    persistSettings(next);
    closeSheet(settingsSheet);
    showToast('Presupuesto guardado');
  });

  // ---------- Exportar CSV ----------
  // Se usa ";" como separador y coma decimal, que es lo que espera Excel en español.
  function csvCell(value, isText) {
    var s = String(value == null ? '' : value);
    // Evita que Excel interprete una nota como fórmula.
    if (isText && /^[=+\-@\t\r]/.test(s)) s = "'" + s;
    if (/[";\n\r]/.test(s)) s = '"' + s.replace(/"/g, '""') + '"';
    return s;
  }

  function exportCSV(list, filename) {
    if (!list.length) {
      showToast('No hay movimientos para exportar.');
      return;
    }
    var rows = [['Fecha', 'Tipo', 'Categoría', 'Monto', 'Nota']];
    list.slice().sort(function (a, b) { return -sortByDateDesc(a, b); }).forEach(function (m) {
      var p = m.date.split('-');
      var signed = (m.type === 'gasto' ? -m.amount : m.amount) / 100;
      rows.push([
        p[2] + '/' + p[1] + '/' + p[0],
        m.type === 'gasto' ? 'Gasto' : 'Ingreso',
        categoryOf(m).name,
        signed.toFixed(2).replace('.', ','),
        m.note || ''
      ]);
    });
    var csv = '﻿' + rows.map(function (r) {
      return r.map(function (v, i) { return csvCell(v, i === 4); }).join(';');
    }).join('\r\n');
    var blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  }

  $('export-month').addEventListener('click', function () {
    exportCSV(movementsOfMonth(currentYear, currentMonth), 'movimientos-' + monthKey(currentYear, currentMonth) + '.csv');
  });
  $('export-all').addEventListener('click', function () {
    exportCSV(movements, 'movimientos-todos-' + toISODate(new Date()) + '.csv');
  });

  // ---------- Cuentas (Firebase) ----------
  function signIn() {
    if (!cloud) return;
    cloud.signIn().catch(function (err) { showToast(friendlyError(err)); });
  }

  function signOutUser() {
    if (!cloud) return;
    closeSheet(settingsSheet);
    showLoading(true);
    cloud.signOut().then(function () {
      location.reload();
    }, function (err) {
      showLoading(false);
      showToast(friendlyError(err));
    });
  }

  // Si hay movimientos guardados solo en este navegador, ofrecer subirlos a la cuenta.
  function maybeOfferImport() {
    if (importOffered || !isCloud()) return;
    var local = loadLocalMovements();
    if (!local.length) return;
    importOffered = true;
    var one = local.length === 1;
    $('import-text').textContent = 'Tienes ' + local.length +
      (one ? ' movimiento guardado' : ' movimientos guardados') +
      ' solo en este dispositivo. ¿Quieres ' + (one ? 'subirlo' : 'subirlos') +
      ' a tu cuenta para no perderlo' + (one ? '' : 's') + ' y verlo' + (one ? '' : 's') + ' en todos tus dispositivos?';
    openSheet(importSheet);
  }

  $('import-yes').addEventListener('click', function () {
    closeSheet(importSheet);
    if (!isCloud()) return;
    var local = loadLocalMovements();
    cloud.importMany(local);
    var localSettings = loadLocalSettings();
    if (!settings.budget && localSettings.budget) persistSettings(localSettings);
    try {
      localStorage.removeItem(MOVEMENTS_KEY);
      localStorage.removeItem(SETTINGS_KEY);
    } catch (e) { /* ignorar */ }
    showToast(local.length + (local.length === 1 ? ' movimiento subido' : ' movimientos subidos') + ' a tu cuenta');
  });

  $('import-no').addEventListener('click', function () { closeSheet(importSheet); });

  function showLoading(on) {
    $('loading').hidden = !on;
    $('main').hidden = on;
    $('fab').hidden = on;
  }

  function startLocal() {
    movements = loadLocalMovements();
    settings = loadLocalSettings();
    render();
    showLoading(false);
  }

  function startCloud() {
    var settled = false;
    // Si Firebase no responde, seguir con los datos de este navegador.
    var fallback = setTimeout(function () {
      if (settled) return;
      settled = true;
      cloud = null;
      cloudFailed = true;
      startLocal();
    }, 12000);

    import('./cloud.js?v=' + APP_VERSION).then(function (mod) {
      return mod.initCloud(firebaseConfig, {
        onUser: function (u) {
          user = u;
          syncState = null;
          if (u) {
            movements = [];
            settings = normalizeSettings({});
            waitingFirstSnapshot = true;
            showLoading(true);
          } else {
            clearTimeout(fallback);
            settled = true;
            startLocal();
          }
        },
        onMovements: function (list, meta) {
          movements = list.filter(isValidMovement);
          syncState = meta;
          if (waitingFirstSnapshot) {
            waitingFirstSnapshot = false;
            clearTimeout(fallback);
            settled = true;
            showLoading(false);
            maybeOfferImport();
          }
          render();
        },
        onSettings: function (s) {
          settings = normalizeSettings(s);
          render();
        },
        onError: function (err) {
          showToast(friendlyError(err));
        }
      });
    }).then(function (api) {
      cloud = api;
      cloudFailed = false;
      cloud.start();
      render();
    }).catch(function (err) {
      if (settled) return;
      settled = true;
      clearTimeout(fallback);
      cloud = null;
      cloudFailed = true;
      startLocal();
      if (window.console) console.error(err);
    });
  }

  // ---------- Eventos ----------
  document.addEventListener('click', function (e) {
    var target = e.target.closest ? e.target.closest('[data-action]') : null;
    if (!target) return;
    var action = target.getAttribute('data-action');
    if (action === 'signin') signIn();
    else if (action === 'signout') signOutUser();
    else if (action === 'edit-budget') openSettingsSheet(true);
    else if (action === 'retry') location.reload();
  });

  $('fab').addEventListener('click', function () { openMovementSheet(null); });
  $('empty-add').addEventListener('click', function () { openMovementSheet(null); });
  $('account-btn').addEventListener('click', function () { openSettingsSheet(false); });

  $('movement-list').addEventListener('click', function (e) {
    var item = e.target.closest('.movement');
    if (!item) return;
    var m = movements.find(function (x) { return x.id === item.getAttribute('data-id'); });
    if (m) openMovementSheet(m);
  });

  $('search').addEventListener('input', function (e) {
    filters.text = e.target.value;
    render();
  });
  $('type-chips').addEventListener('click', function (e) {
    var b = e.target.closest('[data-type]');
    if (!b) return;
    filters.type = b.getAttribute('data-type');
    render();
  });
  $('category-chips').addEventListener('click', function (e) {
    var b = e.target.closest('[data-category]');
    if (!b) return;
    filters.category = b.getAttribute('data-category');
    render();
  });

  function changeMonth(delta) {
    var d = new Date(currentYear, currentMonth + delta, 1);
    currentYear = d.getFullYear();
    currentMonth = d.getMonth();
    render();
  }
  $('prev-month').addEventListener('click', function () { changeMonth(-1); });
  $('next-month').addEventListener('click', function () { changeMonth(1); });
  $('today-month').addEventListener('click', function () {
    currentYear = today.getFullYear();
    currentMonth = today.getMonth();
    render();
  });

  // Sincroniza si los datos cambian en otra pestaña (modo sin cuenta).
  window.addEventListener('storage', function (e) {
    if (isCloud() || (e.key !== MOVEMENTS_KEY && e.key !== SETTINGS_KEY)) return;
    movements = loadLocalMovements();
    settings = loadLocalSettings();
    render();
  });

  // ---------- Inicio ----------
  buildCategoryGrid();
  buildBudgetFields();
  if (firebaseConfig) startCloud();
  else startLocal();
})();
