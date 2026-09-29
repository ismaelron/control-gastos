(function () {
  'use strict';

  var CG = window.CG;
  var UI = window.UI;
  var el = UI.el;
  var button = UI.button;

  // La publicación en GitHub Pages reemplaza 'dev' por la versión publicada,
  // para que el navegador descargue siempre los archivos nuevos.
  var APP_VERSION = 'dev';

  var KEYS = {
    movements: 'control-gastos:movimientos',
    legacySettings: 'control-gastos:ajustes',
    book: 'control-gastos:libro',
    recurring: 'control-gastos:fijos',
    goals: 'control-gastos:metas',
    invite: 'control-gastos:invitacion'
  };

  var monthFormat = new Intl.DateTimeFormat('es', { month: 'long', year: 'numeric' });
  var monthShort = new Intl.DateTimeFormat('es', { month: 'short' });
  var monthLong = new Intl.DateTimeFormat('es', { month: 'long' });
  var dayFormat = new Intl.DateTimeFormat('es', { weekday: 'long', day: 'numeric', month: 'long' });
  var dayShort = new Intl.DateTimeFormat('es', { day: 'numeric', month: 'short' });

  // ---------- Estado ----------
  var firebaseConfig = window.FIREBASE_CONFIG || null;
  var now = new Date();
  var S = {
    cloud: null,          // API de cloud.js cuando Firebase está activo
    cloudFailed: false,   // no se pudo cargar o conectar con Firebase
    user: null,
    sync: null,           // { pending, fromCache } del último snapshot
    book: CG.normalizeBook(null),
    books: [],
    movements: [],
    recurring: [],
    goals: [],
    loaded: { book: false, movements: false, recurring: false },
    ready: false,
    view: 'inicio',
    year: now.getFullYear(),
    month: now.getMonth(),
    summaryYear: now.getFullYear(),
    filters: { text: '', type: 'todos', category: 'todas', account: 'todas' },
    editingId: null,
    importOffered: false,
    lastRecurringKey: '',
    installPrompt: null
  };

  var $ = function (id) { return document.getElementById(id); };
  function todayISO() { return CG.toISODate(new Date()); }
  function currentMonthKey() { return todayISO().slice(0, 7); }
  function viewMonthKey() { return CG.monthKey(S.year, S.month); }
  function isCloud() { return !!(S.cloud && S.user); }
  function capitalize(s) { return s.charAt(0).toUpperCase() + s.slice(1); }
  function monthName(key, fmt) {
    var p = key.split('-');
    return capitalize((fmt || monthFormat).format(new Date(+p[0], +p[1] - 1, 1)));
  }
  function readJSON(key, fallback) {
    try {
      var v = JSON.parse(localStorage.getItem(key) || 'null');
      return v == null ? fallback : v;
    } catch (e) { return fallback; }
  }
  function writeJSON(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) {
      UI.toast('No se pudieron guardar los datos en este navegador.');
    }
  }
  function normalizeText(s) {
    return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  }

  // ---------- Datos locales (sin cuenta) ----------
  function loadLocal() {
    var legacy = readJSON(KEYS.legacySettings, {});
    var book = readJSON(KEYS.book, null) || { budget: legacy.budget, categoryBudgets: legacy.categoryBudgets };
    var movs = readJSON(KEYS.movements, []);
    var recs = readJSON(KEYS.recurring, []);
    var goals = readJSON(KEYS.goals, []);
    return {
      book: CG.normalizeBook(book),
      movements: Array.isArray(movs) ? movs.filter(CG.isValidMovement) : [],
      recurring: Array.isArray(recs) ? recs : [],
      goals: Array.isArray(goals) ? goals : []
    };
  }

  function saveLocal() {
    if (isCloud()) return;
    var b = S.book;
    writeJSON(KEYS.book, {
      name: b.name, budget: b.budget, categoryBudgets: b.categoryBudgets,
      categories: b.categories, accounts: b.accounts
    });
    writeJSON(KEYS.movements, S.movements);
    writeJSON(KEYS.recurring, S.recurring);
    writeJSON(KEYS.goals, S.goals);
  }

  function hasLocalData(local) {
    return local.movements.length > 0 || local.recurring.length > 0 || local.goals.length > 0;
  }

  // ---------- Operaciones sobre los datos ----------
  // En la nube los cambios llegan de vuelta por los listeners; en local se
  // aplican directamente.
  function upsert(list, item) {
    var found = false;
    var out = list.map(function (x) {
      if (x.id === item.id) { found = true; return item; }
      return x;
    });
    if (!found) out.push(item);
    return out;
  }

  var D = {
    saveMovement: function (m) {
      if (isCloud()) return S.cloud.saveMovement(m);
      S.movements = upsert(S.movements, m);
      saveLocal(); render();
    },
    deleteMovement: function (id) {
      if (isCloud()) return S.cloud.deleteMovement(id);
      S.movements = S.movements.filter(function (x) { return x.id !== id; });
      saveLocal(); render();
    },
    updateBook: function (patch) {
      S.book = CG.normalizeBook(Object.assign({}, S.book, patch));
      if (isCloud()) S.cloud.updateBook(patch);
      else saveLocal();
      render();
    },
    saveRecurring: function (r) {
      S.recurring = upsert(S.recurring, r);
      if (isCloud()) S.cloud.saveRecurring(r);
      else saveLocal();
      render();
      processRecurring();
    },
    deleteRecurring: function (id) {
      S.recurring = S.recurring.filter(function (x) { return x.id !== id; });
      if (isCloud()) S.cloud.deleteRecurring(id);
      else saveLocal();
      render();
    },
    saveGoal: function (g) {
      S.goals = upsert(S.goals, g);
      if (isCloud()) S.cloud.saveGoal(g);
      else saveLocal();
      render();
    },
    deleteGoal: function (id) {
      S.goals = S.goals.filter(function (x) { return x.id !== id; });
      if (isCloud()) S.cloud.deleteGoal(id);
      else saveLocal();
      render();
    },
    addToGoal: function (id, delta) {
      S.goals = S.goals.map(function (g) {
        return g.id === id ? Object.assign({}, g, { saved: (g.saved || 0) + delta }) : g;
      });
      if (isCloud()) S.cloud.addToGoal(id, delta);
      else saveLocal();
      render();
    }
  };

  // Registra los movimientos fijos que ya tocan (hasta hoy).
  function processRecurring() {
    if (!S.ready) return;
    var due = CG.dueRecurring(S.recurring, todayISO());
    var ids = Object.keys(due.lastMonths);
    if (!ids.length) return;
    var key = S.book.id + ':' + ids.map(function (k) { return k + '@' + due.lastMonths[k]; }).join(',');
    if (key === S.lastRecurringKey) return;
    S.lastRecurringKey = key;

    var existing = {};
    S.movements.forEach(function (m) { existing[m.id] = true; });
    var fresh = due.movements.filter(function (m) { return !existing[m.id]; });

    S.recurring = S.recurring.map(function (r) {
      return due.lastMonths[r.id] ? Object.assign({}, r, { lastMonth: due.lastMonths[r.id] }) : r;
    });
    if (isCloud()) {
      S.cloud.applyRecurring(fresh, due.lastMonths);
    } else {
      S.movements = S.movements.concat(fresh);
      saveLocal();
      render();
    }
    if (fresh.length) {
      UI.toast(fresh.length === 1 ? 'Se registró 1 movimiento fijo' : 'Se registraron ' + fresh.length + ' movimientos fijos');
    }
  }

  // ---------- Consultas ----------
  function categoryOf(m) {
    var cats = S.book.categories;
    for (var i = 0; i < cats.length; i++) if (cats[i].id === m.category) return cats[i];
    for (var j = 0; j < cats.length; j++) if (cats[j].id === 'otros') return cats[j];
    return { id: 'otros', name: 'Otros', icon: '📦', color: '#8d99ae', kind: 'ambos' };
  }

  function accountById(id) {
    var accs = S.book.accounts;
    for (var i = 0; i < accs.length; i++) if (accs[i].id === id) return accs[i];
    return accs[0];
  }

  function categoriesFor(type) {
    return S.book.categories.filter(function (c) {
      return c.kind === 'ambos' || c.kind === type;
    });
  }

  function hasManyAccounts() { return S.book.accounts.length > 1; }
  function isShared() { return S.book.members.length > 1; }

  function memberName(uid) {
    var info = S.book.memberInfo[uid];
    if (!info) return '';
    return (info.name || info.email || '').split(' ')[0];
  }

  function sortByDateDesc(a, b) {
    if (a.date !== b.date) return a.date < b.date ? 1 : -1;
    return (b.createdAt || 0) - (a.createdAt || 0);
  }

  function movementsOfMonth(key) {
    return S.movements.filter(function (m) { return m.date.slice(0, 7) === key; }).sort(sortByDateDesc);
  }

  function applyFilters(list) {
    var f = S.filters;
    var q = normalizeText(f.text.trim());
    return list.filter(function (m) {
      if (f.type !== 'todos' && m.type !== f.type) return false;
      if (f.category !== 'todas' && (m.type === 'transferencia' || categoryOf(m).id !== f.category)) return false;
      if (f.account !== 'todas') {
        var inAcc = accountById(m.account).id === f.account ||
          (m.type === 'transferencia' && accountById(m.toAccount).id === f.account);
        if (!inAcc) return false;
      }
      if (q) {
        var hay = normalizeText((m.note || '') + ' ' + (m.type === 'transferencia' ? 'transferencia' : categoryOf(m).name));
        if (hay.indexOf(q) === -1) return false;
      }
      return true;
    });
  }

  function isFiltering() {
    var f = S.filters;
    return f.type !== 'todos' || f.category !== 'todas' || f.account !== 'todas' || f.text.trim() !== '';
  }

  function friendlyError(err) {
    var code = (err && err.code) || '';
    if (code === 'auth/unauthorized-domain') return 'Este sitio no está autorizado en Firebase. Agrégalo en Authentication → Configuración → Dominios autorizados.';
    if (code === 'auth/network-request-failed' || code === 'unavailable') return 'Sin conexión a internet. Inténtalo de nuevo.';
    if (code === 'permission-denied') return 'Firebase rechazó el cambio. Revisa que las reglas de Firestore estén actualizadas (ver README).';
    if (code === 'auth/operation-not-allowed') return 'El inicio de sesión con Google no está activado en Firebase.';
    if (code === 'book-removed') return 'Ya no eres miembro de ese libro compartido.';
    return 'Ocurrió un error' + (code ? ' (' + code + ')' : '') + '. Inténtalo de nuevo.';
  }

  // ---------- Vistas ----------
  function setView(name) {
    S.view = name;
    Array.prototype.forEach.call(document.querySelectorAll('.view'), function (v) {
      v.hidden = v.getAttribute('data-view') !== name;
    });
    Array.prototype.forEach.call($('tabbar').children, function (b) {
      var active = b.getAttribute('data-tab') === name;
      b.classList.toggle('active', active);
      if (active) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
    });
    $('fab').hidden = name !== 'inicio' || $('main').hidden;
    window.scrollTo(0, 0);
    render();
  }

  function showLoading(on, text) {
    $('loading').hidden = !on;
    $('loading-text').textContent = text || 'Cargando…';
    $('main').hidden = on;
    $('tabbar').hidden = on;
    $('fab').hidden = on || S.view !== 'inicio';
  }

  function render() {
    renderHeader();
    renderBanner();
    if (S.view === 'inicio') renderInicio();
    else if (S.view === 'resumen') renderResumen();
    else if (S.view === 'metas') renderMetas();
    else if (S.view === 'ajustes') renderAjustes();
    renderFooter();
  }

  function avatarInto(node, info) {
    node.innerHTML = '';
    if (info && info.photo) {
      var img = document.createElement('img');
      img.src = info.photo;
      img.alt = '';
      img.referrerPolicy = 'no-referrer';
      node.appendChild(img);
    } else if (info) {
      node.textContent = (info.name || info.email || '?').charAt(0).toUpperCase();
    } else {
      node.textContent = '⚙️';
    }
  }

  function renderHeader() {
    avatarInto($('account-avatar'), S.user);
    $('account-btn').setAttribute('aria-label', S.user ? 'Ajustes de ' + (S.user.name || S.user.email) : 'Ajustes');
    var label = $('book-label');
    var show = isCloud() && (S.books.length > 1 || isShared());
    label.hidden = !show;
    if (show) label.textContent = '📒 ' + S.book.name + (isShared() ? ' · compartido' : '') + ' ▾';
  }

  function renderBanner() {
    var invite = pendingInvite();
    var banner = $('signin-banner');
    banner.hidden = !(firebaseConfig && !S.user);
    if (banner.hidden) return;
    var failed = !S.cloud && S.cloudFailed;
    $('signin-title').textContent = failed ? 'No se pudo conectar con el inicio de sesión'
      : invite ? 'Te invitaron a unas finanzas compartidas' : 'Guarda tus datos en tu cuenta';
    $('signin-text').textContent = failed
      ? 'Revisa tu conexión a internet y pulsa Reintentar. Si sigue igual, recarga la página con Ctrl + F5.'
      : invite ? 'Entra con tu cuenta de Google para unirte.'
      : 'Inicia sesión con Google para no perder tus movimientos y verlos en el celular y en la computadora.';
    $('signin-btn').hidden = failed;
    $('retry-btn').hidden = !failed;
  }

  function syncText() {
    if (!S.sync) return '';
    if (S.sync.pending && S.sync.fromCache) return '📴 Sin conexión: los cambios se subirán al reconectar.';
    if (S.sync.pending) return '⏳ Guardando cambios…';
    if (S.sync.fromCache) return '📴 Sin conexión.';
    return '☁️ Todo guardado.';
  }

  function renderFooter() {
    var note;
    if (isCloud()) note = (S.user.email || S.user.name) + ' · ' + syncText();
    else if (firebaseConfig) note = 'Sin sesión: los datos se guardan solo en este navegador.';
    else note = 'Tus datos se guardan solo en este navegador.';
    $('footer-note').textContent = note;
  }

  // ----- Inicio -----
  function cmpText(cur, prev, higherIsGood) {
    if (!prev) return { text: '', cls: '' };
    var pct = Math.round((cur - prev) / prev * 100);
    if (pct === 0) return { text: '= que el mes anterior', cls: 'same' };
    var up = pct > 0;
    return {
      text: (up ? '▲ ' : '▼ ') + Math.abs(pct) + '% vs mes anterior',
      cls: up === higherIsGood ? 'good' : 'bad'
    };
  }

  function renderInicio() {
    var key = viewMonthKey();
    var prevKey = CG.addMonths(key, -1);
    var monthList = movementsOfMonth(key);
    var prevList = movementsOfMonth(prevKey);

    $('month-name').textContent = monthName(key);
    $('today-month').hidden = key === currentMonthKey();

    // Saldo y comparación con el mes anterior
    var t = CG.totalsOf(monthList);
    var p = CG.totalsOf(prevList);
    var balance = t.income - t.expense;
    $('total-income').textContent = CG.formatMoney(t.income);
    $('total-expense').textContent = CG.formatMoney(t.expense);
    $('total-balance').textContent = CG.formatMoney(balance);
    $('total-balance').className = 'hero-value ' + (balance < 0 ? 'expense' : balance > 0 ? 'income' : '');
    [['cmp-income', t.income, p.income, true], ['cmp-expense', t.expense, p.expense, false]].forEach(function (c) {
      var r = cmpText(c[1], c[2], c[3]);
      $(c[0]).textContent = r.text;
      $(c[0]).className = 'cmp ' + r.cls;
    });

    renderAccountStrip();
    renderBudget(t.expense);
    renderUpcoming(key);
    renderChart(monthList, prevList);
    renderList(monthList);
  }

  function renderAccountStrip() {
    var card = $('accounts-card');
    card.hidden = !hasManyAccounts();
    if (card.hidden) return;
    var bal = CG.accountBalances(S.book, S.movements, todayISO());
    var strip = $('account-strip');
    strip.innerHTML = '';
    S.book.accounts.forEach(function (a) {
      var on = S.filters.account === a.id;
      var b = button('account-chip' + (on ? ' active' : ''), null, function () {
        S.filters.account = on ? 'todas' : a.id;
        render();
      });
      b.style.setProperty('--acc-color', a.color);
      b.appendChild(el('span', 'acc-name', a.icon + ' ' + a.name));
      b.appendChild(el('span', 'acc-bal' + (bal[a.id] < 0 ? ' expense' : ''), CG.formatMoney(bal[a.id])));
      b.setAttribute('aria-pressed', on ? 'true' : 'false');
      strip.appendChild(b);
    });
  }

  function renderBudget(spent) {
    var budget = S.book.budget;
    $('budget-body').hidden = !budget;
    $('budget-empty').hidden = !!budget;
    if (!budget) return;
    var ratio = spent / budget;
    var bar = $('budget-bar');
    bar.style.width = Math.min(ratio * 100, 100) + '%';
    bar.parentNode.className = 'progress' + (ratio > 1 ? ' over' : ratio >= 0.8 ? ' warn' : '');

    var text = $('budget-text');
    text.innerHTML = '';
    text.appendChild(document.createTextNode('Gastaste ' + CG.formatMoney(spent) + ' de ' + CG.formatMoney(budget) + '. '));
    var remaining = budget - spent;
    if (remaining >= 0) {
      text.appendChild(el('strong', null, 'Te quedan ' + CG.formatMoney(remaining)));
      if (viewMonthKey() === currentMonthKey()) {
        var daysLeft = CG.lastDayOfMonth(currentMonthKey()) - new Date().getDate() + 1;
        text.appendChild(document.createTextNode(' (unos ' + CG.formatMoney(Math.floor(remaining / daysLeft)) + ' por día).'));
      } else {
        text.appendChild(document.createTextNode('.'));
      }
    } else {
      text.appendChild(el('strong', 'over', 'Te pasaste por ' + CG.formatMoney(-remaining) + '.'));
    }
  }

  function renderUpcoming(key) {
    var card = $('upcoming-card');
    var items = key >= currentMonthKey() ? CG.upcomingRecurring(S.recurring, key) : [];
    card.hidden = !items.length;
    if (!items.length) return;
    $('upcoming-title').textContent = key === currentMonthKey() ? 'Próximos fijos este mes' : 'Fijos programados';
    var list = $('upcoming-list');
    list.innerHTML = '';
    items.forEach(function (it) {
      list.appendChild(recurringRow(it.r, 'El ' + dayShort.format(CG.parseISODate(it.date))));
    });
  }

  function renderChart(list, prevList) {
    var totals = {}, prevTotals = {}, total = 0;
    list.forEach(function (m) {
      if (m.type !== 'gasto') return;
      var c = categoryOf(m).id;
      totals[c] = (totals[c] || 0) + m.amount;
      total += m.amount;
    });
    prevList.forEach(function (m) {
      if (m.type !== 'gasto') return;
      var c = categoryOf(m).id;
      prevTotals[c] = (prevTotals[c] || 0) + m.amount;
    });

    var legend = $('chart-legend');
    legend.innerHTML = '';
    var hasData = total > 0;
    $('chart-empty').hidden = hasData;
    $('chart-wrap').hidden = !hasData;
    if (!hasData) { $('chart').innerHTML = ''; return; }

    var data = S.book.categories
      .map(function (c) { return { cat: c, value: totals[c.id] || 0 }; })
      .filter(function (d) { return d.value > 0; })
      .sort(function (a, b) { return b.value - a.value; });

    UI.donut($('chart'), data.map(function (d) {
      return { label: d.cat.name, value: d.value, color: d.cat.color };
    }), 'Total gastos', CG.formatMoney(total));

    data.forEach(function (d) {
      var pct = d.value / total * 100;
      var limit = S.book.categoryBudgets[d.cat.id];
      var li = el('li');
      var swatch = el('span', 'swatch');
      swatch.style.background = d.cat.color;
      li.appendChild(swatch);
      li.appendChild(el('span', null, d.cat.icon + ' ' + d.cat.name));
      var amount = el('span', 'amount', CG.formatMoney(d.value));
      amount.appendChild(el('span', 'pct', Math.round(pct) + '%'));
      li.appendChild(amount);
      var bar = el('span', 'bar');
      var fill = el('span');
      fill.style.width = (limit ? Math.min(d.value / limit * 100, 100) : pct) + '%';
      fill.style.background = limit && d.value > limit ? 'var(--danger)' : d.cat.color;
      bar.appendChild(fill);
      li.appendChild(bar);

      var prev = prevTotals[d.cat.id] || 0;
      if (prev && d.value !== prev) {
        var diff = d.value - prev;
        li.appendChild(el('span', 'limit ' + (diff > 0 ? 'bad' : 'good'),
          (diff > 0 ? '▲ ' : '▼ ') + CG.formatMoney(Math.abs(diff)) + ' vs mes anterior'));
      }
      if (limit) {
        var over = d.value > limit;
        li.appendChild(el('span', 'limit' + (over ? ' bad strong' : ''),
          over ? 'Te pasaste por ' + CG.formatMoney(d.value - limit) + ' (presupuesto ' + CG.formatMoney(limit) + ')'
               : 'Presupuesto ' + CG.formatMoney(limit) + ' · quedan ' + CG.formatMoney(limit - d.value)));
      }
      legend.appendChild(li);
    });
  }

  function renderFilters() {
    var types = [['todos', 'Todos'], ['gasto', 'Gastos'], ['ingreso', 'Ingresos']];
    if (hasManyAccounts() || S.movements.some(function (m) { return m.type === 'transferencia'; })) {
      types.push(['transferencia', 'Transferencias']);
    }
    var tc = $('type-chips');
    var key = types.map(function (t) { return t[0]; }).join();
    if (tc.getAttribute('data-key') !== key) {
      tc.innerHTML = '';
      types.forEach(function (t) {
        var b = button('chip', t[1]);
        b.setAttribute('data-type', t[0]);
        tc.appendChild(b);
      });
      tc.setAttribute('data-key', key);
    }
    if (!types.some(function (t) { return t[0] === S.filters.type; })) S.filters.type = 'todos';
    Array.prototype.forEach.call(tc.children, function (b) {
      var on = b.getAttribute('data-type') === S.filters.type;
      b.classList.toggle('active', on);
      b.setAttribute('aria-pressed', on ? 'true' : 'false');
    });

    var cc = $('category-chips');
    var cats = [{ id: 'todas', name: 'Todas', icon: '' }].concat(S.book.categories);
    var ckey = cats.map(function (c) { return c.id + c.name + c.icon; }).join();
    if (cc.getAttribute('data-key') !== ckey) {
      cc.innerHTML = '';
      cats.forEach(function (c) {
        var b = button('chip', (c.icon ? c.icon + ' ' : '') + c.name);
        b.setAttribute('data-category', c.id);
        cc.appendChild(b);
      });
      cc.setAttribute('data-key', ckey);
    }
    if (S.filters.category !== 'todas' && !S.book.categories.some(function (c) { return c.id === S.filters.category; })) S.filters.category = 'todas';
    Array.prototype.forEach.call(cc.children, function (b) {
      var on = b.getAttribute('data-category') === S.filters.category;
      b.classList.toggle('active', on);
      b.setAttribute('aria-pressed', on ? 'true' : 'false');
    });

    $('account-filter-wrap').hidden = !hasManyAccounts();
    var sel = $('account-filter');
    sel.innerHTML = '';
    [{ id: 'todas', name: 'Todas', icon: '' }].concat(S.book.accounts).forEach(function (a) {
      var o = el('option', null, (a.icon ? a.icon + ' ' : '') + a.name);
      o.value = a.id;
      sel.appendChild(o);
    });
    if (S.filters.account !== 'todas' && !S.book.accounts.some(function (a) { return a.id === S.filters.account; })) S.filters.account = 'todas';
    sel.value = S.filters.account;
  }

  function dayLabel(iso) {
    var today = new Date();
    var y = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1);
    if (iso === CG.toISODate(today)) return 'Hoy';
    if (iso === CG.toISODate(y)) return 'Ayer';
    return capitalize(dayFormat.format(CG.parseISODate(iso)));
  }

  function renderList(monthList) {
    renderFilters();
    var list = applyFilters(monthList);
    var box = $('movement-list');
    box.innerHTML = '';

    var summary = $('filter-summary');
    if (isFiltering() && monthList.length) {
      var t = CG.totalsOf(list);
      var parts = [list.length + (list.length === 1 ? ' movimiento' : ' movimientos')];
      if (t.expense) parts.push('gastos ' + CG.formatMoney(t.expense));
      if (t.income) parts.push('ingresos ' + CG.formatMoney(t.income));
      summary.textContent = parts.join(' · ');
      summary.hidden = false;
    } else {
      summary.hidden = true;
    }

    $('list-empty').hidden = list.length > 0;
    $('list-empty-text').textContent = monthList.length ? 'Ningún movimiento coincide con la búsqueda.' : 'No hay movimientos en este mes.';
    $('list-empty').querySelector('button').hidden = monthList.length > 0;

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
      var t = CG.totalsOf(g.items);
      var net = t.income - t.expense;
      if (net) head.appendChild(el('span', null, (net > 0 ? '+' : '') + CG.formatMoney(net)));
      group.appendChild(head);
      g.items.forEach(function (m) { group.appendChild(movementRow(m)); });
      box.appendChild(group);
    });
  }

  function movementRow(m) {
    var item = button('movement');
    item.setAttribute('data-id', m.id);
    var icon, title, sub = [], amountText, amountCls;
    if (m.type === 'transferencia') {
      var from = accountById(m.account), to = accountById(m.toAccount);
      icon = el('span', 'icon', '↔️');
      icon.style.background = 'var(--surface-2)';
      title = m.note || 'Transferencia';
      sub.push(from.name + ' → ' + to.name);
      amountText = CG.formatMoney(m.amount);
      amountCls = 'neutral';
    } else {
      var cat = categoryOf(m);
      icon = el('span', 'icon', cat.icon);
      icon.style.background = cat.color + '33';
      title = m.note || cat.name;
      sub.push(m.type === 'ingreso' ? cat.name + ' · Ingreso' : cat.name);
      if (hasManyAccounts()) sub.push(accountById(m.account).name);
      amountText = (m.type === 'ingreso' ? '+' : '−') + CG.formatMoney(m.amount);
      amountCls = m.type === 'ingreso' ? 'income' : 'expense';
    }
    if (m.recurringId) sub.push('🔁 fijo');
    if (isShared() && m.createdBy) {
      var who = memberName(m.createdBy);
      if (who) sub.push(who);
    }
    icon.setAttribute('aria-hidden', 'true');
    item.appendChild(icon);
    var info = el('span', 'info');
    info.appendChild(el('span', 'title', title));
    info.appendChild(el('span', 'note', sub.join(' · ')));
    item.appendChild(info);
    item.appendChild(el('span', 'amount ' + amountCls, amountText));
    item.setAttribute('aria-label', 'Editar: ' + title + ', ' + amountText);
    return item;
  }

  // ----- Resumen anual -----
  function renderResumen() {
    var year = S.summaryYear;
    $('year-name').textContent = String(year);
    $('next-year').disabled = year >= new Date().getFullYear() + 1;

    var months = [];
    for (var i = 0; i < 12; i++) {
      var key = CG.monthKey(year, i);
      var t = CG.totalsOf(S.movements.filter(function (m) { return m.date.slice(0, 7) === key; }));
      months.push({
        key: key,
        label: capitalize(monthShort.format(new Date(year, i, 1))).replace('.', '').slice(0, 3),
        full: monthName(key),
        income: t.income,
        expense: t.expense
      });
    }
    var inc = months.reduce(function (s, m) { return s + m.income; }, 0);
    var exp = months.reduce(function (s, m) { return s + m.expense; }, 0);
    var saved = inc - exp;
    var activeMonths = months.filter(function (m) { return m.income || m.expense; }).length;

    var stats = $('year-stats');
    stats.innerHTML = '';
    var totalsCard = el('div', 'card stat totals');
    [['Ingresos', CG.formatMoney(inc), 'income'], ['Gastos', CG.formatMoney(exp), 'expense'],
     ['Ahorro', CG.formatMoney(saved), saved < 0 ? 'expense' : 'income']].forEach(function (r) {
      var row = el('div', 'total-row');
      row.appendChild(el('span', 'mini-label', r[0]));
      row.appendChild(el('span', 'stat-value ' + r[2], r[1]));
      totalsCard.appendChild(row);
    });
    stats.appendChild(totalsCard);
    [
      ['Ahorraste', inc ? Math.round(saved / inc * 100) + '%' : '—', 'de tus ingresos'],
      ['Gasto promedio', activeMonths ? CG.formatMoney(Math.round(exp / activeMonths)) : '—', 'al mes']
    ].forEach(function (s) {
      var tile = el('div', 'card stat');
      tile.appendChild(el('span', 'mini-label', s[0]));
      tile.appendChild(el('span', 'stat-value', s[1]));
      tile.appendChild(el('span', 'mini-label', s[2]));
      stats.appendChild(tile);
    });

    UI.monthBars($('year-bars'), months, function (i) {
      S.year = year;
      S.month = i;
      setView('inicio');
    });

    // Tabla mes a mes (también es la alternativa accesible al gráfico).
    var table = $('year-table');
    table.innerHTML = '';
    var thead = el('thead');
    var hr = el('tr');
    ['Mes', 'Ingresos', 'Gastos', 'Ahorro'].forEach(function (h) { hr.appendChild(el('th', null, h)); });
    thead.appendChild(hr);
    table.appendChild(thead);
    var tbody = el('tbody');
    months.forEach(function (m, i) {
      if (!m.income && !m.expense) return;
      var tr = el('tr', 'clickable');
      tr.tabIndex = 0;
      tr.appendChild(el('td', null, capitalize(monthLong.format(new Date(year, i, 1)))));
      tr.appendChild(el('td', 'num', CG.formatMoney(m.income)));
      tr.appendChild(el('td', 'num', CG.formatMoney(m.expense)));
      tr.appendChild(el('td', 'num ' + (m.income - m.expense < 0 ? 'expense' : 'income'), CG.formatMoney(m.income - m.expense)));
      var go = function () { S.year = year; S.month = i; setView('inicio'); };
      tr.addEventListener('click', go);
      tr.addEventListener('keydown', function (e) { if (e.key === 'Enter') go(); });
      tbody.appendChild(tr);
    });
    if (!tbody.children.length) {
      var tr = el('tr');
      var td = el('td', 'muted', 'Sin movimientos este año.');
      td.colSpan = 4;
      tr.appendChild(td);
      tbody.appendChild(tr);
    }
    table.appendChild(tbody);
    var tfoot = el('tfoot');
    var fr = el('tr');
    fr.appendChild(el('td', null, 'Total'));
    fr.appendChild(el('td', 'num', CG.formatMoney(inc)));
    fr.appendChild(el('td', 'num', CG.formatMoney(exp)));
    fr.appendChild(el('td', 'num', CG.formatMoney(saved)));
    tfoot.appendChild(fr);
    table.appendChild(tfoot);

    // En qué se gastó durante el año
    var totals = {};
    S.movements.forEach(function (m) {
      if (m.type !== 'gasto' || m.date.slice(0, 4) !== String(year)) return;
      var c = categoryOf(m).id;
      totals[c] = (totals[c] || 0) + m.amount;
    });
    var data = S.book.categories.map(function (c) { return { cat: c, value: totals[c.id] || 0 }; })
      .filter(function (d) { return d.value > 0; })
      .sort(function (a, b) { return b.value - a.value; });
    var ul = $('year-cats');
    ul.innerHTML = '';
    $('year-cats-empty').hidden = data.length > 0;
    data.forEach(function (d) {
      var li = el('li');
      var sw = el('span', 'swatch');
      sw.style.background = d.cat.color;
      li.appendChild(sw);
      li.appendChild(el('span', null, d.cat.icon + ' ' + d.cat.name));
      var amount = el('span', 'amount', CG.formatMoney(d.value));
      amount.appendChild(el('span', 'pct', Math.round(d.value / exp * 100) + '%'));
      li.appendChild(amount);
      var bar = el('span', 'bar');
      var fill = el('span');
      fill.style.width = (d.value / data[0].value * 100) + '%';
      fill.style.background = d.cat.color;
      bar.appendChild(fill);
      li.appendChild(bar);
      if (activeMonths) li.appendChild(el('span', 'limit', 'Promedio ' + CG.formatMoney(Math.round(d.value / activeMonths)) + ' al mes'));
      ul.appendChild(li);
    });
  }

  // ----- Metas -----
  function monthsBetween(fromKey, toKey) {
    var a = fromKey.split('-'), b = toKey.split('-');
    return (+b[0] - +a[0]) * 12 + (+b[1] - +a[1]) + 1;
  }

  function renderMetas() {
    var box = $('goal-list');
    box.innerHTML = '';
    var goals = S.goals.slice().sort(function (a, b) { return (a.createdAt || 0) - (b.createdAt || 0); });
    if (!goals.length) {
      box.appendChild(el('p', 'empty', 'Todavía no tienes metas. ¡Crea la primera!'));
      return;
    }
    goals.forEach(function (g) {
      var saved = g.saved || 0;
      var pct = g.target ? Math.max(0, Math.min(saved / g.target, 1)) : 0;
      var done = saved >= g.target;
      var card = el('section', 'card goal' + (done ? ' done' : ''));
      card.style.setProperty('--goal-color', g.color || '#1baf7a');

      var head = el('div', 'goal-head');
      var ic = el('span', 'goal-icon', g.icon || '🎯');
      ic.setAttribute('aria-hidden', 'true');
      head.appendChild(ic);
      var title = el('div', 'goal-title');
      title.appendChild(el('strong', null, g.name));
      title.appendChild(el('span', 'muted small', CG.formatMoney(saved) + ' de ' + CG.formatMoney(g.target)));
      head.appendChild(title);
      var edit = button('icon-btn small', '✎', function () { editGoal(g); });
      edit.setAttribute('aria-label', 'Editar meta ' + g.name);
      head.appendChild(edit);
      card.appendChild(head);

      var prog = el('div', 'progress goal-bar');
      prog.setAttribute('role', 'progressbar');
      prog.setAttribute('aria-label', 'Progreso de ' + g.name);
      prog.setAttribute('aria-valuenow', Math.round(pct * 100));
      prog.setAttribute('aria-valuemin', '0');
      prog.setAttribute('aria-valuemax', '100');
      var fill = el('span');
      fill.style.width = (pct * 100) + '%';
      prog.appendChild(fill);
      card.appendChild(prog);

      var info = el('p', 'goal-info');
      if (done) {
        info.textContent = '🎉 ¡Meta cumplida! (' + Math.round(saved / g.target * 100) + '%)';
      } else {
        var remaining = g.target - saved;
        var text = Math.round(pct * 100) + '% · faltan ' + CG.formatMoney(remaining);
        if (g.deadline) {
          var left = monthsBetween(currentMonthKey(), g.deadline);
          text += left >= 1
            ? ' · ' + CG.formatMoney(Math.ceil(remaining / left)) + ' al mes hasta ' + monthName(g.deadline).toLowerCase()
            : ' · la fecha límite (' + monthName(g.deadline).toLowerCase() + ') ya pasó';
        }
        info.textContent = text;
      }
      card.appendChild(info);

      var actions = el('div', 'button-row');
      actions.appendChild(button('btn small', '+ Aportar', function () { contribute(g, 1); }));
      actions.appendChild(button('btn small ghost', '− Retirar', function () { contribute(g, -1); }));
      card.appendChild(actions);
      box.appendChild(card);
    });
  }

  // ----- Ajustes -----
  function renderAjustes() {
    renderAccountInfo();
    renderShareInfo();

    var cats = Object.keys(S.book.categoryBudgets).length;
    $('budget-summary').textContent = S.book.budget
      ? 'Total: ' + CG.formatMoney(S.book.budget) + ' al mes' + (cats ? ' · ' + cats + (cats === 1 ? ' categoría con límite' : ' categorías con límite') : '')
      : 'Sin presupuesto definido.';

    var cr = $('category-rows');
    cr.innerHTML = '';
    S.book.categories.forEach(function (c) {
      var kind = c.kind === 'gasto' ? 'Gastos' : c.kind === 'ingreso' ? 'Ingresos' : 'Gastos e ingresos';
      cr.appendChild(settingsRow(c.icon, c.color, c.name, kind, '', function () { editCategory(c); }));
    });

    var ar = $('account-rows');
    ar.innerHTML = '';
    var bal = CG.accountBalances(S.book, S.movements, todayISO());
    S.book.accounts.forEach(function (a) {
      var row = settingsRow(a.icon, a.color, a.name, 'Saldo a hoy', CG.formatMoney(bal[a.id]), function () { editAccount(a); });
      if (bal[a.id] < 0) row.querySelector('.amount').classList.add('expense');
      ar.appendChild(row);
    });

    var rr = $('recurring-rows');
    rr.innerHTML = '';
    var recs = S.recurring.slice().sort(function (a, b) { return (a.day || 0) - (b.day || 0); });
    if (!recs.length) rr.appendChild(el('p', 'muted small', 'Aún no tienes movimientos fijos.'));
    recs.forEach(function (r) {
      rr.appendChild(recurringRow(r, 'Día ' + r.day + ' de cada mes' + (r.active === false ? ' · pausado' : '')));
    });

    renderInstall();
  }

  function settingsRow(icon, color, title, sub, right, onClick) {
    var row = button('row');
    var ic = el('span', 'icon', icon);
    ic.style.background = color + '33';
    ic.setAttribute('aria-hidden', 'true');
    row.appendChild(ic);
    var info = el('span', 'info');
    info.appendChild(el('span', 'title', title));
    if (sub) info.appendChild(el('span', 'note', sub));
    row.appendChild(info);
    row.appendChild(el('span', 'amount', right || '›'));
    row.addEventListener('click', onClick);
    return row;
  }

  function recurringRow(r, subText) {
    var title, icon, color, amountText, cls;
    if (r.type === 'transferencia') {
      icon = '↔️'; color = '#8d99ae';
      title = r.note || (accountById(r.account).name + ' → ' + accountById(r.toAccount).name);
      amountText = CG.formatMoney(r.amount); cls = 'neutral';
    } else {
      var cat = categoryOf(r);
      icon = cat.icon; color = cat.color;
      title = r.note || cat.name;
      amountText = (r.type === 'ingreso' ? '+' : '−') + CG.formatMoney(r.amount);
      cls = r.type === 'ingreso' ? 'income' : 'expense';
    }
    var row = settingsRow(icon, color, title, subText, amountText, function () { editRecurring(r); });
    row.querySelector('.amount').className = 'amount ' + cls;
    if (r.active === false) row.classList.add('paused');
    return row;
  }

  function renderAccountInfo() {
    var box = $('account-info');
    box.innerHTML = '';
    if (!firebaseConfig) {
      box.appendChild(el('p', 'muted', 'Las cuentas de usuario no están activadas. Tus datos se guardan solo en este navegador.'));
      return;
    }
    if (!S.cloud) {
      box.appendChild(el('p', 'muted', 'No se pudo conectar con el servicio de cuentas. Por ahora los datos se guardan en este navegador.'));
      box.appendChild(button('btn block', 'Reintentar', function () { location.reload(); }));
      return;
    }
    if (!S.user) {
      box.appendChild(el('p', 'muted', 'Inicia sesión para guardar tus datos en tu cuenta y verlos en todos tus dispositivos.'));
      box.appendChild(googleButton());
      return;
    }
    var row = el('div', 'account-row');
    var av = el('span', 'avatar');
    avatarInto(av, S.user);
    row.appendChild(av);
    var who = el('div');
    who.appendChild(el('strong', null, S.user.name || 'Usuario'));
    who.appendChild(el('small', null, S.user.email));
    row.appendChild(who);
    box.appendChild(row);
    box.appendChild(el('p', 'sync-status', syncText()));
    var out = button('btn ghost block', 'Cerrar sesión');
    out.setAttribute('data-action', 'signout');
    box.appendChild(out);
  }

  function googleButton() {
    var btn = button('btn google block');
    btn.setAttribute('data-action', 'signin');
    btn.appendChild(el('span', 'g-logo', 'G'));
    btn.appendChild(document.createTextNode(' Entrar con Google'));
    return btn;
  }

  function renderShareInfo() {
    var box = $('share-info');
    box.innerHTML = '';
    if (!firebaseConfig || !S.cloud) {
      box.appendChild(el('p', 'muted', 'Para compartir tus finanzas hace falta tener activadas las cuentas de usuario.'));
      return;
    }
    if (!S.user) {
      box.appendChild(el('p', 'muted', 'Inicia sesión con Google para llevar las finanzas junto con tu pareja o tu familia, cada uno desde su propia cuenta.'));
      return;
    }
    var b = S.book;
    var isOwner = b.owner === S.user.uid;

    if (S.books.length > 1) {
      var lab = el('label', 'field');
      lab.appendChild(el('span', null, 'Libro que estás viendo'));
      var sel = el('select');
      S.books.slice().sort(function (x, y) {
        if (x.id === S.user.uid) return -1;
        if (y.id === S.user.uid) return 1;
        return x.name < y.name ? -1 : 1;
      }).forEach(function (bk) {
        var o = el('option', null, bk.name + (bk.members > 1 ? ' (compartido)' : ''));
        o.value = bk.id;
        sel.appendChild(o);
      });
      sel.value = b.id;
      sel.addEventListener('change', function () { switchBook(sel.value); });
      lab.appendChild(sel);
      box.appendChild(lab);
    }

    var nameRow = el('div', 'card-head');
    nameRow.appendChild(el('strong', null, '📒 ' + b.name));
    nameRow.appendChild(button('link-btn', 'Cambiar nombre', editBookName));
    box.appendChild(nameRow);

    box.appendChild(el('p', 'muted small', isShared()
      ? 'Todos los miembros ven y pueden editar los movimientos, presupuestos, cuentas y metas de este libro.'
      : 'Invita a alguien para llevar este libro en conjunto. Cada uno entra con su propia cuenta de Google.'));

    var list = el('div', 'rows');
    b.members.forEach(function (uid) {
      var info = b.memberInfo[uid] || {};
      var row = el('div', 'row static');
      var av = el('span', 'avatar small');
      avatarInto(av, info.name || info.email || info.photo ? info : { name: '?' });
      row.appendChild(av);
      var txt = el('span', 'info');
      txt.appendChild(el('span', 'title', (info.name || info.email || 'Miembro') + (uid === S.user.uid ? ' (tú)' : '')));
      txt.appendChild(el('span', 'note', (uid === b.owner ? 'Dueño · ' : '') + (info.email || '')));
      row.appendChild(txt);
      if (isOwner && uid !== S.user.uid) {
        row.appendChild(button('btn small danger ghost', 'Quitar', function () {
          UI.confirm({
            title: '¿Quitar a ' + (info.name || info.email || 'este miembro') + '?',
            text: 'Ya no podrá ver ni editar este libro. Los movimientos que registró se conservan.',
            confirmLabel: 'Quitar', danger: true,
            onConfirm: function () { S.cloud.removeMember(uid); }
          });
        }));
      }
      list.appendChild(row);
    });
    box.appendChild(list);

    var actions = el('div', 'button-row');
    actions.appendChild(button('btn', '+ Invitar a alguien', invite));
    if (!isOwner) {
      actions.appendChild(button('btn danger ghost', 'Salir de este libro', function () {
        UI.confirm({
          title: '¿Salir de «' + b.name + '»?',
          text: 'Dejarás de ver este libro. Para volver necesitarás una nueva invitación.',
          confirmLabel: 'Salir', danger: true,
          onConfirm: function () {
            S.cloud.leaveBook(b.id).then(function () { UI.toast('Saliste de «' + b.name + '»'); },
              function (err) { UI.toast(friendlyError(err)); });
          }
        });
      }));
    }
    box.appendChild(actions);
  }

  function isStandalone() {
    return (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) || window.navigator.standalone === true;
  }

  function renderInstall() {
    var box = $('install-info');
    box.innerHTML = '';
    if (isStandalone()) {
      box.appendChild(el('p', 'muted', '✅ Ya estás usando la app instalada.'));
      return;
    }
    box.appendChild(el('p', 'muted small', 'Tendrás un ícono en tu pantalla de inicio y la app se abrirá a pantalla completa, más rápido y también sin conexión.'));
    if (S.installPrompt) {
      box.appendChild(button('btn block', '📲 Instalar', function () {
        var p = S.installPrompt;
        S.installPrompt = null;
        p.prompt();
        p.userChoice.then(function () { render(); });
      }));
      return;
    }
    var ios = /iphone|ipad|ipod/i.test(navigator.userAgent);
    var steps = el('ol', 'steps');
    (ios
      ? ['Abre esta página en Safari.', 'Toca el botón Compartir (el cuadrado con la flecha ↑).', 'Elige «Agregar a pantalla de inicio».']
      : ['Abre el menú del navegador (⋮ o …).', 'Elige «Instalar app» o «Agregar a pantalla de inicio».']
    ).forEach(function (s) { steps.appendChild(el('li', null, s)); });
    box.appendChild(steps);
  }

  // ---------- Hoja de movimiento ----------
  var form = $('movement-form');
  var movementSheet = $('movement-sheet');
  UI.wireDialog(movementSheet);

  function selectedType() { return form.querySelector('input[name="type"]:checked').value; }

  function fillAccountSelect(sel, value) {
    sel.innerHTML = '';
    S.book.accounts.forEach(function (a) {
      var o = el('option', null, a.icon + ' ' + a.name);
      o.value = a.id;
      sel.appendChild(o);
    });
    sel.value = accountById(value).id;
  }

  function buildCategoryGrid(type, selected) {
    var grid = $('category-grid');
    Array.prototype.slice.call(grid.querySelectorAll('.cat-option')).forEach(function (n) { grid.removeChild(n); });
    categoriesFor(type).forEach(function (c) {
      var label = el('label', 'cat-option');
      label.style.setProperty('--cat-color', c.color);
      label.style.setProperty('--cat-soft', c.color + '26');
      var input = el('input');
      input.type = 'radio';
      input.name = 'category';
      input.value = c.id;
      if (c.id === selected) input.checked = true;
      label.appendChild(input);
      var span = el('span');
      span.appendChild(el('b', null, c.icon));
      span.appendChild(document.createTextNode(c.name));
      label.appendChild(span);
      grid.appendChild(label);
    });
  }

  function updateMovementForm() {
    var type = selectedType();
    var transfer = type === 'transferencia';
    var selCat = form.querySelector('input[name="category"]:checked');
    if (!transfer) buildCategoryGrid(type, selCat ? selCat.value : null);
    $('category-grid').hidden = transfer;
    $('account-row').hidden = !hasManyAccounts();
    $('to-account-field').hidden = !transfer;
    $('account-label').textContent = transfer ? 'Desde la cuenta' : 'Cuenta';
  }

  function showFormError(msg) {
    $('form-error').textContent = msg;
    $('form-error').hidden = !msg;
  }

  function openMovementSheet(m) {
    form.reset();
    showFormError('');
    S.editingId = m ? m.id : null;
    $('sheet-title').textContent = m ? 'Editar movimiento' : 'Nuevo movimiento';
    $('submit-btn').textContent = m ? 'Guardar cambios' : 'Guardar';
    $('delete-btn').hidden = !m;
    $('type-transfer').hidden = !hasManyAccounts() && !(m && m.type === 'transferencia');
    form.querySelector('input[name="type"][value="' + (m ? m.type : 'gasto') + '"]').checked = true;
    $('amount').value = m ? CG.centsToInput(m.amount) : '';
    $('date').value = m ? m.date : (viewMonthKey() === currentMonthKey() ? todayISO() : viewMonthKey() + '-01');
    $('note').value = m ? m.note || '' : '';
    fillAccountSelect($('account'), m ? m.account : (S.filters.account !== 'todas' ? S.filters.account : null));
    fillAccountSelect($('to-account'), m && m.toAccount ? m.toAccount : (S.book.accounts[1] || S.book.accounts[0]).id);
    buildCategoryGrid(m && m.type !== 'transferencia' ? m.type : 'gasto', m && m.type !== 'transferencia' ? categoryOf(m).id : null);
    updateMovementForm();

    $('repeat-wrap').hidden = !!m;
    var rec = m && m.recurringId && S.recurring.filter(function (r) { return r.id === m.recurringId; })[0];
    var note = $('recurring-note');
    note.hidden = !(m && m.recurringId);
    note.innerHTML = '';
    if (m && m.recurringId) {
      note.appendChild(document.createTextNode('🔁 Este movimiento viene de un fijo. Los cambios aquí solo afectan a este mes. '));
      if (rec) {
        note.appendChild(button('link-btn', 'Editar el fijo', function () {
          UI.closeDialog(movementSheet);
          editRecurring(rec);
        }));
      }
    }
    UI.openDialog(movementSheet);
    if (!m) $('amount').focus();
  }

  form.addEventListener('change', function (e) {
    if (e.target.name === 'type') updateMovementForm();
  });

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    var type = selectedType();
    var amount = CG.parseAmount($('amount').value);
    var catInput = form.querySelector('input[name="category"]:checked');
    var date = $('date').value;
    var note = $('note').value.trim();
    var account = $('account').value;
    var toAccount = $('to-account').value;

    if (!(amount > 0)) { showFormError('Escribe un monto mayor que cero (ej.: 1250,50).'); $('amount').focus(); return; }
    if (type !== 'transferencia' && !catInput) { showFormError('Elige una categoría.'); return; }
    if (type === 'transferencia' && account === toAccount) { showFormError('Elige dos cuentas distintas.'); return; }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) { showFormError('Elige una fecha válida.'); $('date').focus(); return; }

    var existing = S.editingId && S.movements.filter(function (x) { return x.id === S.editingId; })[0];
    var m = {
      id: existing ? existing.id : CG.newId(),
      type: type,
      date: date,
      amount: amount,
      note: note,
      createdAt: existing ? existing.createdAt || Date.now() : Date.now()
    };
    if (existing && existing.createdBy) m.createdBy = existing.createdBy;
    if (existing && existing.recurringId) m.recurringId = existing.recurringId;
    if (type === 'transferencia') {
      m.account = account;
      m.toAccount = toAccount;
    } else {
      m.category = catInput.value;
      if (hasManyAccounts() || (existing && existing.account)) m.account = account;
    }

    if (!existing && $('repeat').checked) {
      var month = date.slice(0, 7);
      var r = {
        id: CG.newId(), type: type, amount: amount, note: note,
        day: +date.slice(8, 10), start: month, lastMonth: month, active: true, createdAt: Date.now()
      };
      if (type === 'transferencia') { r.account = account; r.toAccount = toAccount; }
      else { r.category = m.category; if (m.account) r.account = m.account; }
      m.id = 'rec-' + r.id + '-' + month;
      m.recurringId = r.id;
      D.saveRecurring(r);
    }

    var d = CG.parseISODate(date);
    S.year = d.getFullYear();
    S.month = d.getMonth();
    D.saveMovement(m);
    UI.closeDialog(movementSheet);
    render();
    UI.toast(existing ? 'Cambios guardados'
      : m.recurringId ? 'Guardado. Se repetirá cada mes el día ' + (+date.slice(8, 10))
      : type === 'gasto' ? 'Gasto guardado' : type === 'ingreso' ? 'Ingreso guardado' : 'Transferencia guardada');
    S.editingId = null;
  });

  $('delete-btn').addEventListener('click', function () {
    var m = S.movements.filter(function (x) { return x.id === S.editingId; })[0];
    UI.closeDialog(movementSheet);
    S.editingId = null;
    if (!m) return;
    D.deleteMovement(m.id);
    UI.toast('Movimiento borrado', 'Deshacer', function () { D.saveMovement(m); });
  });

  // ---------- Formularios de ajustes ----------
  function editBudget() {
    var fields = [
      { name: 'budget', type: 'money', label: 'Total para gastos del mes', value: S.book.budget, optional: true, placeholder: 'Sin presupuesto' },
      { type: 'note', text: 'Límite por categoría (opcional):' }
    ];
    categoriesFor('gasto').forEach(function (c) {
      fields.push({ name: 'cat:' + c.id, type: 'money', label: c.icon + ' ' + c.name, value: S.book.categoryBudgets[c.id] || 0, optional: true, placeholder: '—' });
    });
    UI.openForm({
      title: 'Presupuesto mensual',
      fields: fields,
      submitLabel: 'Guardar presupuesto',
      onSubmit: function (v) {
        var cb = {};
        var bad = false;
        Object.keys(v).forEach(function (k) {
          if (isNaN(v[k]) || v[k] < 0) bad = true;
          else if (k.indexOf('cat:') === 0 && v[k] > 0) cb[k.slice(4)] = v[k];
        });
        if (bad) return 'Revisa los montos (ej.: 500000 o 1.250,50).';
        D.updateBook({ budget: v.budget || 0, categoryBudgets: cb });
        UI.toast('Presupuesto guardado');
      }
    });
  }

  function editCategory(c) {
    UI.openForm({
      title: c ? 'Editar categoría' : 'Nueva categoría',
      fields: [
        { name: 'name', type: 'text', label: 'Nombre', value: c ? c.name : '', max: 30, placeholder: 'Ej.: Mascotas' },
        { name: 'kind', type: 'segmented', label: 'Se usa para', value: c ? c.kind : 'gasto',
          options: [{ value: 'gasto', label: 'Gastos' }, { value: 'ingreso', label: 'Ingresos' }, { value: 'ambos', label: 'Ambos' }],
          showIf: function () { return !c || c.id !== 'otros'; } },
        { name: 'icon', type: 'icon', label: 'Ícono', value: c ? c.icon : '🐶' },
        { name: 'color', type: 'color', label: 'Color', value: c ? c.color : CG.COLORS[S.book.categories.length % CG.COLORS.length] }
      ],
      onSubmit: function (v) {
        if (!v.name) return 'Escribe un nombre.';
        var cat = { id: c ? c.id : CG.slug(v.name), name: v.name, kind: v.kind || 'ambos', icon: v.icon, color: v.color };
        var list = c ? S.book.categories.map(function (x) { return x.id === c.id ? cat : x; }) : S.book.categories.concat([cat]);
        D.updateBook({ categories: list });
        UI.toast(c ? 'Categoría actualizada' : 'Categoría creada');
      },
      onDelete: c && c.id !== 'otros' ? function () {
        var used = S.movements.filter(function (m) { return m.category === c.id; }).length;
        UI.confirm({
          title: '¿Borrar la categoría «' + c.name + '»?',
          text: used ? 'Sus ' + used + ' movimientos se mostrarán en «Otros».' : 'No tiene movimientos.',
          confirmLabel: 'Borrar', danger: true,
          onConfirm: function () {
            var cb = Object.assign({}, S.book.categoryBudgets);
            delete cb[c.id];
            D.updateBook({ categories: S.book.categories.filter(function (x) { return x.id !== c.id; }), categoryBudgets: cb });
          }
        });
      } : null
    });
  }

  function editAccount(a) {
    UI.openForm({
      title: a ? 'Editar cuenta' : 'Nueva cuenta',
      fields: [
        { name: 'name', type: 'text', label: 'Nombre', value: a ? a.name : '', max: 30, placeholder: 'Ej.: Tarjeta Visa' },
        { name: 'initial', type: 'money', label: 'Saldo inicial', value: a ? a.initial : 0, optional: true, allowNegative: true,
          hint: 'Cuánto había al empezar a usar la app. Si es una deuda (tarjeta de crédito), escríbelo con signo menos: -150000.' },
        { name: 'icon', type: 'icon', label: 'Ícono', value: a ? a.icon : '💳' },
        { name: 'color', type: 'color', label: 'Color', value: a ? a.color : CG.COLORS[S.book.accounts.length % CG.COLORS.length] }
      ],
      onSubmit: function (v) {
        if (!v.name) return 'Escribe un nombre.';
        if (isNaN(v.initial)) return 'Revisa el saldo inicial.';
        var acc = { id: a ? a.id : CG.slug(v.name), name: v.name, icon: v.icon, color: v.color, initial: v.initial || 0 };
        var list = a ? S.book.accounts.map(function (x) { return x.id === a.id ? acc : x; }) : S.book.accounts.concat([acc]);
        D.updateBook({ accounts: list });
        UI.toast(a ? 'Cuenta actualizada' : 'Cuenta creada');
      },
      onDelete: a && S.book.accounts.length > 1 ? function () {
        var used = S.movements.filter(function (m) { return m.account === a.id || m.toAccount === a.id; }).length;
        var rest = S.book.accounts.filter(function (x) { return x.id !== a.id; });
        UI.confirm({
          title: '¿Borrar la cuenta «' + a.name + '»?',
          text: used ? 'Sus ' + used + ' movimientos pasarán a «' + rest[0].name + '».' : 'No tiene movimientos.',
          confirmLabel: 'Borrar', danger: true,
          onConfirm: function () { D.updateBook({ accounts: rest }); }
        });
      } : null
    });
  }

  function editRecurring(r) {
    var types = [{ value: 'gasto', label: 'Gasto', className: 't-gasto' }, { value: 'ingreso', label: 'Ingreso', className: 't-ingreso' }];
    if (hasManyAccounts() || (r && r.type === 'transferencia')) types.push({ value: 'transferencia', label: 'Transferencia', className: 't-transfer' });
    var accOptions = S.book.accounts.map(function (a) { return { value: a.id, label: a.icon + ' ' + a.name }; });
    function catOptions(v) {
      return categoriesFor(v.type === 'ingreso' ? 'ingreso' : 'gasto').map(function (c) { return { value: c.id, label: c.icon + ' ' + c.name }; });
    }
    UI.openForm({
      title: r ? 'Editar movimiento fijo' : 'Nuevo movimiento fijo',
      fields: [
        { name: 'type', type: 'segmented', value: r ? r.type : 'gasto', options: types, className: 'type-toggle' },
        { name: 'amount', type: 'money', label: 'Monto', value: r ? r.amount : 0 },
        { name: 'category', type: 'select', label: 'Categoría', value: r && r.type !== 'transferencia' ? categoryOf(r).id : null,
          options: catOptions({ type: r ? r.type : 'gasto' }), optionsFor: catOptions,
          showIf: function (v) { return v.type !== 'transferencia'; } },
        { name: 'account', type: 'select', label: 'Cuenta', value: r ? accountById(r.account).id : S.book.accounts[0].id, options: accOptions,
          showIf: function () { return hasManyAccounts(); } },
        { name: 'toAccount', type: 'select', label: 'Hacia la cuenta', value: r && r.toAccount ? r.toAccount : (S.book.accounts[1] || S.book.accounts[0]).id,
          options: accOptions, showIf: function (v) { return v.type === 'transferencia'; } },
        { name: 'note', type: 'text', label: 'Nota', value: r ? r.note : '', max: 200, placeholder: 'Ej.: Arriendo, Netflix, Sueldo' },
        { name: 'day', type: 'day', label: 'Día del mes', value: r ? r.day : new Date().getDate() },
        { name: 'start', type: 'month', label: 'Desde el mes', value: r ? r.start : currentMonthKey(),
          hint: r ? '' : 'Si el día ya pasó este mes, se registra de inmediato.' },
        { name: 'active', type: 'checkbox', label: 'Activo (desmárcalo para pausarlo)', value: r ? r.active !== false : true,
          showIf: function () { return !!r; } }
      ],
      onSubmit: function (v) {
        if (!(v.amount > 0)) return 'Escribe un monto mayor que cero.';
        if (v.type !== 'transferencia' && !v.category) return 'Elige una categoría.';
        if (v.type === 'transferencia' && v.account === v.toAccount) return 'Elige dos cuentas distintas.';
        if (!/^\d{4}-\d{2}$/.test(v.start || '')) return 'Elige desde qué mes.';
        var rec = {
          id: r ? r.id : CG.newId(),
          type: v.type, amount: v.amount, note: v.note || '', day: v.day, start: v.start,
          active: r ? v.active !== false : true,
          createdAt: r ? r.createdAt || Date.now() : Date.now()
        };
        // Si se mueve el inicio a un mes posterior, se genera desde ahí.
        var last = r ? r.lastMonth || null : null;
        if (last && v.start > last) last = null;
        if (last) rec.lastMonth = last;
        if (v.type === 'transferencia') { rec.account = v.account; rec.toAccount = v.toAccount; }
        else { rec.category = v.category; if (hasManyAccounts()) rec.account = v.account; }
        D.saveRecurring(rec);
        UI.toast(r ? 'Fijo actualizado' : 'Fijo creado');
      },
      onDelete: r ? function () {
        UI.confirm({
          title: '¿Borrar este movimiento fijo?',
          text: 'Ya no se registrará en los próximos meses. Los movimientos que ya se registraron se conservan.',
          confirmLabel: 'Borrar', danger: true,
          onConfirm: function () { D.deleteRecurring(r.id); }
        });
      } : null
    });
  }

  function editGoal(g) {
    UI.openForm({
      title: g ? 'Editar meta' : 'Nueva meta de ahorro',
      fields: [
        { name: 'name', type: 'text', label: 'Nombre', value: g ? g.name : '', max: 60, placeholder: 'Ej.: Viaje a la playa' },
        { name: 'target', type: 'money', label: 'Monto que quieres juntar', value: g ? g.target : 0 },
        { name: 'saved', type: 'money', label: 'Ya tienes ahorrado (opcional)', value: 0, optional: true,
          showIf: function () { return !g; } },
        { name: 'deadline', type: 'month', label: 'Fecha límite (opcional)', value: g ? g.deadline || '' : '',
          hint: 'Te diremos cuánto apartar cada mes para llegar a tiempo.' },
        { name: 'icon', type: 'icon', label: 'Ícono', value: g ? g.icon : '🏖️' },
        { name: 'color', type: 'color', label: 'Color', value: g ? g.color : CG.COLORS[(S.goals.length + 2) % CG.COLORS.length] }
      ],
      onSubmit: function (v) {
        if (!v.name) return 'Escribe un nombre.';
        if (!(v.target > 0)) return 'Escribe el monto de la meta.';
        if (!g && (isNaN(v.saved) || v.saved < 0)) return 'Revisa el monto ahorrado.';
        var goal = {
          id: g ? g.id : CG.newId(),
          name: v.name, target: v.target, icon: v.icon, color: v.color,
          saved: g ? g.saved || 0 : v.saved || 0,
          createdAt: g ? g.createdAt || Date.now() : Date.now()
        };
        if (v.deadline) goal.deadline = v.deadline;
        D.saveGoal(goal);
        UI.toast(g ? 'Meta actualizada' : 'Meta creada');
      },
      onDelete: g ? function () {
        UI.confirm({
          title: '¿Borrar la meta «' + g.name + '»?',
          text: 'Se perderá el registro de lo ahorrado para esta meta.',
          confirmLabel: 'Borrar', danger: true,
          onConfirm: function () { D.deleteGoal(g.id); }
        });
      } : null
    });
  }

  function contribute(g, sign) {
    UI.openForm({
      title: (g.icon || '🎯') + ' ' + g.name,
      fields: [
        { name: 'dir', type: 'segmented', value: sign > 0 ? 'in' : 'out', className: 'type-toggle',
          options: [{ value: 'in', label: 'Aportar', className: 't-ingreso' }, { value: 'out', label: 'Retirar', className: 't-gasto' }] },
        { name: 'amount', type: 'money', label: 'Monto' },
        { type: 'note', text: 'Llevas ' + CG.formatMoney(g.saved || 0) + ' de ' + CG.formatMoney(g.target) + '.' }
      ],
      onSubmit: function (v) {
        if (!(v.amount > 0)) return 'Escribe un monto mayor que cero.';
        var delta = v.dir === 'in' ? v.amount : -v.amount;
        if ((g.saved || 0) + delta < 0) return 'No puedes retirar más de lo ahorrado.';
        D.addToGoal(g.id, delta);
        var after = (g.saved || 0) + delta;
        UI.toast(after >= g.target && delta > 0 ? '🎉 ¡Cumpliste tu meta «' + g.name + '»!' : v.dir === 'in' ? 'Aporte guardado' : 'Retiro guardado');
      }
    });
  }

  function editBookName() {
    UI.openForm({
      title: 'Nombre del libro',
      fields: [{ name: 'name', type: 'text', label: 'Nombre', value: S.book.name, max: 60, placeholder: 'Ej.: Finanzas de la casa' }],
      onSubmit: function (v) {
        if (!v.name) return 'Escribe un nombre.';
        D.updateBook({ name: v.name });
      }
    });
  }

  // ---------- Compartir ----------
  function inviteLink(code) {
    return location.origin + location.pathname + '?unirse=' + code;
  }

  function invite() {
    UI.toast('Creando invitación…');
    S.cloud.createInvite(S.book.name).then(function (code) {
      var link = inviteLink(code);
      var message = 'Te invito a llevar nuestras finanzas juntos en Control de Gastos (' + S.book.name + '): ' + link;
      UI.openSheet('Invitar a alguien', function (body) {
        body.appendChild(el('p', 'sheet-text', 'Envía este enlace a la persona que quieres invitar. Al abrirlo y entrar con su cuenta de Google, podrá ver y registrar movimientos en «' + S.book.name + '».'));
        var input = el('input', 'link-input');
        input.readOnly = true;
        input.value = link;
        input.setAttribute('aria-label', 'Enlace de invitación');
        input.addEventListener('focus', function () { input.select(); });
        body.appendChild(input);
        var row = el('div', 'button-row');
        row.appendChild(button('btn', '📋 Copiar enlace', function () {
          (navigator.clipboard ? navigator.clipboard.writeText(link) : Promise.reject()).then(function () {
            UI.toast('Enlace copiado');
          }, function () { input.focus(); input.select(); document.execCommand('copy'); UI.toast('Enlace copiado'); });
        }));
        var wa = el('a', 'btn ghost', 'WhatsApp');
        wa.href = 'https://wa.me/?text=' + encodeURIComponent(message);
        wa.target = '_blank';
        wa.rel = 'noopener';
        row.appendChild(wa);
        if (navigator.share) {
          row.appendChild(button('btn ghost', 'Compartir…', function () {
            navigator.share({ title: 'Control de Gastos', text: message }).catch(function () {});
          }));
        }
        body.appendChild(row);
        body.appendChild(el('p', 'muted small', 'El enlace vence en 7 días.'));
      });
    }, function (err) { UI.toast(friendlyError(err)); });
  }

  function pendingInvite() {
    try { return sessionStorage.getItem(KEYS.invite); } catch (e) { return null; }
  }

  function clearInvite() {
    try { sessionStorage.removeItem(KEYS.invite); } catch (e) { /* ignorar */ }
  }

  function captureInviteFromURL() {
    var params = new URLSearchParams(location.search);
    var code = params.get('unirse');
    if (!code) return;
    try { sessionStorage.setItem(KEYS.invite, code.replace(/[^a-z0-9]/gi, '').slice(0, 40)); } catch (e) { /* ignorar */ }
    params.delete('unirse');
    var q = params.toString();
    history.replaceState(null, '', location.pathname + (q ? '?' + q : '') + location.hash);
  }

  function handleInvite() {
    var code = pendingInvite();
    if (!code || !isCloud() || !S.ready) return;
    clearInvite();
    S.cloud.getInvite(code).then(function (inv) {
      if (!inv) {
        UI.toast('La invitación no existe o ya venció. Pide un enlace nuevo.');
        return;
      }
      if (S.books.some(function (b) { return b.id === inv.bookId; })) {
        switchBook(inv.bookId);
        UI.toast('Ya eres miembro de «' + inv.bookName + '»');
        return;
      }
      UI.confirm({
        title: '¿Unirte a «' + inv.bookName + '»?',
        text: (inv.createdByName ? inv.createdByName + ' te invitó a compartir sus finanzas. ' : '') +
          'Podrás ver y registrar movimientos en este libro. Tu libro personal sigue aparte y puedes cambiar entre ambos en Ajustes.',
        confirmLabel: 'Unirme',
        sticky: true,
        onConfirm: function () {
          showLoading(true, 'Uniéndote…');
          S.cloud.joinBook(inv).then(function () {
            UI.toast('¡Te uniste a «' + inv.bookName + '»!');
          }, function (err) {
            showLoading(false);
            UI.toast(err && err.code === 'permission-denied' ? 'No se pudo unir: la invitación venció o ya no es válida.' : friendlyError(err));
          });
        }
      });
    }, function (err) { UI.toast(friendlyError(err)); });
  }

  function switchBook(id) {
    if (!isCloud() || id === S.book.id) return;
    S.cloud.switchBook(id);
  }

  // ---------- Exportar ----------
  function exportCSV(list, filename) {
    if (!list.length) { UI.toast('No hay movimientos para exportar.'); return; }
    var blob = new Blob([CG.buildCSV(S.book, list)], { type: 'text/csv;charset=utf-8' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  }

  // ---------- Cuentas (Firebase) ----------
  function signIn() {
    if (!S.cloud) return;
    S.cloud.signIn().catch(function (err) { UI.toast(friendlyError(err)); });
  }

  function signOutUser() {
    if (!S.cloud) return;
    showLoading(true, 'Cerrando sesión…');
    S.cloud.signOut().then(function () { location.reload(); }, function (err) {
      showLoading(false);
      UI.toast(friendlyError(err));
    });
  }

  // Si hay datos guardados solo en este navegador, ofrecer subirlos a la cuenta.
  function maybeOfferImport() {
    if (S.importOffered || !isCloud() || !S.ready) return;
    var local = loadLocal();
    if (!hasLocalData(local)) return;
    S.importOffered = true;
    var n = local.movements.length;
    UI.confirm({
      title: 'Datos en este dispositivo',
      text: 'Tienes ' + (n === 1 ? '1 movimiento' : n + ' movimientos') +
        (local.recurring.length ? ', ' + local.recurring.length + ' fijos' : '') +
        (local.goals.length ? ', ' + local.goals.length + ' metas' : '') +
        ' guardados solo en este dispositivo. ¿Quieres subirlos a «' + S.book.name + '» para no perderlos y verlos en todos tus dispositivos?',
      confirmLabel: 'Subir a mi cuenta',
      cancelLabel: 'Ahora no',
      sticky: true,
      onConfirm: function () { importLocal(local); }
    });
  }

  function importLocal(local) {
    var cats = S.book.categories.slice();
    local.book.categories.forEach(function (c) {
      if (!cats.some(function (x) { return x.id === c.id; })) cats.push(c);
    });
    var accs = S.book.accounts.slice();
    local.book.accounts.forEach(function (a) {
      if (!accs.some(function (x) { return x.id === a.id; })) accs.push(a);
    });
    var patch = { categories: cats, accounts: accs };
    if (!S.book.budget && local.book.budget) {
      patch.budget = local.book.budget;
      patch.categoryBudgets = local.book.categoryBudgets;
    }
    D.updateBook(patch);
    if (local.movements.length) S.cloud.saveMovements(local.movements);
    local.recurring.forEach(function (r) { S.cloud.saveRecurring(r); });
    local.goals.forEach(function (g) { S.cloud.saveGoal(g); });
    [KEYS.movements, KEYS.legacySettings, KEYS.book, KEYS.recurring, KEYS.goals].forEach(function (k) {
      try { localStorage.removeItem(k); } catch (e) { /* ignorar */ }
    });
    UI.toast('Datos subidos a tu cuenta');
  }

  // ---------- Inicio de la app ----------
  function startLocal() {
    var local = loadLocal();
    S.book = local.book;
    S.movements = local.movements;
    S.recurring = local.recurring;
    S.goals = local.goals;
    S.books = [];
    S.ready = true;
    showLoading(false);
    render();
    processRecurring();
  }

  function checkReady() {
    if (S.ready || !(S.loaded.book && S.loaded.movements && S.loaded.recurring)) return;
    S.ready = true;
    showLoading(false);
    render();
    processRecurring();
    maybeOfferImport();
    handleInvite();
  }

  function startCloud() {
    var settled = false;
    // Si Firebase no responde, seguir con los datos de este navegador.
    var fallback = setTimeout(function () {
      if (settled) return;
      settled = true;
      S.cloudFailed = true;
      startLocal();
    }, 15000);
    function settle() { settled = true; clearTimeout(fallback); }

    import('./cloud.js?v=' + APP_VERSION).then(function (mod) {
      return mod.initCloud(firebaseConfig, {
        onUser: function (u) {
          S.user = u;
          S.sync = null;
          if (u) {
            S.ready = false;
            showLoading(true);
          } else {
            settle();
            startLocal();
          }
        },
        onBookChange: function (id) {
          S.ready = false;
          S.loaded = { book: false, movements: false, recurring: false };
          S.book = CG.normalizeBook({ id: id });
          S.movements = [];
          S.recurring = [];
          S.goals = [];
          S.filters.category = 'todas';
          S.filters.account = 'todas';
          showLoading(true, 'Cargando…');
        },
        onBooks: function (list) {
          S.books = list;
          if (S.ready) render();
        },
        onBook: function (b) {
          S.book = CG.normalizeBook(b);
          S.loaded.book = true;
          if (S.ready) render(); else checkReady();
        },
        onMovements: function (list, meta) {
          S.movements = list.filter(CG.isValidMovement);
          S.sync = meta;
          S.loaded.movements = true;
          settle();
          if (S.ready) { render(); processRecurring(); } else checkReady();
        },
        onRecurring: function (list) {
          S.recurring = list;
          S.loaded.recurring = true;
          if (S.ready) { render(); processRecurring(); } else checkReady();
        },
        onGoals: function (list) {
          S.goals = list;
          if (S.ready) render();
        },
        onError: function (err) { UI.toast(friendlyError(err)); }
      });
    }).then(function (api) {
      S.cloud = api;
      S.cloudFailed = false;
      api.start();
      render();
    }).catch(function (err) {
      if (window.console) console.error(err);
      if (settled) return;
      settle();
      S.cloud = null;
      S.cloudFailed = true;
      startLocal();
    });
  }

  // ---------- Eventos ----------
  document.addEventListener('click', function (e) {
    var target = e.target.closest ? e.target.closest('[data-action]') : null;
    if (!target) return;
    var action = target.getAttribute('data-action');
    if (action === 'signin') signIn();
    else if (action === 'signout') signOutUser();
    else if (action === 'retry') location.reload();
    else if (action === 'edit-budget') editBudget();
    else if (action === 'add') openMovementSheet(null);
    else if (action === 'new-category') editCategory(null);
    else if (action === 'new-account') editAccount(null);
    else if (action === 'new-recurring') editRecurring(null);
    else if (action === 'new-goal') editGoal(null);
    else if (action === 'go-recurring') {
      setView('ajustes');
      $('recurring-section').scrollIntoView({ block: 'start' });
    }
  });

  $('tabbar').addEventListener('click', function (e) {
    var b = e.target.closest('[data-tab]');
    if (b) setView(b.getAttribute('data-tab'));
  });
  $('fab').addEventListener('click', function () { openMovementSheet(null); });
  $('account-btn').addEventListener('click', function () { setView('ajustes'); });
  $('book-label').addEventListener('click', function () { setView('ajustes'); });

  $('movement-list').addEventListener('click', function (e) {
    var item = e.target.closest('.movement');
    if (!item) return;
    var m = S.movements.filter(function (x) { return x.id === item.getAttribute('data-id'); })[0];
    if (m) openMovementSheet(m);
  });

  $('search').addEventListener('input', function (e) { S.filters.text = e.target.value; render(); });
  $('type-chips').addEventListener('click', function (e) {
    var b = e.target.closest('[data-type]');
    if (b) { S.filters.type = b.getAttribute('data-type'); render(); }
  });
  $('category-chips').addEventListener('click', function (e) {
    var b = e.target.closest('[data-category]');
    if (b) { S.filters.category = b.getAttribute('data-category'); render(); }
  });
  $('account-filter').addEventListener('change', function (e) { S.filters.account = e.target.value; render(); });

  function changeMonth(delta) {
    var d = new Date(S.year, S.month + delta, 1);
    S.year = d.getFullYear();
    S.month = d.getMonth();
    render();
  }
  $('prev-month').addEventListener('click', function () { changeMonth(-1); });
  $('next-month').addEventListener('click', function () { changeMonth(1); });
  $('today-month').addEventListener('click', function () {
    var d = new Date();
    S.year = d.getFullYear();
    S.month = d.getMonth();
    render();
  });
  $('prev-year').addEventListener('click', function () { S.summaryYear--; render(); });
  $('next-year').addEventListener('click', function () { S.summaryYear++; render(); });

  $('export-month').addEventListener('click', function () {
    exportCSV(movementsOfMonth(viewMonthKey()), 'movimientos-' + viewMonthKey() + '.csv');
  });
  $('export-all').addEventListener('click', function () {
    exportCSV(S.movements, 'movimientos-todos-' + todayISO() + '.csv');
  });

  // Sincroniza si los datos cambian en otra pestaña (modo sin cuenta).
  window.addEventListener('storage', function (e) {
    if (isCloud() || !S.ready || !e.key || e.key.indexOf('control-gastos:') !== 0 || e.key === KEYS.invite) return;
    var local = loadLocal();
    S.book = local.book;
    S.movements = local.movements;
    S.recurring = local.recurring;
    S.goals = local.goals;
    render();
  });

  // El gráfico anual se redibuja al cambiar el ancho de la pantalla.
  var resizeTimer = null;
  window.addEventListener('resize', function () {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(function () { if (S.ready && S.view === 'resumen') render(); }, 150);
  });

  // Al volver a la app (p. ej. al día siguiente), registrar los fijos que toquen.
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'visible' && S.ready) { render(); processRecurring(); }
  });

  // Instalación como app
  window.addEventListener('beforeinstallprompt', function (e) {
    e.preventDefault();
    S.installPrompt = e;
    if (S.view === 'ajustes') render();
  });
  window.addEventListener('appinstalled', function () {
    S.installPrompt = null;
    UI.toast('¡App instalada!');
    if (S.view === 'ajustes') render();
  });

  if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost') && !window.__NO_SW__) {
    window.addEventListener('load', function () {
      navigator.serviceWorker.register('sw.js').catch(function () { /* sin modo sin conexión */ });
    });
  }

  captureInviteFromURL();
  if (firebaseConfig) startCloud();
  else startLocal();
})();
