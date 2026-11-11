/*
 * app.js - loads the data and fills in the page.
 *
 * All of the finance math lives in ccc.js (window.CCC). This file only
 * fetches the CSV files, passes them to ccc.js, and writes the results
 * into the page.
 */
(function () {
  'use strict';

  const STATEMENTS_FILE = 'data/electromart.csv';
  const ASSUMPTIONS_FILE = 'data/assumptions.csv';

  const C = window.CCC;
  const days = C.formatDays;
  const daysChange = C.formatDaysChange;
  const dollars = C.formatDollars;
  const amt = C.formatAmount;

  // Fetch a file next to this page and return its text.
  async function getText(path) {
    let response;
    try {
      // "no-cache" asks the server whether the file changed, so an edited
      // CSV shows up instead of an old copy.
      response = await fetch(path, { cache: 'no-cache' });
    } catch (err) {
      throw new Error('Couldn\'t load ' + path + '. If you opened index.html straight from your computer, the browser blocks this. It works once the app is published or served by a web server.');
    }
    if (!response.ok) {
      throw new Error('Couldn\'t load ' + path + ' (the server answered ' + response.status + ').');
    }
    return response.text();
  }

  function setText(id, text) {
    document.getElementById(id).textContent = text;
  }

  // Add a heading line plus indented lines to a "math" box.
  function addMathBlock(container, heading, lines) {
    const block = document.createElement('div');
    block.className = 'math-block';
    const h = document.createElement('p');
    h.className = 'math-head';
    h.textContent = heading;
    block.appendChild(h);
    lines.forEach(function (line) {
      const p = document.createElement('p');
      p.textContent = line;
      block.appendChild(p);
    });
    container.appendChild(block);
  }

  function addNote(container, text) {
    const p = document.createElement('p');
    p.className = 'math-note';
    p.textContent = text;
    container.appendChild(p);
  }

  function renderCycle(r) {
    ['dio', 'dso', 'dpo', 'ccc'].forEach(function (k) {
      setText(k + '-before', days(r.before[k]));
      setText(k + '-after', days(r.after[k]));
      setText(k + '-change', daysChange(r.change[k]));
    });

    const box = document.getElementById('cycle-math');
    box.textContent = '';
    const y = amt(r.daysInYear);
    const b = r.inputs.before;
    const a = r.inputs.after;

    addMathBlock(box, 'DIO = Inventory / COGS × ' + y, [
      'Before: ' + amt(b.inventory) + ' / ' + amt(b.cogs) + ' × ' + y + ' = ' + days(r.before.dio),
      'After: ' + amt(a.inventory) + ' / ' + amt(a.cogs) + ' × ' + y + ' = ' + days(r.after.dio)
    ]);
    addMathBlock(box, 'DSO = Accounts receivable / Revenue × ' + y, [
      'Before: ' + amt(b.accounts_receivable) + ' / ' + amt(b.revenue) + ' × ' + y + ' = ' + days(r.before.dso),
      'After: ' + amt(a.accounts_receivable) + ' / ' + amt(a.revenue) + ' × ' + y + ' = ' + days(r.after.dso)
    ]);
    addMathBlock(box, 'DPO = Accounts payable / COGS × ' + y, [
      'Before: ' + amt(b.accounts_payable) + ' / ' + amt(b.cogs) + ' × ' + y + ' = ' + days(r.before.dpo),
      'After: ' + amt(a.accounts_payable) + ' / ' + amt(a.cogs) + ' × ' + y + ' = ' + days(r.after.dpo)
    ]);
    addMathBlock(box, 'CCC = DIO + DSO − DPO', [
      'Before: ' + days(r.before.dio) + ' + ' + days(r.before.dso) + ' − ' + days(r.before.dpo) + ' = ' + days(r.before.ccc),
      'After: ' + days(r.after.dio) + ' + ' + days(r.after.dso) + ' − ' + days(r.after.dpo) + ' = ' + days(r.after.ccc)
    ]);
    addNote(box, 'Uses a ' + y + '-day year. The math uses unrounded figures; only the displayed results are rounded to two decimals.');
  }

  // One lever's "check against the days" lines.
  function leverLines(lever, isPayables, daysBefore, daysAfter, daysInYear) {
    const lines = [];
    if (isPayables) {
      lines.push('From the balance sheet (After − Before): ' + amt(lever.after) + ' − ' + amt(lever.before) + ' = ' + dollars(lever.freed));
    } else {
      lines.push('From the balance sheet (Before − After): ' + amt(lever.before) + ' − ' + amt(lever.after) + ' = ' + dollars(lever.freed));
    }
    if (lever.fromDays === null) {
      lines.push('From the days: not shown, because ' + lever.baseName + ' changed between the two periods.');
      return lines;
    }
    const first = isPayables ? daysAfter : daysBefore;
    const second = isPayables ? daysBefore : daysAfter;
    const matches = Math.abs(lever.fromDays - lever.freed) < 0.005;
    lines.push(
      'From the days: (' + days(first) + ' − ' + days(second) + ') × ' + amt(lever.base) +
      ' / ' + amt(daysInYear) + ' = ' + dollars(lever.fromDays) +
      (matches ? '  ✓ matches' : '  ✗ differs by ' + dollars(lever.fromDays - lever.freed))
    );
    return lines;
  }

  function renderCash(r) {
    const cf = r.cashFreed;
    [['inv', cf.inventory], ['ar', cf.receivables], ['ap', cf.payables]].forEach(function (pair) {
      setText(pair[0] + '-before', dollars(pair[1].before));
      setText(pair[0] + '-after', dollars(pair[1].after));
      setText(pair[0] + '-freed', dollars(pair[1].freed));
    });
    setText('total-freed', dollars(cf.total));

    const box = document.getElementById('cash-math');
    box.textContent = '';
    addMathBlock(box, 'Inventory (DIO, days of COGS)',
      leverLines(cf.inventory, false, r.before.dio, r.after.dio, r.daysInYear));
    addMathBlock(box, 'Receivables (DSO, days of revenue)',
      leverLines(cf.receivables, false, r.before.dso, r.after.dso, r.daysInYear));
    addMathBlock(box, 'Payables (DPO, days of COGS)',
      leverLines(cf.payables, true, r.before.dpo, r.after.dpo, r.daysInYear));
    addMathBlock(box, 'Total', [
      dollars(cf.inventory.freed) + ' + ' + dollars(cf.receivables.freed) + ' + ' + dollars(cf.payables.freed) + ' = ' + dollars(cf.total)
    ]);
    addNote(box, 'Cash freed = days changed × annual COGS (or revenue) / days in the year. Both ways of working it out should give the same dollars.');
  }

  function renderData(r) {
    const rows = [
      ['Revenue', 'revenue'],
      ['COGS', 'cogs'],
      ['Accounts receivable', 'accounts_receivable'],
      ['Inventory', 'inventory'],
      ['Accounts payable', 'accounts_payable']
    ];
    const tbody = document.getElementById('data-rows');
    tbody.textContent = '';
    rows.forEach(function (row) {
      const tr = document.createElement('tr');
      const th = document.createElement('th');
      th.scope = 'row';
      th.textContent = row[0];
      const tdB = document.createElement('td');
      tdB.textContent = dollars(r.inputs.before[row[1]]);
      const tdA = document.createElement('td');
      tdA.textContent = dollars(r.inputs.after[row[1]]);
      tr.appendChild(th);
      tr.appendChild(tdB);
      tr.appendChild(tdA);
      tbody.appendChild(tr);
    });

    const list = document.getElementById('data-checks');
    list.textContent = '';
    function check(ok, text) {
      const li = document.createElement('li');
      li.className = ok ? 'ok' : 'warn';
      li.textContent = (ok ? '✓ ' : '! ') + text;
      list.appendChild(li);
    }
    ['before', 'after'].forEach(function (period) {
      const t = r.checks[period];
      const ok = Math.abs(t.assets - t.liabilitiesAndEquity) < 0.005;
      const name = period === 'before' ? 'Before' : 'After';
      check(ok, name + ' balance sheet: assets ' + dollars(t.assets) +
        (ok ? ' = ' : ' ≠ ') + 'liabilities and equity ' + dollars(t.liabilitiesAndEquity));
    });
    check(r.checks.sameRevenue && r.checks.sameCogs,
      r.checks.sameRevenue && r.checks.sameCogs
        ? 'Revenue and COGS are the same in both periods, as the case assumes'
        : 'Revenue or COGS differs between the periods; the case assumes they are the same');
    check(true, 'Days in the year: ' + amt(r.daysInYear) + ' (from data/assumptions.csv)');
  }

  async function start() {
    const status = document.getElementById('status');
    try {
      const texts = await Promise.all([getText(STATEMENTS_FILE), getText(ASSUMPTIONS_FILE)]);
      const statements = C.readStatements(C.parseCsv(texts[0]), STATEMENTS_FILE);
      const assumptions = C.readAssumptions(C.parseCsv(texts[1]), ASSUMPTIONS_FILE);
      const result = C.analyze(statements, assumptions);

      renderCycle(result);
      renderCash(result);
      renderData(result);

      status.hidden = true;
      ['cycle-section', 'cash-section', 'data-section'].forEach(function (id) {
        document.getElementById(id).hidden = false;
      });
    } catch (err) {
      status.textContent = err.message;
      status.classList.add('error');
    }
  }

  start();

  // Register the service worker (sw.js) so the app installs and works
  // offline. 'sw.js' is a relative path, so it works at
  // https://<username>.github.io/<repository>/. Browsers only allow service
  // workers over https (or on this computer), so opening index.html straight
  // from a folder skips this step and the page still works online.
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', function () {
      navigator.serviceWorker.register('sw.js').catch(function (err) {
        console.warn('The offline service worker was not registered: ' + err.message);
      });
    });
  }
})();
