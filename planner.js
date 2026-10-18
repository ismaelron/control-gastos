// Plan mensual y consejos. Solo cálculos (sin interfaz), a partir de los
// movimientos, los fijos, las metas y las nóminas.
(function () {
  'use strict';
  var CG = window.CG;

  // Cuánto se puede recortar de cada categoría si el dinero no alcanza
  // (0 = imprescindible, 1 = totalmente prescindible).
  var FLEX = { casa: 0.1, salud: 0.1, transporte: 0.3, comida: 0.4, otros: 0.8, ocio: 1 };
  var FLEX_DEFAULT = 0.6;

  var SUBS = /netflix|spotify|disney|hbo|\bmax\b|prime video|amazon prime|primevideo|apple\.com|icloud|itunes|apple music|youtube|google (one|storage|play)|dazn|movistar\+|filmin|crunchyroll|deezer|tidal|audible|kindle|dropbox|adobe|canva|microsoft|office 365|xbox|playstation|psn|nintendo|steam|chatgpt|openai|duolingo|gimnasio|\bgym\b|fitness|basic-fit|holmes place|patreon|twitch|onlyfans|tinder|bumble|linkedin premium|nyt|el pa[ií]s|el mundo|suscrip/;
  var STREAM_VIDEO = /netflix|disney|hbo|\bmax\b|prime video|amazon prime|primevideo|dazn|movistar\+|filmin|crunchyroll|apple tv|skyshowtime|atresplayer/;
  var FEES = /comisi[oó]n|cuota (de )?(mantenimiento|tarjeta|administraci)|mantenimiento de cuenta|intereses (deudores|de demora|tarjeta)|descubierto|penalizaci|cargo por|gastos de gesti/;
  var EMERGENCY = /emergencia|colch[oó]n|imprevist|fondo de seguridad/;

  function norm(s) {
    return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim();
  }

  // Comercio a partir de la nota: sin números ni símbolos, primeras 2 palabras.
  function merchantKey(note) {
    var words = norm(note).replace(/[^a-z0-9+ ]+/g, ' ').replace(/\b\d+\b/g, ' ')
      .split(' ').filter(function (w) { return w.length >= 3 && !/^(compra|pago|cargo|recibo|adeudo|tarjeta|tarj|transf|transferencia|domiciliacion|con|del|los|las|com|www|sl|sa|s\.a)$/.test(w); });
    return words.slice(0, 2).join(' ');
  }

  // Mes (periodo) al que pertenece: depende del día de cobro.
  function monthOf(m) { return CG.periodOf(m.date); }

  function lastMonths(todayISO, n, includeCurrent) {
    var cur = CG.periodOf(todayISO);
    var out = [];
    for (var i = includeCurrent ? 0 : 1; out.length < n; i++) out.push(CG.addMonths(cur, -i));
    return out;
  }

  // Meses completos anteriores con movimientos (hasta 3), para promediar.
  function historyMonths(movements, todayISO) {
    var has = {};
    movements.forEach(function (m) { has[monthOf(m)] = true; });
    return lastMonths(todayISO, 12, false).filter(function (k) { return has[k]; }).slice(0, 3);
  }

  function payslipFor(payslips, month) {
    for (var i = 0; i < payslips.length; i++) if (payslips[i].month === month) return payslips[i];
    return null;
  }

  function latestPayslips(payslips, n) {
    return payslips.slice().sort(function (a, b) { return a.month < b.month ? 1 : -1; }).slice(0, n);
  }

  // Ingreso esperado para el mes: la última nómina (si es reciente) más otros
  // ingresos habituales; si no hay nóminas, el promedio de ingresos.
  function expectedIncome(ctx) {
    var months = ctx.months;
    var avgIncome = 0, avgSalaryMov = 0;
    if (months.length) {
      months.forEach(function (k) {
        ctx.movements.forEach(function (m) {
          if (m.type !== 'ingreso' || monthOf(m) !== k) return;
          avgIncome += m.amount;
          if (m.category === 'sueldo') avgSalaryMov += m.amount;
        });
      });
      avgIncome = Math.round(avgIncome / months.length);
      avgSalaryMov = Math.round(avgSalaryMov / months.length);
    }
    var recent = latestPayslips(ctx.payslips, 1)[0];
    var fresh = recent && recent.month >= CG.addMonths(CG.periodOf(ctx.today), -3);
    if (fresh && recent.net > 0) {
      // Otros ingresos (no nómina) se suman al neto de la nómina.
      var other = Math.max(0, avgIncome - avgSalaryMov);
      return { amount: recent.net + other, source: 'payslip', payslipMonth: recent.month, other: other };
    }
    return { amount: avgIncome, source: months.length ? 'history' : 'none', other: 0 };
  }

  function categoryAverages(ctx) {
    var sums = {};
    ctx.movements.forEach(function (m) {
      if (m.type !== 'gasto' || ctx.months.indexOf(monthOf(m)) === -1) return;
      var c = ctx.catOf(m);
      var bucket = m.recurringId ? 'fixed' : 'variable';
      sums[c] = sums[c] || { fixed: 0, variable: 0 };
      sums[c][bucket] += m.amount;
    });
    var n = ctx.months.length || 1;
    var out = {};
    Object.keys(sums).forEach(function (c) {
      out[c] = { fixed: Math.round(sums[c].fixed / n), variable: Math.round(sums[c].variable / n) };
    });
    return out;
  }

  function goalNeeds(goals, todayISO) {
    var cur = CG.periodOf(todayISO);
    return goals.map(function (g) {
      var remaining = Math.max(0, (g.target || 0) - (g.saved || 0));
      var monthsLeft = g.deadline ? monthsBetween(cur, g.deadline) : null;
      var monthly = remaining && monthsLeft && monthsLeft > 0 ? Math.ceil(remaining / monthsLeft) : 0;
      return { goal: g, remaining: remaining, monthsLeft: monthsLeft, monthly: monthly, overdue: !!(g.deadline && monthsLeft < 1 && remaining > 0) };
    });
  }

  function monthsBetween(fromKey, toKey) {
    var a = fromKey.split('-'), b = toKey.split('-');
    return (+b[0] - +a[0]) * 12 + (+b[1] - +a[1]) + 1;
  }

  // ---------- Plan del mes ----------
  // opts: { movements, recurring, goals, payslips, book, today }
  function buildPlan(opts) {
    var catById = {};
    opts.book.categories.forEach(function (c) { catById[c.id] = c; });
    var ctx = {
      movements: opts.movements.filter(function (m) { return m.type !== 'transferencia'; }),
      payslips: opts.payslips || [],
      today: opts.today,
      catOf: function (m) { return catById[m.category] ? m.category : 'otros'; }
    };
    ctx.months = historyMonths(ctx.movements, opts.today);

    var income = expectedIncome(ctx);

    // Gastos fijos: los movimientos fijos activos (gastos).
    var fixedByCat = {};
    var fixedTotal = 0;
    (opts.recurring || []).forEach(function (r) {
      if (r.active === false || r.type !== 'gasto') return;
      var c = catById[r.category] ? r.category : 'otros';
      fixedByCat[c] = (fixedByCat[c] || 0) + r.amount;
      fixedTotal += r.amount;
    });

    var needs = goalNeeds(opts.goals || [], opts.today);
    var goalsTotal = needs.reduce(function (s, n) { return s + n.monthly; }, 0);

    var avgs = categoryAverages(ctx);
    var variableAvg = {};
    var variableTotal = 0;
    Object.keys(avgs).forEach(function (c) {
      // Si la categoría ya tiene fijos, el gasto variable es lo que no es fijo.
      var v = avgs[c].variable;
      if (v > 0) { variableAvg[c] = v; variableTotal += v; }
    });

    var available = income.amount - fixedTotal - goalsTotal;
    var plan = {};
    Object.keys(variableAvg).forEach(function (c) { plan[c] = variableAvg[c]; });
    var shortfall = Math.max(0, variableTotal - Math.max(available, 0));
    var cuts = {};
    function maxCut(c) {
      var flex = FLEX[c] != null ? FLEX[c] : FLEX_DEFAULT;
      return Math.floor(variableAvg[c] * Math.min(0.5, flex));
    }
    if (shortfall > 0) {
      // Recortar primero lo más prescindible, como máximo la mitad de cada categoría.
      var weights = {}, wsum = 0;
      Object.keys(plan).forEach(function (c) {
        var w = plan[c] * (FLEX[c] != null ? FLEX[c] : FLEX_DEFAULT);
        weights[c] = w; wsum += w;
      });
      var left = shortfall;
      for (var pass = 0; pass < 3 && left > 0 && wsum > 0; pass++) {
        var round = left;
        Object.keys(plan).forEach(function (c) {
          if (!weights[c]) return;
          var want = Math.ceil(round * weights[c] / wsum);
          var max = maxCut(c) - (cuts[c] || 0);
          var cut = Math.max(0, Math.min(want, max, left));
          cuts[c] = (cuts[c] || 0) + cut;
          plan[c] -= cut;
          left -= cut;
        });
        wsum = 0;
        Object.keys(plan).forEach(function (c) {
          if (maxCut(c) - (cuts[c] || 0) <= 0) weights[c] = 0;
          wsum += weights[c] || 0;
        });
      }
      shortfall = left;
    }
    var planVariable = Object.keys(plan).reduce(function (s, c) { return s + plan[c]; }, 0);
    var buffer = Math.max(0, available - planVariable);

    // Avance del mes actual
    var cur = CG.periodOf(opts.today);
    var spent = {};
    var spentTotal = 0;
    ctx.movements.forEach(function (m) {
      if (m.type !== 'gasto' || monthOf(m) !== cur || m.date > opts.today) return;
      var c = ctx.catOf(m);
      if (m.recurringId) return; // los fijos ya están en su propio renglón
      spent[c] = (spent[c] || 0) + m.amount;
      spentTotal += m.amount;
    });
    var day = CG.dayOfPeriod(opts.today);
    // Lo que normalmente se gasta después de este día del mes (promedio histórico).
    var after = {};
    ctx.movements.forEach(function (m) {
      if (m.type !== 'gasto' || m.recurringId || ctx.months.indexOf(monthOf(m)) === -1 || CG.dayOfPeriod(m.date) <= day) return;
      var c = ctx.catOf(m);
      after[c] = (after[c] || 0) + m.amount;
    });
    Object.keys(after).forEach(function (c) { after[c] = Math.round(after[c] / (ctx.months.length || 1)); });
    var hasHistory = ctx.months.length > 0;
    var projection = hasHistory ? spentTotal + Object.keys(after).reduce(function (s, c) { return s + after[c]; }, 0) : null;

    var rows = Object.keys(plan).concat(Object.keys(spent).filter(function (c) { return plan[c] == null; }))
      .map(function (c) {
        var s = spent[c] || 0;
        var p = plan[c] || 0;
        var proj = hasHistory ? s + (after[c] || 0) : null;
        return {
          category: c, avg: variableAvg[c] || 0, plan: p, cut: cuts[c] || 0, spent: s, projection: proj,
          status: !p ? (s ? 'over' : 'ok') : s > p ? 'over' : proj != null && proj > p * 1.05 ? 'risk' : 'ok'
        };
      }).sort(function (a, b) { return b.plan - a.plan || b.spent - a.spent; });

    // Ahorro real promedio (para ver si las metas son alcanzables)
    var avgSavings = null;
    if (ctx.months.length) {
      var inc = 0, exp = 0;
      ctx.movements.forEach(function (m) {
        if (ctx.months.indexOf(monthOf(m)) === -1) return;
        if (m.type === 'ingreso') inc += m.amount; else if (m.type === 'gasto') exp += m.amount;
      });
      avgSavings = Math.round((inc - exp) / ctx.months.length);
    }

    return {
      month: cur,
      months: ctx.months,
      income: income,
      fixedTotal: fixedTotal,
      fixedByCat: fixedByCat,
      goals: needs,
      goalsTotal: goalsTotal,
      available: available,
      variableAvgTotal: variableTotal,
      planVariable: planVariable,
      plan: plan,
      cuts: cuts,
      shortfall: shortfall,
      buffer: buffer,
      rows: rows,
      spentTotal: spentTotal,
      projection: projection,
      avgSavings: avgSavings,
      hasData: ctx.months.length > 0 || (opts.payslips || []).length > 0
    };
  }

  // ---------- Suscripciones y cargos que se repiten ----------
  function detectRecurringCharges(movements, todayISO, recurring) {
    var months6 = lastMonths(todayISO, 6, true);
    var groups = {};
    movements.forEach(function (m) {
      if (m.type !== 'gasto' || !m.note || m.recurringId || months6.indexOf(monthOf(m)) === -1) return;
      var key = merchantKey(m.note);
      if (key.length < 3) return;
      (groups[key] = groups[key] || []).push(m);
    });
    var templateKeys = {};
    (recurring || []).forEach(function (r) { if (r.note) templateKeys[merchantKey(r.note)] = true; });

    var out = [];
    Object.keys(groups).forEach(function (key) {
      var list = groups[key];
      var byMonth = {};
      list.forEach(function (m) { byMonth[monthOf(m)] = (byMonth[monthOf(m)] || 0) + m.amount; });
      var monthsSeen = Object.keys(byMonth).sort();
      if (monthsSeen.length < 2) return;
      // Una vez al mes (no más de ~1,5 cargos por mes) y montos parecidos.
      if (list.length > monthsSeen.length * 1.5) return;
      var amounts = monthsSeen.map(function (k) { return byMonth[k]; });
      var mean = amounts.reduce(function (s, v) { return s + v; }, 0) / amounts.length;
      var sd = Math.sqrt(amounts.reduce(function (s, v) { return s + (v - mean) * (v - mean); }, 0) / amounts.length);
      if (mean <= 0 || sd / mean > 0.2) return;
      var last = list.slice().sort(function (a, b) { return a.date < b.date ? 1 : -1; })[0];
      var nk = norm(last.note);
      // Lo que no es una suscripción conocida debe repetirse al menos 3 meses y
      // seguir activo (cobrado en alguno de los 2 últimos meses).
      if (!SUBS.test(nk)) {
        var recent = [months6[0], months6[1], months6[2]];
        if (monthsSeen.length < 3 || recent.filter(function (k) { return byMonth[k]; }).length < 2) return;
      }
      out.push({
        key: key,
        name: last.note,
        monthly: Math.round(mean),
        months: monthsSeen.length,
        lastDate: last.date,
        category: last.category,
        isSubscription: SUBS.test(nk),
        isVideo: STREAM_VIDEO.test(nk),
        isTemplate: !!templateKeys[key],
        sample: last
      });
    });
    return out.sort(function (a, b) { return b.monthly - a.monthly; });
  }

  // ---------- Consejos ----------
  // Cada consejo: { id, icon, title, text, saving (mensual), level: 'warn'|'tip'|'good', action }
  function advice(opts, plan) {
    var tips = [];
    var income = plan.income.amount;
    var catName = {};
    opts.book.categories.forEach(function (c) { catName[c.id] = c.name; });
    var fmt = CG.formatMoney;

    if (!plan.hasData) return tips;

    // 1. Suscripciones
    var charges = detectRecurringCharges(opts.movements, opts.today, opts.recurring);
    var subs = charges.filter(function (c) { return c.isSubscription; });
    var videos = subs.filter(function (c) { return c.isVideo; });
    if (videos.length >= 2) {
      var vt = videos.reduce(function (s, c) { return s + c.monthly; }, 0);
      var keep = Math.max.apply(null, videos.map(function (c) { return c.monthly; }));
      tips.push({
        id: 'streaming', icon: '📺', level: 'tip',
        title: 'Tienes ' + videos.length + ' plataformas de video',
        text: videos.map(function (c) { return c.name + ' (' + fmt(c.monthly) + ')'; }).join(', ') +
          '. Juntas cuestan ' + fmt(vt) + ' al mes. Si te quedas con una y rotas las demás según lo que quieras ver, ahorras unos ' +
          fmt((vt - keep) * 12) + ' al año.',
        saving: vt - keep
      });
    }
    subs.filter(function (c) { return !(videos.length >= 2 && c.isVideo); }).forEach(function (c) {
      tips.push({
        id: 'sub-' + c.key, icon: '🔁', level: 'tip',
        title: '¿Sigues usando ' + c.name + '?',
        text: 'Se cobra cada mes (' + fmt(c.monthly) + ', ' + fmt(c.monthly * 12) + ' al año). Si no lo usas, cancelarlo es ahorro inmediato.',
        saving: c.monthly
      });
    });
    var untracked = charges.filter(function (c) { return !c.isTemplate; });
    if (untracked.length) {
      tips.push({
        id: 'make-recurring', icon: '📌', level: 'tip',
        title: untracked.length === 1 ? 'Un cargo se repite cada mes' : untracked.length + ' cargos se repiten cada mes',
        text: untracked.slice(0, 5).map(function (c) { return c.name + ' (' + fmt(c.monthly) + ')'; }).join(', ') +
          '. Conviértelos en movimientos fijos para que el plan los tenga en cuenta desde el día 1.',
        saving: 0,
        action: { type: 'make-recurring', charges: untracked }
      });
    }

    // 2. Comisiones bancarias
    var months3 = lastMonths(opts.today, 3, true);
    var fees = opts.movements.filter(function (m) {
      return m.type === 'gasto' && months3.indexOf(monthOf(m)) !== -1 && FEES.test(norm(m.note));
    });
    if (fees.length) {
      var ft = fees.reduce(function (s, m) { return s + m.amount; }, 0);
      tips.push({
        id: 'fees', icon: '🏦', level: 'warn',
        title: 'Pagas comisiones o intereses al banco',
        text: 'En los últimos 3 meses sumaron ' + fmt(ft) + ' (' + fees.length + ' cargos). Pide que te las quiten o busca una cuenta sin comisiones.',
        saving: Math.round(ft / 3)
      });
    }

    // 3. Categorías que se dispararon (mes anterior vs. promedio)
    var prev = CG.addMonths(CG.periodOf(opts.today), -1);
    var prevByCat = {};
    opts.movements.forEach(function (m) {
      if (m.type === 'gasto' && !m.recurringId && monthOf(m) === prev) {
        var c = catName[m.category] ? m.category : 'otros';
        prevByCat[c] = (prevByCat[c] || 0) + m.amount;
      }
    });
    Object.keys(prevByCat).forEach(function (c) {
      var avg = plan.plan[c] != null ? (plan.cuts[c] || 0) + plan.plan[c] : 0;
      var diff = prevByCat[c] - avg;
      if (avg > 0 && prevByCat[c] > avg * 1.25 && (!income || diff > income * 0.03)) {
        tips.push({
          id: 'spike-' + c, icon: '📈', level: 'warn',
          title: catName[c] + ': gastaste más de lo habitual',
          text: 'El mes pasado fueron ' + fmt(prevByCat[c]) + ', un ' + Math.round((prevByCat[c] / avg - 1) * 100) +
            '% más que tu promedio (' + fmt(avg) + '). Volver al promedio libera ' + fmt(diff) + ' al mes.',
          saving: diff
        });
      }
    });

    // 4. Gastos hormiga: muchas compras pequeñas en una categoría
    var smallLimit = income ? Math.max(income * 0.015, 500) : 1500;
    var small = {};
    opts.movements.forEach(function (m) {
      if (m.type !== 'gasto' || m.recurringId || monthOf(m) !== prev || m.amount > smallLimit) return;
      var c = catName[m.category] ? m.category : 'otros';
      small[c] = small[c] || { n: 0, total: 0 };
      small[c].n++;
      small[c].total += m.amount;
    });
    Object.keys(small).forEach(function (c) {
      if (small[c].n >= 8) {
        tips.push({
          id: 'ant-' + c, icon: '🐜', level: 'tip',
          title: 'Gastos hormiga en ' + catName[c],
          text: small[c].n + ' compras pequeñas el mes pasado sumaron ' + fmt(small[c].total) +
            '. Reducirlas a la mitad ahorra unos ' + fmt(Math.round(small[c].total / 2)) + ' al mes.',
          saving: Math.round(small[c].total / 2)
        });
      }
    });

    // 5. Metas que no alcanzan
    if (plan.shortfall > 0) {
      tips.push({
        id: 'shortfall', icon: '⚠️', level: 'warn',
        title: 'Tus metas piden más de lo que te queda',
        text: 'Aun recortando lo prescindible faltan ' + fmt(plan.shortfall) +
          ' al mes. Puedes alargar la fecha de alguna meta, bajar su monto o recortar más en ocio y otros.',
        saving: 0
      });
    } else if (Object.keys(plan.cuts).length) {
      var cutText = Object.keys(plan.cuts).filter(function (c) { return plan.cuts[c] > 0; })
        .map(function (c) { return catName[c] + ' −' + fmt(plan.cuts[c]); }).join(', ');
      if (cutText) {
        tips.push({
          id: 'cuts', icon: '✂️', level: 'tip',
          title: 'Para cumplir tus metas, ajusta',
          text: cutText + ' respecto a tu promedio. Ya está aplicado en el plan de este mes.',
          saving: 0
        });
      }
    }
    plan.goals.forEach(function (n) {
      if (n.overdue) {
        tips.push({
          id: 'overdue-' + n.goal.id, icon: '⏰', level: 'warn',
          title: 'La meta «' + n.goal.name + '» venció',
          text: 'Faltan ' + fmt(n.remaining) + '. Ponle una fecha nueva para que el plan calcule cuánto apartar.',
          saving: 0
        });
      }
    });

    // 6. Tasa de ahorro
    if (plan.avgSavings != null && income > 0) {
      var rate = plan.avgSavings / income;
      if (rate < 0) {
        tips.push({ id: 'negative', icon: '🚨', level: 'warn', title: 'Estás gastando más de lo que ganas',
          text: 'En promedio, cada mes salen ' + fmt(-plan.avgSavings) + ' más de lo que entra. Revisa primero los fijos y las suscripciones.', saving: 0 });
      } else if (rate < 0.1) {
        tips.push({ id: 'low-savings', icon: '🐷', level: 'warn', title: 'Ahorras menos del 10%',
          text: 'Ahorras en promedio ' + fmt(plan.avgSavings) + ' al mes (' + Math.round(rate * 100) +
            '% de tus ingresos). Una buena meta es el 10–20%: ' + fmt(Math.round(income * 0.1)) + ' a ' + fmt(Math.round(income * 0.2)) + ' al mes.', saving: 0 });
      } else if (rate >= 0.2) {
        tips.push({ id: 'good-savings', icon: '🌟', level: 'good', title: '¡Buen ritmo de ahorro!',
          text: 'Ahorras en promedio el ' + Math.round(rate * 100) + '% de tus ingresos (' + fmt(plan.avgSavings) + ' al mes).', saving: 0 });
      }
    }

    // 7. Fondo de emergencia
    var hasEmergency = (opts.goals || []).some(function (g) { return EMERGENCY.test(norm(g.name)); });
    if (!hasEmergency && plan.months.length) {
      var monthlyExp = plan.fixedTotal + plan.variableAvgTotal;
      if (monthlyExp > 0) {
        tips.push({ id: 'emergency', icon: '🛟', level: 'tip', title: 'Crea un fondo de emergencia',
          text: 'Lo recomendable son 3 a 6 meses de gastos: para ti, entre ' + fmt(monthlyExp * 3) + ' y ' + fmt(monthlyExp * 6) +
            '. Te protege de imprevistos sin endeudarte.', saving: 0, action: { type: 'emergency-goal', target: monthlyExp * 3 } });
      }
    }

    // 8. Nómina
    var ps = latestPayslips(opts.payslips || [], 2);
    if (ps.length === 2 && ps[1].net > 0) {
      var change = (ps[0].net - ps[1].net) / ps[1].net;
      if (Math.abs(change) >= 0.05) {
        tips.push({ id: 'payslip-change', icon: change > 0 ? '💼' : '📉', level: change > 0 ? 'good' : 'warn',
          title: 'Tu nómina ' + (change > 0 ? 'subió' : 'bajó') + ' un ' + Math.abs(Math.round(change * 100)) + '%',
          text: 'Pasó de ' + fmt(ps[1].net) + ' a ' + fmt(ps[0].net) + ' netos. ' +
            (change > 0 ? 'Si mantienes tus gastos, destina la diferencia a tus metas.' : 'Revisa si cambió la retención o hubo menos horas o pluses.'),
          saving: 0 });
      }
    }
    if (ps[0] && ps[0].gross > 0 && ps[0].tax > 0) {
      var tr = ps[0].tax / ps[0].gross;
      if (ps[1] && ps[1].gross > 0 && ps[1].tax > 0 && Math.abs(tr - ps[1].tax / ps[1].gross) >= 0.02) {
        tips.push({ id: 'tax-change', icon: '🧾', level: 'tip', title: 'Cambió tu retención de impuestos',
          text: 'Pasó del ' + (ps[1].tax / ps[1].gross * 100).toFixed(1) + '% al ' + (tr * 100).toFixed(1) + '% del bruto. Si no esperabas el cambio, consúltalo con tu empresa.', saving: 0 });
      }
    }

    var order = { warn: 0, tip: 1, good: 2 };
    return tips.sort(function (a, b) { return (b.saving || 0) - (a.saving || 0) || order[a.level] - order[b.level]; });
  }

  // ¿La nómina del mes coincide con un ingreso del extracto?
  // Ingreso del extracto que corresponde a la nómina. Se paga a fin de mes, a
  // comienzos del siguiente o, en algunos empleos, uno o dos meses después.
  function matchPayslip(payslip, movements) {
    var from = payslip.month + '-15';
    var to = CG.addMonths(payslip.month, 3) + '-10';
    var target = CG.addMonths(payslip.month, 1) + '-01';
    var candidates = movements.filter(function (m) {
      return m.type === 'ingreso' && m.date >= from && m.date <= to &&
        Math.abs(m.amount - payslip.net) <= Math.max(100, payslip.net * 0.01);
    });
    // Si hay varias (nóminas iguales cada mes), la más cercana al fin de ese mes.
    candidates.sort(function (a, b) {
      return Math.abs(CG.parseISODate(a.date) - CG.parseISODate(target)) - Math.abs(CG.parseISODate(b.date) - CG.parseISODate(target));
    });
    return candidates[0] || null;
  }

  window.Planner = {
    buildPlan: buildPlan,
    advice: advice,
    detectRecurringCharges: detectRecurringCharges,
    matchPayslip: matchPayslip,
    merchantKey: merchantKey,
    payslipFor: payslipFor
  };
})();
