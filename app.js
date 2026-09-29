(function () {
  'use strict';

  var STORAGE_KEY = 'control-gastos:movimientos';

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
  var dayFormat = new Intl.DateTimeFormat('es', { weekday: 'short', day: 'numeric', month: 'short' });

  // ---------- Estado ----------
  var movements = load();
  var today = new Date();
  var currentYear = today.getFullYear();
  var currentMonth = today.getMonth(); // 0-11
  var editingId = null;

  // ---------- Elementos ----------
  var $ = function (id) { return document.getElementById(id); };
  var form = $('movement-form');
  var dateInput = $('date');
  var amountInput = $('amount');
  var categorySelect = $('category');
  var noteInput = $('note');
  var formError = $('form-error');
  var submitBtn = $('submit-btn');
  var cancelBtn = $('cancel-edit');
  var formTitle = $('form-title');

  // ---------- Almacenamiento ----------
  function load() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      var data = raw ? JSON.parse(raw) : [];
      return Array.isArray(data) ? data.filter(isValidMovement) : [];
    } catch (e) {
      return [];
    }
  }

  function save() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(movements));
    } catch (e) {
      alert('No se pudieron guardar los datos en el navegador. Revisa que el almacenamiento no esté bloqueado o lleno.');
    }
  }

  function isValidMovement(m) {
    return m && typeof m.id === 'string' &&
      (m.type === 'gasto' || m.type === 'ingreso') &&
      /^\d{4}-\d{2}-\d{2}$/.test(m.date) &&
      typeof m.amount === 'number' && isFinite(m.amount) &&
      typeof m.category === 'string';
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

  function monthKey(year, month) {
    return year + '-' + pad(month + 1);
  }

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
      if (lastComma > lastDot) {
        s = s.replace(/\./g, '').replace(',', '.');
      } else {
        s = s.replace(/,/g, '');
      }
    } else if (lastComma > -1) {
      // Solo comas: si hay una con 1-2 decimales es separador decimal; si no, de miles.
      var parts = s.split(',');
      if (parts.length === 2 && parts[1].length <= 2) s = parts[0] + '.' + parts[1];
      else s = s.replace(/,/g, '');
    } else if (lastDot > -1) {
      var dotParts = s.split('.');
      if (dotParts.length > 2 || (dotParts.length === 2 && dotParts[1].length === 3)) {
        s = s.replace(/\./g, '');
      }
    }
    if (!/^\d+(\.\d+)?$/.test(s)) return NaN;
    return Math.round(parseFloat(s) * 100);
  }

  function centsToInput(cents) {
    return numberFormat.format(cents / 100).replace(/\s/g, '');
  }

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }

  function movementsOfMonth(year, month) {
    var key = monthKey(year, month);
    return movements
      .filter(function (m) { return m.date.slice(0, 7) === key; })
      .sort(function (a, b) {
        if (a.date !== b.date) return a.date < b.date ? 1 : -1;
        return (b.createdAt || 0) - (a.createdAt || 0);
      });
  }

  // ---------- Render ----------
  function render() {
    var list = movementsOfMonth(currentYear, currentMonth);
    var isCurrentMonth = currentYear === today.getFullYear() && currentMonth === today.getMonth();

    var monthName = monthFormat.format(new Date(currentYear, currentMonth, 1));
    $('month-name').textContent = monthName.charAt(0).toUpperCase() + monthName.slice(1);
    $('today-month').hidden = isCurrentMonth;

    renderSummary(list);
    renderChart(list);
    renderList(list);
  }

  function renderSummary(list) {
    var income = 0, expense = 0;
    list.forEach(function (m) {
      if (m.type === 'ingreso') income += m.amount; else expense += m.amount;
    });
    var balance = income - expense;
    $('total-income').textContent = formatMoney(income);
    $('total-expense').textContent = formatMoney(expense);
    var balanceEl = $('total-balance');
    balanceEl.textContent = formatMoney(balance);
    balanceEl.className = 'stat-value ' + (balance < 0 ? 'expense' : balance > 0 ? 'income' : '');
  }

  function renderChart(list) {
    var totals = {};
    var total = 0;
    list.forEach(function (m) {
      if (m.type !== 'gasto') return;
      totals[m.category] = (totals[m.category] || 0) + m.amount;
      total += m.amount;
    });

    var svg = $('chart');
    var legend = $('chart-legend');
    svg.innerHTML = '';
    legend.innerHTML = '';

    var hasData = total > 0;
    $('chart-empty').hidden = hasData;
    svg.style.display = hasData ? '' : 'none';
    legend.hidden = !hasData;
    if (!hasData) return;

    var data = CATEGORIES
      .map(function (c) { return { cat: c, value: totals[c.id] || 0 }; })
      .filter(function (d) { return d.value > 0; })
      .sort(function (a, b) { return b.value - a.value; });

    var NS = 'http://www.w3.org/2000/svg';
    var bg = document.createElementNS(NS, 'circle');
    bg.setAttribute('cx', 60); bg.setAttribute('cy', 60); bg.setAttribute('r', 45);
    bg.setAttribute('fill', 'none');
    bg.setAttribute('stroke', 'var(--border)');
    bg.setAttribute('stroke-width', 18);
    svg.appendChild(bg);

    var offset = 0;
    var GAP = data.length > 1 ? 0.6 : 0; // pequeño espacio entre porciones
    data.forEach(function (d) {
      var pct = d.value / total * 100;
      var seg = document.createElementNS(NS, 'circle');
      seg.setAttribute('cx', 60); seg.setAttribute('cy', 60); seg.setAttribute('r', 45);
      seg.setAttribute('fill', 'none');
      seg.setAttribute('stroke', d.cat.color);
      seg.setAttribute('stroke-width', 18);
      seg.setAttribute('pathLength', 100);
      seg.setAttribute('stroke-dasharray', Math.max(pct - GAP, 0.01) + ' ' + (100 - Math.max(pct - GAP, 0.01)));
      seg.setAttribute('stroke-dashoffset', -offset);
      seg.setAttribute('transform', 'rotate(-90 60 60)');
      var title = document.createElementNS(NS, 'title');
      title.textContent = d.cat.name + ': ' + formatMoney(d.value) + ' (' + pct.toFixed(1) + '%)';
      seg.appendChild(title);
      svg.appendChild(seg);
      offset += pct;
    });

    var label = document.createElementNS(NS, 'text');
    label.setAttribute('x', 60); label.setAttribute('y', 55);
    label.setAttribute('text-anchor', 'middle');
    label.setAttribute('class', 'center-label');
    label.textContent = 'Total gastos';
    svg.appendChild(label);

    var value = document.createElementNS(NS, 'text');
    value.setAttribute('x', 60); value.setAttribute('y', 69);
    value.setAttribute('text-anchor', 'middle');
    value.setAttribute('class', 'center-value');
    value.textContent = formatMoney(total);
    svg.appendChild(value);

    data.forEach(function (d) {
      var pct = d.value / total * 100;
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
      fill.style.width = pct + '%';
      fill.style.background = d.cat.color;
      bar.appendChild(fill);
      li.appendChild(bar);
      legend.appendChild(li);
    });
  }

  function renderList(list) {
    var ul = $('movement-list');
    ul.innerHTML = '';
    $('list-empty').hidden = list.length > 0;
    $('export-month').disabled = list.length === 0;
    $('export-all').disabled = movements.length === 0;

    list.forEach(function (m) {
      var cat = CATEGORY_BY_ID[m.category] || CATEGORY_BY_ID.otros;
      var li = el('li', 'movement' + (m.id === editingId ? ' editing' : ''));

      var icon = el('span', 'icon', cat.icon);
      icon.style.background = cat.color + '33';
      icon.setAttribute('aria-hidden', 'true');
      li.appendChild(icon);

      var info = el('div', 'info');
      info.appendChild(el('div', 'title', cat.name + (m.type === 'ingreso' ? ' · Ingreso' : '')));
      if (m.note) info.appendChild(el('div', 'note', m.note));
      info.appendChild(el('div', 'date', dayFormat.format(parseISODate(m.date))));
      li.appendChild(info);

      var amount = el('div', 'amount ' + (m.type === 'ingreso' ? 'income' : 'expense'),
        (m.type === 'ingreso' ? '+' : '−') + formatMoney(m.amount));
      li.appendChild(amount);

      var actions = el('div', 'actions');
      var editBtn = el('button', 'edit', 'Editar');
      editBtn.type = 'button';
      editBtn.setAttribute('aria-label', 'Editar movimiento ' + cat.name + ' ' + formatMoney(m.amount));
      editBtn.addEventListener('click', function () { startEdit(m.id); });
      var delBtn = el('button', 'delete', 'Borrar');
      delBtn.type = 'button';
      delBtn.setAttribute('aria-label', 'Borrar movimiento ' + cat.name + ' ' + formatMoney(m.amount));
      delBtn.addEventListener('click', function () { removeMovement(m.id); });
      actions.appendChild(editBtn);
      actions.appendChild(delBtn);
      li.appendChild(actions);

      ul.appendChild(li);
    });
  }

  // ---------- Formulario ----------
  function fillCategories() {
    CATEGORIES.forEach(function (c) {
      var opt = document.createElement('option');
      opt.value = c.id;
      opt.textContent = c.icon + ' ' + c.name;
      categorySelect.appendChild(opt);
    });
  }

  function defaultDate() {
    // Si se está viendo otro mes, proponer una fecha de ese mes.
    if (currentYear === today.getFullYear() && currentMonth === today.getMonth()) return toISODate(today);
    return monthKey(currentYear, currentMonth) + '-01';
  }

  function resetForm() {
    editingId = null;
    form.reset();
    dateInput.value = defaultDate();
    categorySelect.value = 'comida';
    formTitle.textContent = 'Nuevo movimiento';
    submitBtn.textContent = 'Agregar';
    cancelBtn.hidden = true;
    showError('');
  }

  function showError(msg) {
    formError.textContent = msg;
    formError.hidden = !msg;
  }

  function startEdit(id) {
    var m = movements.find(function (x) { return x.id === id; });
    if (!m) return;
    editingId = id;
    form.querySelector('input[name="type"][value="' + m.type + '"]').checked = true;
    dateInput.value = m.date;
    amountInput.value = centsToInput(m.amount);
    categorySelect.value = CATEGORY_BY_ID[m.category] ? m.category : 'otros';
    noteInput.value = m.note || '';
    formTitle.textContent = 'Editar movimiento';
    submitBtn.textContent = 'Guardar cambios';
    cancelBtn.hidden = false;
    showError('');
    render();
    form.scrollIntoView({ behavior: 'smooth', block: 'start' });
    amountInput.focus({ preventScroll: true });
  }

  function removeMovement(id) {
    var m = movements.find(function (x) { return x.id === id; });
    if (!m) return;
    var cat = CATEGORY_BY_ID[m.category] || CATEGORY_BY_ID.otros;
    var ok = confirm('¿Borrar este movimiento?\n\n' + cat.name + ' · ' + formatMoney(m.amount) +
      (m.note ? '\n' + m.note : ''));
    if (!ok) return;
    movements = movements.filter(function (x) { return x.id !== id; });
    save();
    if (editingId === id) resetForm();
    render();
  }

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    var type = form.querySelector('input[name="type"]:checked').value;
    var date = dateInput.value;
    var amount = parseAmount(amountInput.value);
    var category = categorySelect.value;
    var note = noteInput.value.trim();

    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) { showError('Indica una fecha válida.'); dateInput.focus(); return; }
    if (!(amount > 0)) { showError('Indica un monto mayor que cero (ej.: 1250,50).'); amountInput.focus(); return; }
    if (!CATEGORY_BY_ID[category]) { showError('Elige una categoría.'); categorySelect.focus(); return; }

    if (editingId) {
      movements = movements.map(function (m) {
        return m.id === editingId
          ? Object.assign({}, m, { type: type, date: date, amount: amount, category: category, note: note })
          : m;
      });
    } else {
      movements.push({
        id: newId(), type: type, date: date, amount: amount,
        category: category, note: note, createdAt: Date.now()
      });
    }
    save();

    // Mostrar el mes del movimiento guardado.
    var d = parseISODate(date);
    currentYear = d.getFullYear();
    currentMonth = d.getMonth();

    resetForm();
    render();
  });

  cancelBtn.addEventListener('click', function () {
    resetForm();
    render();
  });

  // ---------- Navegación de meses ----------
  function changeMonth(delta) {
    var d = new Date(currentYear, currentMonth + delta, 1);
    currentYear = d.getFullYear();
    currentMonth = d.getMonth();
    if (!editingId) dateInput.value = defaultDate();
    render();
  }

  $('prev-month').addEventListener('click', function () { changeMonth(-1); });
  $('next-month').addEventListener('click', function () { changeMonth(1); });
  $('today-month').addEventListener('click', function () {
    currentYear = today.getFullYear();
    currentMonth = today.getMonth();
    if (!editingId) dateInput.value = defaultDate();
    render();
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
    if (!list.length) return;
    var rows = [['Fecha', 'Tipo', 'Categoría', 'Monto', 'Nota']];
    list.slice().sort(function (a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : 0; })
      .forEach(function (m) {
        var cat = CATEGORY_BY_ID[m.category] || CATEGORY_BY_ID.otros;
        var p = m.date.split('-');
        var signed = (m.type === 'gasto' ? -m.amount : m.amount) / 100;
        rows.push([
          p[2] + '/' + p[1] + '/' + p[0],
          m.type === 'gasto' ? 'Gasto' : 'Ingreso',
          cat.name,
          signed.toFixed(2).replace('.', ','),
          m.note || ''
        ]);
      });
    var csv = '\uFEFF' + rows.map(function (r) { return r.map(function (v, i) { return csvCell(v, i === 4); }).join(';'); }).join('\r\n');
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
    exportCSV(movementsOfMonth(currentYear, currentMonth),
      'movimientos-' + monthKey(currentYear, currentMonth) + '.csv');
  });
  $('export-all').addEventListener('click', function () {
    exportCSV(movements, 'movimientos-todos-' + toISODate(new Date()) + '.csv');
  });

  // Sincroniza si los datos cambian en otra pestaña.
  window.addEventListener('storage', function (e) {
    if (e.key !== STORAGE_KEY) return;
    movements = load();
    if (editingId && !movements.some(function (m) { return m.id === editingId; })) resetForm();
    render();
  });

  // ---------- Inicio ----------
  fillCategories();
  resetForm();
  render();
})();
