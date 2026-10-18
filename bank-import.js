// Importar movimientos desde el archivo que entrega el banco.
// Formatos: CSV/TXT (separado por ; , o tabulador), Excel .xlsx y los .xls
// que muchos bancos generan como tabla HTML. Todo se procesa en el navegador:
// el archivo no se sube a ningún lado.
(function () {
  'use strict';
  var CG = window.CG;

  // ---------- Lectura de archivos ----------
  function readFile(file) {
    return file.arrayBuffer().then(function (buf) {
      var bytes = new Uint8Array(buf);
      if (bytes[0] === 0x50 && bytes[1] === 0x4b) return parseXLSX(buf);              // ZIP => .xlsx
      if (bytes[0] === 0xd0 && bytes[1] === 0xcf) {                                    // .xls binario antiguo
        throw new Error('xls-binario');
      }
      var text = decodeText(bytes);
      if (/<table[\s>]/i.test(text.slice(0, 200000))) return parseHTMLTable(text);
      return parseCSV(text);
    });
  }

  // UTF-8 si es válido; si no, Windows-1252 (común en archivos de bancos).
  function decodeText(bytes) {
    try {
      return new TextDecoder('utf-8', { fatal: true }).decode(bytes).replace(/^﻿/, '');
    } catch (e) {
      return new TextDecoder('windows-1252').decode(bytes);
    }
  }

  function parseCSV(text) {
    var lines = text.split(/\r\n|\n|\r/).slice(0, 30);
    var delim = [';', ',', '\t', '|'].map(function (d) {
      var counts = lines.filter(Boolean).map(function (l) { return splitLine(l, d).length; });
      var common = mode(counts);
      return { d: d, score: common > 1 ? counts.filter(function (c) { return c === common; }).length * common : 0 };
    }).sort(function (a, b) { return b.score - a.score; })[0].d;

    var rows = [], row = [], cell = '', inQ = false;
    for (var i = 0; i < text.length; i++) {
      var ch = text[i];
      if (inQ) {
        if (ch === '"') {
          if (text[i + 1] === '"') { cell += '"'; i++; } else inQ = false;
        } else cell += ch;
      } else if (ch === '"' && cell.trim() === '') {
        inQ = true; cell = '';
      } else if (ch === delim) {
        row.push(cell); cell = '';
      } else if (ch === '\n' || ch === '\r') {
        if (ch === '\r' && text[i + 1] === '\n') i++;
        row.push(cell); rows.push(row); row = []; cell = '';
      } else cell += ch;
    }
    if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
    return cleanRows(rows);
  }

  function splitLine(line, d) {
    var out = [], cur = '', q = false;
    for (var i = 0; i < line.length; i++) {
      var c = line[i];
      if (c === '"') q = !q;
      else if (c === d && !q) { out.push(cur); cur = ''; }
      else cur += c;
    }
    out.push(cur);
    return out;
  }

  function mode(arr) {
    var c = {}, best = 0, val = 0;
    arr.forEach(function (v) { c[v] = (c[v] || 0) + 1; if (c[v] > best) { best = c[v]; val = v; } });
    return val;
  }

  function cleanRows(rows) {
    return rows.map(function (r) {
      return r.map(function (v) { return typeof v === 'string' ? v.replace(/\s+/g, ' ').trim() : v; });
    }).filter(function (r) {
      return r.some(function (v) { return v !== '' && v != null; });
    });
  }

  function parseHTMLTable(text) {
    var doc = new DOMParser().parseFromString(text, 'text/html');
    var tables = Array.prototype.slice.call(doc.querySelectorAll('table'));
    if (!tables.length) return [];
    var best = tables.sort(function (a, b) { return b.rows.length - a.rows.length; })[0];
    return cleanRows(Array.prototype.map.call(best.rows, function (tr) {
      return Array.prototype.map.call(tr.cells, function (td) { return td.textContent; });
    }));
  }

  // --- .xlsx: ZIP con XML. Se lee la primera hoja. ---
  function parseXLSX(buf) {
    return unzip(buf).then(function (files) {
      var shared = [];
      if (files['xl/sharedStrings.xml']) {
        var ss = files['xl/sharedStrings.xml'];
        var re = /<si>([\s\S]*?)<\/si>/g, m;
        while ((m = re.exec(ss))) {
          var t = '', r2 = /<t[^>]*>([\s\S]*?)<\/t>/g, mm;
          while ((mm = r2.exec(m[1]))) t += mm[1];
          shared.push(xmlText(t));
        }
      }
      var sheetPath = firstSheetPath(files);
      var xml = files[sheetPath];
      if (!xml) throw new Error('xlsx-sin-hoja');
      var rows = [];
      var rowRe = /<row\b[^>]*>([\s\S]*?)<\/row>/g, rm;
      while ((rm = rowRe.exec(xml))) {
        var row = [];
        var cellRe = /<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g, cm;
        while ((cm = cellRe.exec(rm[1]))) {
          var attrs = cm[1], inner = cm[2] || '';
          var ref = /\br="([A-Z]+)\d+"/.exec(attrs);
          var col = ref ? colIndex(ref[1]) : row.length;
          var type = (/\bt="([^"]+)"/.exec(attrs) || [])[1];
          var v = (/<v>([\s\S]*?)<\/v>/.exec(inner) || [])[1];
          var val;
          if (type === 's') val = shared[+v] || '';
          else if (type === 'inlineStr') val = xmlText(((/<t[^>]*>([\s\S]*?)<\/t>/.exec(inner)) || [])[1] || '');
          else if (type === 'str' || type === 'e') val = xmlText(v || '');
          else if (type === 'b') val = v === '1' ? 'VERDADERO' : 'FALSO';
          else val = v == null ? '' : Number(v);
          while (row.length < col) row.push('');
          row[col] = val;
        }
        rows.push(row);
      }
      return cleanRows(rows);
    });
  }

  function firstSheetPath(files) {
    var wb = files['xl/workbook.xml'] || '';
    var rels = files['xl/_rels/workbook.xml.rels'] || '';
    var sheet = /<sheet\b[^>]*\br:id="([^"]+)"/.exec(wb) || /<sheet\b[^>]*\bid="([^"]+)"/.exec(wb);
    if (sheet) {
      var rel = new RegExp('<Relationship\\b[^>]*Id="' + sheet[1] + '"[^>]*Target="([^"]+)"').exec(rels) ||
        new RegExp('<Relationship\\b[^>]*Target="([^"]+)"[^>]*Id="' + sheet[1] + '"').exec(rels);
      if (rel) {
        var target = rel[1].replace(/^\//, '');
        return target.indexOf('xl/') === 0 ? target : 'xl/' + target;
      }
    }
    return 'xl/worksheets/sheet1.xml';
  }

  function colIndex(letters) {
    var n = 0;
    for (var i = 0; i < letters.length; i++) n = n * 26 + (letters.charCodeAt(i) - 64);
    return n - 1;
  }

  function xmlText(s) {
    return s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'")
      .replace(/&#(\d+);/g, function (_, d) { return String.fromCharCode(+d); })
      .replace(/&#x([0-9a-f]+);/gi, function (_, h) { return String.fromCharCode(parseInt(h, 16)); })
      .replace(/&amp;/g, '&');
  }

  // Lector de ZIP mínimo (solo los archivos XML que hacen falta).
  function unzip(buf) {
    var dv = new DataView(buf);
    var eocd = -1;
    for (var i = buf.byteLength - 22; i >= Math.max(0, buf.byteLength - 70000); i--) {
      if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
    }
    if (eocd < 0) return Promise.reject(new Error('zip-invalido'));
    var count = dv.getUint16(eocd + 10, true);
    var p = dv.getUint32(eocd + 16, true);
    var jobs = [];
    var files = {};
    for (var n = 0; n < count; n++) {
      if (dv.getUint32(p, true) !== 0x02014b50) break;
      var method = dv.getUint16(p + 10, true);
      var csize = dv.getUint32(p + 20, true);
      var nameLen = dv.getUint16(p + 28, true);
      var extraLen = dv.getUint16(p + 30, true);
      var commentLen = dv.getUint16(p + 32, true);
      var local = dv.getUint32(p + 42, true);
      var name = new TextDecoder().decode(new Uint8Array(buf, p + 46, nameLen));
      p += 46 + nameLen + extraLen + commentLen;
      if (!/^xl\/(workbook\.xml|sharedStrings\.xml|_rels\/workbook\.xml\.rels|worksheets\/[^/]+\.xml)$/.test(name)) continue;
      var lNameLen = dv.getUint16(local + 26, true);
      var lExtraLen = dv.getUint16(local + 28, true);
      var data = new Uint8Array(buf, local + 30 + lNameLen + lExtraLen, csize);
      jobs.push(inflate(data, method).then((function (nm) {
        return function (bytes) { files[nm] = new TextDecoder().decode(bytes); };
      })(name)));
    }
    return Promise.all(jobs).then(function () { return files; });
  }

  function inflate(data, method) {
    if (method === 0) return Promise.resolve(data);
    if (method !== 8) return Promise.reject(new Error('zip-metodo'));
    var stream = new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
    return new Response(stream).arrayBuffer().then(function (b) { return new Uint8Array(b); });
  }

  // ---------- Columnas ----------
  var KEYS = {
    date: /fecha|date|f\.\s*(operaci|contable|valor|transac)|^fec/i,
    desc: /descrip|concepto|detalle|glosa|movimiento|referencia|comercio|establecimiento|nombre|description|memo|transacci|narrativa|observaci/i,
    amount: /^(monto|importe|valor|amount|total|cantidad|monto\s*\(.*\)|importe\s*\(.*\))/i,
    debit: /cargo|d[eé]bito|debe\b|retiro|egreso|salida|gasto|withdraw|debit|pagos?\b/i,
    credit: /abono|cr[eé]dito|haber|dep[oó]sito|ingreso|entrada|credit/i,
    skip: /saldo|balance|disponible/i
  };

  function findHeader(rows) {
    var best = -1, bestScore = 0;
    for (var i = 0; i < Math.min(rows.length, 25); i++) {
      var score = 0;
      rows[i].forEach(function (c) {
        if (typeof c !== 'string' || !c || c.length > 40) return;
        if (KEYS.date.test(c) || KEYS.desc.test(c) || KEYS.amount.test(c) || KEYS.debit.test(c) || KEYS.credit.test(c)) score++;
      });
      if (score > bestScore) { bestScore = score; best = i; }
    }
    return bestScore >= 2 ? best : -1;
  }

  function guessMapping(rows) {
    var h = findHeader(rows);
    var header = h >= 0 ? rows[h] : [];
    var data = rows.slice(h + 1, h + 40);
    var ncols = rows.reduce(function (m, r) { return Math.max(m, r.length); }, 0);
    function find(re, exclude) {
      for (var i = 0; i < header.length; i++) {
        var c = String(header[i] || '');
        if (re.test(c) && !KEYS.skip.test(c) && exclude.indexOf(i) === -1) return i;
      }
      return -1;
    }
    var date = find(KEYS.date, []);
    if (date < 0) date = bestColumn(data, ncols, function (v) { return !!parseDate(v, 'dmy'); });
    var debit = find(KEYS.debit, [date]);
    var credit = find(KEYS.credit, [date, debit]);
    var amount = find(KEYS.amount, [date, debit, credit]);
    var desc = find(KEYS.desc, [date, debit, credit, amount]);
    if (desc < 0) desc = bestColumn(data, ncols, function (v) { return typeof v === 'string' && /[a-z]{3}/i.test(v) && !parseDate(v, 'dmy'); }, [date]);
    var modeTwo = debit >= 0 && credit >= 0;
    if (!modeTwo && amount < 0) {
      amount = debit >= 0 ? debit : credit >= 0 ? credit
        : bestColumn(data, ncols, function (v) { return !isNaN(parseMoney(v)) && !parseDate(v, 'dmy'); }, [date, desc]);
    }
    var dates = data.map(function (r) { return r[date]; });
    // Columna con signo donde casi todo es positivo: suele ser un estado de
    // tarjeta de crédito, donde los positivos son compras.
    var mostlyPositive = false;
    if (!modeTwo && amount >= 0) {
      var vals = data.map(function (r) { return parseMoney(r[amount]); }).filter(function (v) { return !isNaN(v) && v !== 0; });
      var pos = vals.filter(function (v) { return v > 0; }).length;
      mostlyPositive = vals.length >= 3 && pos / vals.length >= 0.75;
    }
    return {
      headerRow: h,
      header: header,
      ncols: ncols,
      date: date,
      desc: desc,
      mode: modeTwo ? 'two' : 'signed',
      amount: modeTwo ? -1 : amount,
      debit: modeTwo ? debit : -1,
      credit: modeTwo ? credit : -1,
      // Si la única columna de monto se llama "cargo"/"débito", sus valores son gastos.
      positiveIsExpense: !modeTwo && amount >= 0 && (KEYS.debit.test(String(header[amount] || '')) || mostlyPositive),
      dateOrder: detectDateOrder(dates)
    };
  }

  function bestColumn(data, ncols, test, exclude) {
    var best = -1, bestN = 0;
    for (var c = 0; c < ncols; c++) {
      if (exclude && exclude.indexOf(c) !== -1) continue;
      var n = data.filter(function (r) { return r[c] !== '' && r[c] != null && test(r[c]); }).length;
      if (n > bestN) { bestN = n; best = c; }
    }
    return best;
  }

  // ---------- Fechas ----------
  var MONTHS = { ene: 1, jan: 1, feb: 2, mar: 3, abr: 4, apr: 4, may: 5, jun: 6, jul: 7, ago: 8, aug: 8,
    sep: 9, set: 9, oct: 10, nov: 11, dic: 12, dec: 12 };

  function detectDateOrder(values) {
    var dmy = 0, mdy = 0;
    values.forEach(function (v) {
      var m = /^\s*(\d{1,2})[\/.\-](\d{1,2})[\/.\-]\d{2,4}/.exec(String(v || ''));
      if (!m) return;
      if (+m[1] > 12) dmy++;
      if (+m[2] > 12) mdy++;
    });
    return mdy > dmy ? 'mdy' : 'dmy';
  }

  function iso(y, m, d) {
    if (y < 100) y += y < 70 ? 2000 : 1900;
    if (m < 1 || m > 12 || d < 1 || d > 31) return null;
    var dt = new Date(y, m - 1, d);
    if (dt.getMonth() !== m - 1) return null;
    return CG.toISODate(dt);
  }

  function parseDate(v, order) {
    if (v == null || v === '') return null;
    if (typeof v === 'number') {
      // Número de serie de Excel (días desde 1899-12-30).
      if (v > 20000 && v < 80000) {
        var d = new Date(Date.UTC(1899, 11, 30) + Math.round(v) * 864e5);
        return iso(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
      }
      return null;
    }
    var s = String(v).trim().toLowerCase();
    var m = /^(\d{4})[\/.\-](\d{1,2})[\/.\-](\d{1,2})/.exec(s);
    if (m) return iso(+m[1], +m[2], +m[3]);
    m = /^(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{2,4})\b/.exec(s);
    if (m) return order === 'mdy' ? iso(+m[3], +m[1], +m[2]) : iso(+m[3], +m[2], +m[1]);
    m = /^(\d{1,2})[\s\/.\-]+(?:de\s+)?([a-zé]{3,})\.?[\s\/.\-]+(?:de\s+)?(\d{2,4})\b/.exec(s);
    if (m && MONTHS[m[2].slice(0, 3)]) return iso(+m[3], MONTHS[m[2].slice(0, 3)], +m[1]);
    m = /^([a-z]{3,})\.?\s+(\d{1,2}),?\s+(\d{4})\b/.exec(s);
    if (m && MONTHS[m[1].slice(0, 3)]) return iso(+m[3], MONTHS[m[1].slice(0, 3)], +m[2]);
    return null;
  }

  // ---------- Montos ----------
  // Devuelve centavos con signo, o NaN. Acepta "$ -1.234,56", "(1.234,56)",
  // "1.234,56-", "1,234.56", "USD 15.00".
  function parseMoney(v) {
    if (typeof v === 'number') return isFinite(v) ? Math.round(v * 100) : NaN;
    var s = String(v == null ? '' : v).trim();
    if (!s || !/\d/.test(s)) return NaN;
    if (/[a-z]{4,}/i.test(s.replace(/usd|clp|cop|mxn|ars|pen|eur|uyu|bob|pyg|gtq|crc|dop|hnl|nio|ves/gi, ''))) return NaN;
    var neg = /^\(.*\)$/.test(s) || /^-/.test(s.replace(/[^\d\-().,]/g, '')) || /-\s*$/.test(s) || /^[^\d]*-/.test(s);
    var clean = s.replace(/[^\d.,]/g, '');
    if (!clean) return NaN;
    var cents = CG.parseAmount(clean);
    if (isNaN(cents)) return NaN;
    return neg ? -cents : cents;
  }

  // ---------- Construir movimientos ----------
  function buildItems(rows, map) {
    var out = [];
    rows.slice(map.headerRow + 1).forEach(function (r, i) {
      var date = parseDate(r[map.date], map.dateOrder);
      if (!date) return;
      var amount, type;
      if (map.mode === 'two') {
        var deb = parseMoney(r[map.debit]);
        var cre = parseMoney(r[map.credit]);
        deb = isNaN(deb) ? 0 : Math.abs(deb);
        cre = isNaN(cre) ? 0 : Math.abs(cre);
        if (deb && !cre) { amount = deb; type = 'gasto'; }
        else if (cre && !deb) { amount = cre; type = 'ingreso'; }
        else return;
      } else {
        var val = parseMoney(r[map.amount]);
        if (isNaN(val) || val === 0) return;
        var expense = map.positiveIsExpense ? val > 0 : val < 0;
        amount = Math.abs(val);
        type = expense ? 'gasto' : 'ingreso';
      }
      var desc = map.desc >= 0 ? String(r[map.desc] == null ? '' : r[map.desc]).replace(/\s+/g, ' ').trim() : '';
      out.push({ row: map.headerRow + 1 + i, date: date, desc: desc.slice(0, 200), amount: amount, type: type });
    });
    return out;
  }

  // ---------- Categorías sugeridas ----------
  var RULES = [
    ['sueldo', /sueldo|n[oó]mina|salario|remuneraci|pago de haberes|payroll/],
    ['comida', /supermerc|mercado|restaur|rappi|uber ?eats|didi ?food|pedidos ?ya|ifood|jumbo|l[ií]der|[eé]xito|carulla|\bd1\b|ara\b|oxxo|walmart|soriana|chedraui|tottus|unimarc|santa isabel|panader|cafeter|caf[eé]\b|starbucks|mcdonald|burger|pizza|kfc|subway|sushi|almac[eé]n|minimarket|verduler|carnicer/],
    ['transporte', /\buber\b|didi\b|cabify|taxi|peaje|autopista|gasolin|combustib|nafta|bencin|\bshell\b|copec|terpel|primax|petrobras|ypf|pemex|esso|metro\b|\bbus\b|transmilenio|sube\b|bip\b|estacionam|parking|parqueader/],
    ['casa', /arriendo|alquiler|renta\b|hipoteca|dividendo|luz\b|electric|enel|codensa|\bcfe\b|edenor|agua\b|aguas|acueducto|\bgas\b|metrogas|gas natural|internet|claro|movistar|entel|tigo|telmex|telcel|vtr|wom\b|condominio|administraci[oó]n|expensas|gastos comunes|homecenter|sodimac|ikea/],
    ['ocio', /netflix|spotify|disney|hbo|\bmax\b|prime video|amazon prime|youtube|apple\.com|itunes|steam|playstation|xbox|nintendo|cine|cinemark|cinepolis|teatro|concierto|ticketmaster|bar\b|pub\b|discoteca/],
    ['salud', /farmac|droguer|cruz verde|salcobrand|ahumada|similares|guadalajara|cl[ií]nica|m[eé]dic|hospital|dental|odontol|laborator|isapre|fonasa|\beps\b|prepaga|[oó]ptica|psic[oó]log/]
  ];

  function norm(s) {
    return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim();
  }

  // Aprende de los movimientos ya registrados: misma descripción => misma categoría.
  function buildHistory(movements) {
    var byNote = {};
    movements.slice().sort(function (a, b) { return (a.createdAt || 0) - (b.createdAt || 0); }).forEach(function (m) {
      if (m.type === 'transferencia' || !m.note || !m.category) return;
      byNote[m.type + '|' + norm(m.note)] = m.category;
      var key = norm(m.note).replace(/[\d#*\-_/.:]+/g, ' ').split(' ').filter(Boolean).slice(0, 2).join(' ');
      if (key.length >= 4) byNote[m.type + '~' + key] = m.category;
    });
    return byNote;
  }

  function suggestCategory(item, book, history) {
    var ids = {};
    book.categories.forEach(function (c) { ids[c.id] = c; });
    function ok(id) {
      var c = ids[id];
      return c && (c.kind === 'ambos' || c.kind === item.type);
    }
    var n = norm(item.desc);
    var h = history[item.type + '|' + n];
    if (h && ok(h)) return h;
    var key = n.replace(/[\d#*\-_/.:]+/g, ' ').split(' ').filter(Boolean).slice(0, 2).join(' ');
    h = key.length >= 4 && history[item.type + '~' + key];
    if (h && ok(h)) return h;
    // Nombre de una categoría propia dentro de la descripción.
    var own = book.categories.filter(function (c) { return ok(c.id) && c.id !== 'otros' && norm(c.name).length >= 4 && n.indexOf(norm(c.name)) !== -1; })[0];
    if (own) return own.id;
    for (var i = 0; i < RULES.length; i++) {
      if (RULES[i][1].test(n) && ok(RULES[i][0])) return RULES[i][0];
    }
    return ok('otros') ? 'otros' : (book.categories.filter(function (c) { return ok(c.id); })[0] || {}).id;
  }

  // Posible duplicado: ya existe un movimiento con la misma fecha, monto y tipo.
  function duplicateIndex(movements) {
    var idx = {};
    movements.forEach(function (m) { idx[m.date + '|' + m.amount + '|' + m.type] = true; });
    return function (item) { return !!idx[item.date + '|' + item.amount + '|' + item.type]; };
  }

  window.BankImport = {
    readFile: readFile,
    parseCSV: parseCSV,
    parseXLSX: parseXLSX,
    guessMapping: guessMapping,
    detectDateOrder: detectDateOrder,
    parseDate: parseDate,
    parseMoney: parseMoney,
    buildItems: buildItems,
    buildHistory: buildHistory,
    suggestCategory: suggestCategory,
    duplicateIndex: duplicateIndex
  };
})();
