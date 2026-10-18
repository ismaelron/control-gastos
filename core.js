// Lógica común de la app (sin interfaz): valores por defecto, formatos,
// cálculos de totales y saldos, movimientos fijos y exportación a CSV.
(function () {
  'use strict';

  // Paleta de colores para categorías, cuentas y metas (validada para
  // daltonismo en el orden en que aparece).
  var COLORS = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#4a3aa7', '#e34948', '#8d99ae', '#6b4f3a'];

  var DEFAULT_CATEGORIES = [
    { id: 'comida', name: 'Comida', icon: '🍽️', color: '#eb6834', kind: 'gasto' },
    { id: 'transporte', name: 'Transporte', icon: '🚌', color: '#1baf7a', kind: 'gasto' },
    { id: 'casa', name: 'Casa', icon: '🏠', color: '#2a78d6', kind: 'gasto' },
    { id: 'ocio', name: 'Ocio', icon: '🎉', color: '#4a3aa7', kind: 'gasto' },
    { id: 'salud', name: 'Salud', icon: '💊', color: '#e87ba4', kind: 'gasto' },
    { id: 'sueldo', name: 'Sueldo', icon: '💼', color: '#008300', kind: 'ingreso' },
    { id: 'otros', name: 'Otros', icon: '📦', color: '#8d99ae', kind: 'ambos' }
  ];

  var DEFAULT_ACCOUNTS = [
    { id: 'general', name: 'General', icon: '👛', color: '#2a78d6', initial: 0 }
  ];

  var ICONS = [
    '🍽️', '🛒', '☕', '🍺', '🚌', '🚗', '⛽', '🚕', '✈️', '🏠', '💡', '💧', '📱', '🌐',
    '🎉', '🎬', '🎮', '📚', '🎓', '💊', '🏥', '🏋️', '💇', '👕', '🎁', '🐶', '👶', '🧾',
    '💳', '🏦', '💵', '👛', '💼', '💰', '📈', '🐷', '🏖️', '🚲', '🔧', '📦', '❤️', '⭐'
  ];

  var numberFormat = new Intl.NumberFormat('es', { minimumFractionDigits: 2, maximumFractionDigits: 2, useGrouping: 'always' });
  var shortFormat = new Intl.NumberFormat('es', { maximumFractionDigits: 1, useGrouping: 'always' });

  function pad(n) { return (n < 10 ? '0' : '') + n; }

  function toISODate(d) {
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  }

  function parseISODate(s) {
    var p = s.split('-');
    return new Date(+p[0], +p[1] - 1, +p[2]);
  }

  function monthKey(year, month) { return year + '-' + pad(month + 1); }

  function addMonths(key, delta) {
    var p = key.split('-');
    var d = new Date(+p[0], +p[1] - 1 + delta, 1);
    return monthKey(d.getFullYear(), d.getMonth());
  }

  function lastDayOfMonth(key) {
    var p = key.split('-');
    return new Date(+p[0], +p[1], 0).getDate();
  }

  // Montos guardados en centavos (enteros) para evitar errores de redondeo.
  // Monedas: símbolo y si va antes («$1.234,56») o después («1.234,56 €»).
  var CURRENCIES = {
    EUR: { label: 'Euro (€)', symbol: '€', after: true },
    USD: { label: 'Dólar estadounidense (US$)', symbol: 'US$', after: false },
    MXN: { label: 'Peso mexicano ($)', symbol: '$', after: false },
    COP: { label: 'Peso colombiano ($)', symbol: '$', after: false },
    CLP: { label: 'Peso chileno ($)', symbol: '$', after: false },
    ARS: { label: 'Peso argentino ($)', symbol: '$', after: false },
    PEN: { label: 'Sol peruano (S/)', symbol: 'S/', after: false },
    UYU: { label: 'Peso uruguayo ($U)', symbol: '$U', after: false },
    GBP: { label: 'Libra esterlina (£)', symbol: '£', after: false },
    GEN: { label: 'Otra / genérica ($)', symbol: '$', after: false }
  };
  var currency = CURRENCIES.GEN;

  function setCurrency(code) { currency = CURRENCIES[code] || CURRENCIES.GEN; }

  function withSymbol(sign, text) {
    return currency.after ? sign + text + '\u00a0' + currency.symbol : sign + currency.symbol + text;
  }

  function formatMoney(cents) {
    var sign = cents < 0 ? '-' : '';
    return withSymbol(sign, numberFormat.format(Math.abs(cents) / 100));
  }

  // Versión corta para ejes de gráficos: $1,2 M, $350 mil, $900.
  function formatShort(cents) {
    var v = Math.abs(cents) / 100;
    var sign = cents < 0 ? '-' : '';
    if (v >= 1e6) return withSymbol(sign, shortFormat.format(v / 1e6) + ' M');
    if (v >= 1e3) return withSymbol(sign, shortFormat.format(v / 1e3) + ' mil');
    return withSymbol(sign, shortFormat.format(v));
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

  function newId() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  function slug(text) {
    var s = String(text || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 24);
    return (s || 'item') + '-' + Math.random().toString(36).slice(2, 6);
  }

  function isValidMovement(m) {
    if (!m || typeof m.id !== 'string') return false;
    if (m.type !== 'gasto' && m.type !== 'ingreso' && m.type !== 'transferencia') return false;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(m.date)) return false;
    if (typeof m.amount !== 'number' || !isFinite(m.amount) || m.amount <= 0) return false;
    if (m.type === 'transferencia') return typeof m.toAccount === 'string';
    return typeof m.category === 'string';
  }

  // Completa los ajustes del libro con valores por defecto.
  function normalizeBook(b) {
    b = b || {};
    var categories = Array.isArray(b.categories) && b.categories.length
      ? b.categories.filter(function (c) { return c && c.id && c.name; })
      : DEFAULT_CATEGORIES.slice();
    if (!categories.some(function (c) { return c.id === 'otros'; })) {
      categories.push(DEFAULT_CATEGORIES[DEFAULT_CATEGORIES.length - 1]);
    }
    var accounts = Array.isArray(b.accounts) && b.accounts.length
      ? b.accounts.filter(function (a) { return a && a.id && a.name; })
      : DEFAULT_ACCOUNTS.slice();
    var cb = {};
    var src = b.categoryBudgets || {};
    Object.keys(src).forEach(function (k) {
      if (typeof src[k] === 'number' && src[k] > 0) cb[k] = src[k];
    });
    return {
      id: b.id || 'local',
      name: b.name || 'Mis finanzas',
      owner: b.owner || null,
      members: Array.isArray(b.members) ? b.members : [],
      memberInfo: b.memberInfo || {},
      budget: typeof b.budget === 'number' && b.budget > 0 ? b.budget : 0,
      categoryBudgets: cb,
      currency: CURRENCIES[b.currency] ? b.currency : 'GEN',
      categories: categories.map(function (c) {
        return {
          id: c.id, name: c.name, icon: c.icon || '📦', color: c.color || '#8d99ae',
          kind: c.kind === 'ingreso' || c.kind === 'gasto' ? c.kind : 'ambos'
        };
      }),
      accounts: accounts.map(function (a) {
        return {
          id: a.id, name: a.name, icon: a.icon || '👛', color: a.color || '#2a78d6',
          initial: typeof a.initial === 'number' ? a.initial : 0
        };
      })
    };
  }

  function totalsOf(list) {
    var t = { income: 0, expense: 0 };
    list.forEach(function (m) {
      if (m.type === 'ingreso') t.income += m.amount;
      else if (m.type === 'gasto') t.expense += m.amount;
    });
    return t;
  }

  // Saldo de cada cuenta con los movimientos hasta la fecha indicada.
  function accountBalances(book, movements, untilISO) {
    var defaultId = book.accounts[0].id;
    var known = {};
    var bal = {};
    book.accounts.forEach(function (a) { known[a.id] = true; bal[a.id] = a.initial || 0; });
    function acc(id) { return id && known[id] ? id : defaultId; }
    movements.forEach(function (m) {
      if (untilISO && m.date > untilISO) return;
      if (m.type === 'ingreso') bal[acc(m.account)] += m.amount;
      else if (m.type === 'gasto') bal[acc(m.account)] -= m.amount;
      else if (m.type === 'transferencia') {
        bal[acc(m.account)] -= m.amount;
        bal[acc(m.toAccount)] += m.amount;
      }
    });
    return bal;
  }

  // Movimientos fijos: devuelve los movimientos que ya deberían existir
  // (hasta hoy) y hasta qué mes quedó generado cada fijo. Los ids son fijos
  // (rec-<fijo>-<mes>) para que dos dispositivos no generen duplicados.
  function dueRecurring(recurring, todayISO) {
    var currentMonth = todayISO.slice(0, 7);
    var out = { movements: [], lastMonths: {} };
    recurring.forEach(function (r) {
      if (!r || r.active === false || !/^\d{4}-\d{2}$/.test(r.start || '')) return;
      var month = r.lastMonth ? addMonths(r.lastMonth, 1) : r.start;
      var last = r.lastMonth || null;
      var guard = 0;
      while (month <= currentMonth && guard < 36) {
        guard++;
        var day = Math.min(r.day || 1, lastDayOfMonth(month));
        var date = month + '-' + pad(day);
        if (date > todayISO) break;
        out.movements.push(instanceOf(r, month, date));
        last = month;
        month = addMonths(month, 1);
      }
      if (last && last !== r.lastMonth) out.lastMonths[r.id] = last;
    });
    return out;
  }

  function instanceOf(r, month, date) {
    var m = {
      id: 'rec-' + r.id + '-' + month,
      type: r.type,
      date: date,
      amount: r.amount,
      note: r.note || '',
      recurringId: r.id,
      createdAt: Date.now()
    };
    if (r.type === 'transferencia') {
      m.account = r.account || '';
      m.toAccount = r.toAccount || '';
    } else {
      m.category = r.category;
      if (r.account) m.account = r.account;
      if (r.type === 'gasto' && r.paidBy) m.paidBy = r.paidBy;
      if (r.type === 'gasto' && Array.isArray(r.split) && r.split.length) m.split = r.split.slice();
    }
    return m;
  }

  // ---------- Gastos compartidos ----------
  // Un gasto se divide si tiene `split` (lista de miembros). Quien pagó es
  // `paidBy` (o quien lo registró). Los centavos que sobran al dividir se
  // asignan a los primeros de la lista, así la suma siempre cuadra.
  function payerOf(m) { return m.paidBy || m.createdBy || ''; }

  function sharesOf(m) {
    if (m.type !== 'gasto' || !Array.isArray(m.split) || !m.split.length) return null;
    var people = m.split.filter(function (u, i, a) { return u && a.indexOf(u) === i; });
    if (!people.length) return null;
    var base = Math.floor(m.amount / people.length);
    var extra = m.amount - base * people.length;
    var shares = {};
    people.forEach(function (u, i) { shares[u] = base + (i < extra ? 1 : 0); });
    return { payer: payerOf(m), shares: shares };
  }

  // ¿El gasto genera deudas? (dividido entre alguien más que quien pagó)
  function isSplitWithOthers(m) {
    var s = sharesOf(m);
    if (!s) return false;
    return Object.keys(s.shares).some(function (u) { return u !== s.payer; });
  }

  // Saldo de cada persona: positivo = le deben; negativo = debe.
  function familyBalances(movements, settlements) {
    var net = {};
    function add(u, v) { if (u) net[u] = (net[u] || 0) + v; }
    movements.forEach(function (m) {
      var s = sharesOf(m);
      if (!s || !s.payer) return;
      add(s.payer, m.amount);
      Object.keys(s.shares).forEach(function (u) { add(u, -s.shares[u]); });
    });
    (settlements || []).forEach(function (p) {
      if (!(p.amount > 0) || !p.from || !p.to) return;
      add(p.from, p.amount);
      add(p.to, -p.amount);
    });
    return net;
  }

  // Convierte los saldos en la menor cantidad razonable de pagos.
  function simplifyDebts(net) {
    var debtors = [], creditors = [];
    Object.keys(net).forEach(function (u) {
      if (net[u] < 0) debtors.push({ u: u, v: -net[u] });
      else if (net[u] > 0) creditors.push({ u: u, v: net[u] });
    });
    debtors.sort(function (a, b) { return b.v - a.v; });
    creditors.sort(function (a, b) { return b.v - a.v; });
    var out = [];
    var i = 0, j = 0;
    while (i < debtors.length && j < creditors.length) {
      var amt = Math.min(debtors[i].v, creditors[j].v);
      if (amt > 0) out.push({ from: debtors[i].u, to: creditors[j].u, amount: amt });
      debtors[i].v -= amt;
      creditors[j].v -= amt;
      if (!debtors[i].v) i++;
      if (!creditors[j].v) j++;
    }
    return out;
  }

  // Fijos que todavía no se han registrado en el mes indicado.
  function upcomingRecurring(recurring, month) {
    return recurring.filter(function (r) {
      return r.active !== false && r.start <= month && (!r.lastMonth || r.lastMonth < month);
    }).map(function (r) {
      return { r: r, date: month + '-' + pad(Math.min(r.day || 1, lastDayOfMonth(month))) };
    }).sort(function (a, b) { return a.date < b.date ? -1 : 1; });
  }

  // ---------- CSV ----------
  // Se usa ";" como separador y coma decimal, que es lo que espera Excel en español.
  function csvCell(value, isText) {
    var s = String(value == null ? '' : value);
    if (isText && /^[=+\-@\t\r]/.test(s)) s = "'" + s; // evita fórmulas
    if (/[";\n\r]/.test(s)) s = '"' + s.replace(/"/g, '""') + '"';
    return s;
  }

  function buildCSV(book, list) {
    var catById = {};
    book.categories.forEach(function (c) { catById[c.id] = c; });
    var accById = {};
    book.accounts.forEach(function (a) { accById[a.id] = a; });
    var defaultAcc = book.accounts[0];
    function accName(id) { return (accById[id] || defaultAcc).name; }

    var rows = [['Fecha', 'Tipo', 'Categoría', 'Cuenta', 'Monto', 'Nota']];
    list.slice().sort(function (a, b) {
      if (a.date !== b.date) return a.date < b.date ? -1 : 1;
      return (a.createdAt || 0) - (b.createdAt || 0);
    }).forEach(function (m) {
      var p = m.date.split('-');
      var date = p[2] + '/' + p[1] + '/' + p[0];
      var amount = function (c) { return (c / 100).toFixed(2).replace('.', ','); };
      if (m.type === 'transferencia') {
        rows.push([date, 'Transferencia', '', accName(m.account) + ' → ' + accName(m.toAccount), amount(m.amount), m.note || '']);
      } else {
        var cat = catById[m.category];
        rows.push([
          date,
          m.type === 'gasto' ? 'Gasto' : 'Ingreso',
          cat ? cat.name : 'Otros',
          accName(m.account),
          amount(m.type === 'gasto' ? -m.amount : m.amount),
          m.note || ''
        ]);
      }
    });
    return '﻿' + rows.map(function (r) {
      return r.map(function (v, i) { return csvCell(v, i === 5 || i === 2 || i === 3); }).join(';');
    }).join('\r\n');
  }

  window.CG = {
    CURRENCIES: CURRENCIES,
    setCurrency: setCurrency,
    COLORS: COLORS,
    DEFAULT_CATEGORIES: DEFAULT_CATEGORIES,
    DEFAULT_ACCOUNTS: DEFAULT_ACCOUNTS,
    ICONS: ICONS,
    pad: pad,
    toISODate: toISODate,
    parseISODate: parseISODate,
    monthKey: monthKey,
    addMonths: addMonths,
    lastDayOfMonth: lastDayOfMonth,
    formatMoney: formatMoney,
    formatShort: formatShort,
    parseAmount: parseAmount,
    centsToInput: centsToInput,
    newId: newId,
    slug: slug,
    isValidMovement: isValidMovement,
    normalizeBook: normalizeBook,
    totalsOf: totalsOf,
    accountBalances: accountBalances,
    dueRecurring: dueRecurring,
    instanceOf: instanceOf,
    upcomingRecurring: upcomingRecurring,
    buildCSV: buildCSV,
    payerOf: payerOf,
    sharesOf: sharesOf,
    isSplitWithOthers: isSplitWithOthers,
    familyBalances: familyBalances,
    simplifyDebts: simplifyDebts
  };
})();
