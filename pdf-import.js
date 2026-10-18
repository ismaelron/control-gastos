// Lectura de PDF: nóminas y extractos bancarios. Usa pdf.js (Mozilla,
// licencia Apache 2.0, incluido en vendor/pdfjs) y se carga solo cuando hace
// falta. Todo ocurre en el navegador: los documentos no se suben a ningún lado.
(function () {
  'use strict';
  var CG = window.CG;

  var pdfjsPromise = null;
  function loadPdfjs() {
    if (!pdfjsPromise) {
      pdfjsPromise = import('./vendor/pdfjs/pdf.min.mjs').then(function (lib) {
        lib.GlobalWorkerOptions.workerSrc = new URL('vendor/pdfjs/pdf.worker.min.mjs', document.baseURI).href;
        return lib;
      });
    }
    return pdfjsPromise;
  }

  function norm(s) {
    return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim();
  }

  // ---------- Texto del PDF en líneas y celdas ----------
  function extractLines(file) {
    return Promise.all([loadPdfjs(), file.arrayBuffer()]).then(function (r) {
      var lib = r[0];
      return lib.getDocument({ data: new Uint8Array(r[1]), isEvalSupported: false, disableFontFace: true }).promise;
    }).then(function (pdf) {
      var pages = [];
      for (var i = 1; i <= Math.min(pdf.numPages, 60); i++) pages.push(pdf.getPage(i).then(function (p) { return p.getTextContent(); }));
      return Promise.all(pages);
    }).then(function (contents) {
      var lines = [];
      contents.forEach(function (content, pi) {
        var items = content.items.filter(function (it) { return it.str && it.str.trim(); }).map(function (it) {
          return { x: it.transform[4], y: it.transform[5], w: it.width || 0, h: Math.abs(it.transform[3]) || it.height || 8, str: it.str };
        });
        items.sort(function (a, b) { return b.y - a.y || a.x - b.x; });
        var cur = null;
        items.forEach(function (it) {
          if (!cur || Math.abs(it.y - cur.y) > Math.max(2, it.h * 0.45)) {
            cur = { page: pi, y: it.y, items: [] };
            lines.push(cur);
          }
          cur.items.push(it);
        });
      });
      return lines.map(function (l) {
        l.items.sort(function (a, b) { return a.x - b.x; });
        var cells = [];
        l.items.forEach(function (it) {
          var last = cells[cells.length - 1];
          var gap = last ? it.x - (last.x + last.w) : Infinity;
          if (last && gap < Math.max(1.5, it.h * 0.6)) {
            last.text += (gap > it.h * 0.15 ? ' ' : '') + it.str;
            last.w = it.x + it.w - last.x;
          } else {
            cells.push({ x: it.x, w: it.w, text: it.str });
          }
        });
        cells.forEach(function (c) { c.text = c.text.replace(/\s+/g, ' ').trim(); });
        return { page: l.page, y: l.y, cells: cells, text: cells.map(function (c) { return c.text; }).join('  ') };
      }).filter(function (l) { return l.text; });
    });
  }

  // ---------- Montos ----------
  // 1.234,56 · 1234,56 · 1,234.56 · 1234.56 · y enteros con miles (1.500.000)
  var MONEY = /(?:^|[\s($€£¥])(-?\(?\d{1,3}(?:[.\s]\d{3})+,\d{2}\)?-?|-?\(?\d+,\d{2}\)?-?|-?\(?\d{1,3}(?:,\d{3})+\.\d{2}\)?-?|-?\(?\d+\.\d{2}\)?-?|-?\(?\d{1,3}(?:\.\d{3})+\)?-?)(?=$|[\s€$)]|\s?(?:eur|€))/gi;

  function moneyTokens(text) {
    var out = [];
    var m;
    MONEY.lastIndex = 0;
    while ((m = MONEY.exec(text))) {
      var raw = m[1];
      var end = m.index + m[0].length;
      if (/^\s?%/.test(text.slice(end))) continue; // es un porcentaje
      var neg = /^-|-$|^\(.*\)$/.test(raw);
      var cents = CG.parseAmount(raw.replace(/[()\-\s]/g, '').replace(/\s/g, ''));
      if (isNaN(cents)) continue;
      out.push({ cents: neg ? -cents : cents, index: m.index, end: end });
    }
    return out;
  }

  // ---------- ¿Nómina o extracto? ----------
  var DATE_START = /^(\d{1,2})[\/.\-](\d{1,2})(?:[\/.\-](\d{2,4}))?\b/;

  function classify(lines) {
    var text = norm(lines.map(function (l) { return l.text; }).join('\n'));
    var dateRows = lines.filter(function (l) { return DATE_START.test(l.cells[0] ? l.cells[0].text : '') && moneyTokens(l.text).length; }).length;
    var payslipScore = 0;
    [LABELS.net, LABELS.gross, LABELS.deductions,
     /\bnomina\b|recibo (individual )?de salarios?|rebut (individual )?de salaris?|liquidacion de (sueldo|haberes)|colilla de pago|desprendible|payslip|pay slip|pay stub|earnings statement|pay advice|holerite|contracheque|recibo de vencimento|gehaltsabrechnung|lohnabrechnung|entgeltabrechnung/,
     /\birpf\b|seguridad social|seguretat social|contingencias comunes|contingencies comunes|\bafp\b|\bimss\b|\bisr\b|social security|national insurance|\bpaye\b|federal (income )?tax|\binss\b|\birrf\b|seguranca social|lohnsteuer|sozialversicherung/].forEach(function (re) { if (re.test(text)) payslipScore++; });
    if (payslipScore >= 2 && dateRows < 8) return 'payslip';
    if (dateRows >= 3) return 'statement';
    if (payslipScore >= 2) return 'payslip';
    return 'unknown';
  }

  // ---------- Nómina ----------
  // Nombres de meses (sin acentos) en español, catalán, portugués, inglés y alemán.
  var MONTH_NAMES = {
    enero: 1, febrero: 2, marzo: 3, abril: 4, mayo: 5, junio: 6, julio: 7, agosto: 8, septiembre: 9, setiembre: 9, octubre: 10, noviembre: 11, diciembre: 12,
    gener: 1, febrer: 2, marc: 3, maig: 5, juny: 6, juliol: 7, agost: 8, setembre: 9, novembre: 11, desembre: 12,
    janeiro: 1, fevereiro: 2, marco: 3, maio: 5, junho: 6, julho: 7, setembro: 9, outubro: 10, dezembro: 12,
    january: 1, february: 2, march: 3, april: 4, may: 5, june: 6, july: 7, august: 8, september: 9, october: 10, november: 11, december: 12,
    januar: 1, februar: 2, marz: 3, mai: 5, juni: 6, juli: 7, oktober: 10, dezember: 12
  };
  var MONTH_RE = Object.keys(MONTH_NAMES).sort(function (a, b) { return b.length - a.length; }).join('|');
  var MONTHS3 = { ene: 1, gen: 1, jan: 1, feb: 2, fev: 2, mar: 3, mrz: 3, abr: 4, apr: 4, may: 5, mai: 5, mag: 5, jun: 6, jul: 7,
    ago: 8, aug: 8, sep: 9, set: 9, oct: 10, out: 10, okt: 10, nov: 11, dic: 12, des: 12, dez: 12, dec: 12 };
  var ABBR_RE = Object.keys(MONTHS3).join('|');

  function key(y, m) { return y + '-' + (m < 10 ? '0' : '') + m; }
  function fullYear(y) { y = +y; return y < 100 ? (y < 70 ? 2000 + y : 1900 + y) : y; }

  function findPeriod(lines, fileName) {
    var cands = [];
    lines.forEach(function (l, i) {
      var t = norm(l.text);
      var weight = /periodo|liquidacion|liquidacio|mes de|\bmes\b|nomina|correspondiente|fecha de pago|data de pagament|pago del|pay period|period ending|pay date|abrechnungsmonat|abrechnungszeitraum|zeitraum|competencia|mes de referencia/.test(t) ? 3 : 1;
      var m;
      // «del 01/10/2026 al 31/10/2026»: vale el final del periodo
      var range = /(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{2,4})\s*(?:al|a|-|hasta)\s*(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{2,4})/.exec(t);
      if (range) {
        // Formato EE. UU. (mes/día/año) si algún «día» del medio pasa de 12.
        var us = (+range[2] > 12 || +range[5] > 12) && +range[1] <= 12 && +range[4] <= 12;
        cands.push({ k: key(fullYear(range[6]), us ? +range[4] : +range[5]), w: weight + 3, i: i });
      }
      var reName = new RegExp('\\b(' + MONTH_RE + ")\\s*(?:de\\s*|d'\\s*|del\\s*|\\/\\s*|-\\s*|,\\s*)?(\\d{4}|\\d{2}\\b)", 'g');
      while ((m = reName.exec(t))) {
        cands.push({ k: key(fullYear(m[2]), MONTH_NAMES[m[1]]), w: weight + 1, i: i });
      }
      var reAbbr = new RegExp('\\b(' + ABBR_RE + ')[a-z]*\\.?\\s*[\\/\\-]?\\s*(\\d{4}|\\d{2})\\b', 'g');
      while ((m = reAbbr.exec(t))) cands.push({ k: key(fullYear(m[2]), MONTHS3[m[1]]), w: weight, i: i });
      var reNum = /\b(0?[1-9]|1[0-2])[\/\-](20\d{2})\b/g;
      while ((m = reNum.exec(t))) if (weight > 1) cands.push({ k: key(+m[2], +m[1]), w: weight, i: i });
    });
    if (!cands.length && fileName) {
      var f = norm(fileName);
      var mm = /(20\d{2})[\-_ .]?(0[1-9]|1[0-2])\b/.exec(f) || null;
      if (mm) return key(+mm[1], +mm[2]);
      mm = /\b(0[1-9]|1[0-2])[\-_ .](20\d{2})/.exec(f);
      if (mm) return key(+mm[2], +mm[1]);
      var y = /(20\d{2})/.exec(f);
      var mn = new RegExp('(' + MONTH_RE + ')').exec(f);
      if (y && mn) return key(+y[1], MONTH_NAMES[mn[1]]);
      return null;
    }
    if (!cands.length) return null;
    var score = {};
    cands.forEach(function (c) { score[c.k] = (score[c.k] || 0) + c.w; });
    return Object.keys(score).sort(function (a, b) { return score[b] - score[a]; })[0];
  }

  // Monto de la línea que coincide con la etiqueta (o de la línea siguiente).
  function amountFor(lines, re, opts) {
    opts = opts || {};
    for (var i = 0; i < lines.length; i++) {
      if (opts.stopAt != null && i >= opts.stopAt) break;
      var t = norm(lines[i].text);
      var m = re.exec(t);
      if (!m) continue;
      var after = lines[i].text;
      var toks = moneyTokens(after).filter(function (tk) { return tk.cents !== 0; });
      if (toks.length) return Math.abs(toks[toks.length - 1].cents);
      // A veces el valor está debajo de la etiqueta.
      for (var j = i + 1; j < Math.min(lines.length, i + 3); j++) {
        var nt = moneyTokens(lines[j].text);
        if (nt.length && !/[a-z]{4,}/.test(norm(lines[j].text).replace(/eur/g, ''))) return Math.abs(nt[0].cents);
        if (nt.length) break;
      }
    }
    return 0;
  }

  var LABELS = {
    net: /liquido (total )?a percibir|liquido a pagar|liquido total|liquido a recibir|alcance liquido|neto a (pagar|percibir|recibir)|total neto|sueldo liquido|neto pagado|importe liquido|total a percibir|neto del periodo|liquid (total )?a percebre|liquid a cobrar|total liquid|net pay|net amount|take home|net salary|amount paid|liquido a receber|valor liquido|total liquido|auszahlungsbetrag|nettoverdienst|netto(betrag|bezuge|entgelt)|uberweisungsbetrag/,
    gross: /total devengado|total devengos|total percepciones|total haberes|total ingresos|salario bruto|sueldo bruto|total bruto|remuneracion bruta|total remuneraciones|total imponible|total meritat|total meritacions|total acreditat|total retribucions|gross pay|gross earnings|total gross|total earnings|total de vencimentos|total vencimentos|total (de )?proventos|remuneracao bruta|gesamtbrutto|bruttoverdienst|brutto(bezuge|entgelt|lohn|gehalt)/,
    deductions: /total (a )?deducir|total deducciones|total descuentos|total retenciones|total deducido|total de deducciones|total a deduir|total deduccions|total descomptes|total deductions|total (de )?descontos|gesetzliche abzuge|abzuge gesamt|summe abzuge/,
    tax: /\birpf\b|retencion (de )?irpf|retencio (de l')?irpf|impuesto (unico|a la renta|sobre la renta)|\bisr\b|retefuente|retencion en la fuente|federal (income )?tax|income tax|\bpaye\b|withholding|\birrf\b|\birs\b|lohnsteuer/
  };
  var SOCIAL = /contingencies comunes|\batur\b|formacio professional|seguretat social|cotitzacio|social security|\bfica\b|medicare|national insurance|\binss\b|seguranca social|rentenversicherung|krankenversicherung|pflegeversicherung|arbeitslosenversicherung|contingencias comunes|\bdesempleo\b|formacion profesional|\bmei\b|equidad intergeneracional|cotizacion (a la )?(seguridad social|ss)|\bafp\b|fondo de pensiones|cotizacion (de )?salud|aporte (a |de )?(salud|pension)|\bsalud\b|fonasa|isapre|\beps\b|\bimss\b|seguro de cesantia|horas extra(ordinarias)? (fuerza mayor|resto)/;
  var EMPLOYER_BLOCK = /aportacio (de l')?empresa|bases de cotitzacio|determinacio de les bases|employer contributions?|employer'?s (share|contribution)|arbeitgeberanteil|aportacion (de la )?empresa|aportacion empresarial|determinacion de (las )?bases|bases de cotizacion|cotizacion empresa|a cargo (de la|del) empresa|aportes del empleador/;
  var EXTRA = /paga extraordinaria|paga addicional|13th month|decimo terceiro|13o salario|weihnachtsgeld|urlaubsgeld|paga extra|pagas extra|gratificacion extraordinaria|extra de (junio|julio|navidad|diciembre|verano)|prima de servicios|aguinaldo/;

  function parsePayslip(lines, fileName) {
    var stop = null;
    for (var i = 0; i < lines.length; i++) {
      if (EMPLOYER_BLOCK.test(norm(lines[i].text))) { stop = i; break; }
    }
    var net = amountFor(lines, LABELS.net);
    var gross = amountFor(lines, LABELS.gross);
    var deductions = amountFor(lines, LABELS.deductions);
    var tax = amountFor(lines, LABELS.tax, { stopAt: stop });
    var social = 0;
    lines.forEach(function (l, idx) {
      if (stop != null && idx >= stop) return;
      var t = norm(l.text);
      if (!SOCIAL.test(t) || /total|base/.test(t.slice(0, 12))) return;
      var toks = moneyTokens(l.text);
      if (toks.length) social += Math.abs(toks[toks.length - 1].cents);
    });
    if (!net && gross && deductions) net = gross - deductions;
    if (!deductions && gross && net) deductions = gross - net;
    if (!gross && net && deductions) gross = net + deductions;
    if (social > deductions && deductions) social = Math.max(0, deductions - tax);
    var month = findPeriod(lines, fileName);
    var text = norm(lines.map(function (l) { return l.text; }).join(' '));
    var employer = '';
    for (var k = 0; k < Math.min(lines.length, 15); k++) {
      var cell = lines[k].cells.map(function (c) { return c.text; }).filter(function (c) {
        return /\b(s\.?l\.?u?|s\.?a\.?|s\.?a\.?s|ltda|spa|s\.? de r\.?l\.?|s\.?c\.?|gmbh|ag|kg|inc|llc|ltd|limited|corp|co|plc|pty|lda)\b\.?$/i.test(c)
          || /^(institut|instituto|servei|servicio|servico|consorci|consorcio|hospital|ajuntament|ayuntamiento|generalitat|gobierno|govern|junta|diputaci|universi|ministerio|prefeitura|secretaria)/i.test(norm(c));
      })[0];
      if (cell) { employer = cell.slice(0, 80); break; }
    }
    var consistent = gross && deductions && net ? Math.abs(gross - deductions - net) <= Math.max(100, net * 0.01) : false;
    return {
      month: month,
      extra: EXTRA.test(text),
      net: net, gross: gross, deductions: deductions, tax: tax, social: social,
      employer: employer,
      fileName: fileName || '',
      confident: !!(month && net && (consistent || !gross))
    };
  }

  // ---------- Extracto en PDF ----------
  // Devuelve filas [Fecha, Concepto, Importe, Saldo] para el asistente de importación.
  function statementRows(lines) {
    // Año por defecto: el más frecuente en el documento (para fechas «dd/mm»).
    var years = {};
    lines.forEach(function (l) {
      var re = /\b(20\d{2})\b/g, m;
      while ((m = re.exec(l.text))) years[m[1]] = (years[m[1]] || 0) + 1;
    });
    var defYear = Object.keys(years).sort(function (a, b) { return years[b] - years[a]; })[0] || String(new Date().getFullYear());

    // Encabezado con columnas (para saber si un monto es cargo, abono o saldo)
    var cols = null;
    lines.some(function (l) {
      var t = norm(l.text);
      if (!/concepto|concepte|descripcion|descripcio|detalle|movimiento|operacion|description|details|transaction|descricao|historico|verwendungszweck|buchungstext|beschreibung/.test(t) ||
          !/importe|import\b|cargo|abono|debe|haber|saldo|debito|credito|amount|debit|credit|balance|valor|betrag|soll|kontostand/.test(t)) return false;
      cols = {};
      l.cells.forEach(function (c) {
        var ct = norm(c.text), cx = c.x + c.w / 2;
        if (/saldo|balance|kontostand/.test(ct)) cols.balance = cx;
        else if (/cargo|debe\b|debito|retiro|salida|deure|withdrawal|debit|money out|\bsoll\b|belastung/.test(ct)) cols.debit = cx;
        else if (/abono|haber|credito|ingreso|deposito|entrada|haver|deposit|credit|money in|\bhaben\b|gutschrift/.test(ct)) cols.credit = cx;
        else if (/importe|import\b|monto|cantidad|valor|amount|betrag|montante/.test(ct)) cols.amount = cx;
      });
      if (!Object.keys(cols).length) cols = null;
      return !!cols;
    });

    // ¿Día/mes (Europa, Latinoamérica) o mes/día (EE. UU.)?
    var dmy = 0, mdy = 0;
    lines.forEach(function (l) {
      var m = DATE_START.exec(l.cells[0] ? l.cells[0].text : '');
      if (!m) return;
      if (+m[1] > 12) dmy++;
      if (+m[2] > 12) mdy++;
    });
    var monthFirst = mdy > dmy;
    var ABBR_DATE = new RegExp('^(\\d{1,2})\\.?\\s+(' + ABBR_RE + ')[a-z]*\\.?(?:\\s+(\\d{2,4}))?', 'i');
    var ABBR_DATE_US = new RegExp('^(' + ABBR_RE + ')[a-z]*\\.?\\s+(\\d{1,2}),?(?:\\s+(\\d{4}))?', 'i');

    var rows = [];
    lines.forEach(function (l) {
      var first = norm(l.cells[0] ? l.cells[0].text : '');
      var dm = DATE_START.exec(first) || ABBR_DATE.exec(first);
      var us = !dm && ABBR_DATE_US.exec(first);
      if (us) dm = [us[0], us[2], us[1], us[3]];
      var money = [];
      l.cells.forEach(function (c) {
        var toks = moneyTokens(c.text);
        // Solo celdas que son un monto (no textos con números).
        if (toks.length === 1 && c.text.replace(/[\d.,\s()\-€$£¥+']|eur|usd|gbp|brl|r\$|chf|aud|nzd|cad|mxn|clp|cop|ars|pen|cny|rmb/gi, '').length <= 1) money.push({ cents: toks[0].cents, x: c.x + c.w / 2, raw: c.text });
      });
      if (!dm || !money.length) {
        // Continuación del concepto de la fila anterior.
        if (!dm && !money.length && rows.length && rows[rows.length - 1].page === l.page &&
            rows[rows.length - 1].y - l.y < 30 && l.text.length < 120 && !/saldo|total|pagina|página|page|seite|balance/i.test(l.text)) {
          rows[rows.length - 1].desc += ' ' + l.text;
          rows[rows.length - 1].y = l.y;
        }
        return;
      }
      var d, mo, y;
      if (/^\d+$/.test(dm[2])) {
        d = monthFirst ? +dm[2] : +dm[1];
        mo = monthFirst ? +dm[1] : +dm[2];
        y = dm[3] ? fullYear(dm[3]) : +defYear;
      } else { d = +dm[1]; mo = MONTHS3[dm[2].toLowerCase().slice(0, 3)]; y = dm[3] ? fullYear(dm[3]) : +defYear; }
      if (!mo || mo > 12 || d > 31) return;
      var iso = key(y, mo) + '-' + (d < 10 ? '0' : '') + d;

      // Concepto: celdas que no son fechas ni montos.
      var desc = l.cells.filter(function (c) {
        return !DATE_START.test(c.text) && !(moneyTokens(c.text).length === 1 && c.text.replace(/[\d.,\s()\-€$£¥+']|eur|usd|gbp|brl|r\$|chf|aud|nzd|cad|mxn|clp|cop|ars|pen|cny|rmb/gi, '').length <= 1);
      }).map(function (c) { return c.text; }).join(' ').replace(/\s+/g, ' ').trim();

      var amount = null, balance = null;
      if (cols) {
        money.forEach(function (mt) {
          var best = null, bestD = Infinity;
          Object.keys(cols).forEach(function (k) {
            var dd = Math.abs(cols[k] - mt.x);
            if (dd < bestD) { bestD = dd; best = k; }
          });
          if (best === 'balance') balance = mt.cents;
          else if (best === 'debit') amount = -Math.abs(mt.cents);
          else if (best === 'credit') amount = Math.abs(mt.cents);
          else if (amount == null) amount = mt.cents;
        });
      }
      if (amount == null) {
        if (money.length >= 2) { amount = money[money.length - 2].cents; balance = money[money.length - 1].cents; }
        else amount = money[0].cents;
      }
      rows.push({ date: iso, desc: desc, amount: amount, balance: balance, page: l.page, y: l.y });
    });

    // Sin signo en el monto: se deduce de la variación del saldo.
    var withBal = rows.filter(function (r) { return r.balance != null; });
    var anyNeg = rows.some(function (r) { return r.amount < 0; });
    if (!anyNeg && withBal.length >= 3) {
      var asc = 0, desc = 0;
      for (var i = 1; i < rows.length; i++) {
        if (rows[i].balance == null || rows[i - 1].balance == null) continue;
        var delta = rows[i].balance - rows[i - 1].balance;
        if (Math.abs(Math.abs(delta) - Math.abs(rows[i].amount)) <= 1) asc++;
        if (Math.abs(Math.abs(delta) - Math.abs(rows[i - 1].amount)) <= 1) desc++;
      }
      for (var j = 0; j < rows.length; j++) {
        var a = Math.abs(rows[j].amount);
        if (asc >= desc && j > 0 && rows[j].balance != null && rows[j - 1].balance != null) {
          rows[j].amount = rows[j].balance < rows[j - 1].balance ? -a : a;
        } else if (desc > asc && j < rows.length - 1 && rows[j].balance != null && rows[j + 1].balance != null) {
          rows[j].amount = rows[j].balance < rows[j + 1].balance ? -a : a;
        }
      }
    }

    return [['Fecha', 'Concepto', 'Importe', 'Saldo']].concat(rows.map(function (r) {
      return [r.date, r.desc, r.amount / 100, r.balance == null ? '' : r.balance / 100];
    }));
  }

  window.PdfImport = {
    extractLines: extractLines,
    classify: classify,
    parsePayslip: parsePayslip,
    statementRows: statementRows,
    moneyTokens: moneyTokens
  };
})();
