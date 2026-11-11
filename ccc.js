/*
 * ccc.js - the finance math for the ElectroMart CCC app.
 *
 * Every function here is a plain function: it takes numbers or text and
 * returns numbers or text. Nothing here reads or changes the web page, so
 * the same file runs in the browser (as window.CCC) and in Node
 * (require('./ccc.js')), which is how the numbers are checked before a push.
 *
 * Conventions (from CLAUDE.md):
 *   DIO = Inventory / COGS x days in year
 *   DSO = Accounts receivable / Revenue x days in year   (all sales on credit)
 *   DPO = Accounts payable / COGS x days in year         (purchases = COGS)
 *   CCC = DIO + DSO - DPO
 *   Cash freed: a drop in an asset frees cash; a rise in accounts payable
 *   frees cash. Inputs and intermediate results are never rounded; only the
 *   format* functions round, and only for display.
 */
(function (root) {
  'use strict';

  // ------------------------------------------------------------------
  // Reading the CSV files
  // ------------------------------------------------------------------

  // Turn CSV text into an array of objects keyed by the (lower-cased) header
  // row. Handles quoted fields, "" inside quotes, Windows line endings, a
  // byte-order mark from Excel, and blank lines.
  function parseCsv(text) {
    const src = String(text).replace(/^﻿/, '');
    const rows = [];
    let row = [];
    let field = '';
    let inQuotes = false;

    for (let i = 0; i < src.length; i++) {
      const ch = src[i];
      if (inQuotes) {
        if (ch === '"') {
          if (src[i + 1] === '"') { field += '"'; i++; } else { inQuotes = false; }
        } else {
          field += ch;
        }
      } else if (ch === '"') {
        inQuotes = true;
      } else if (ch === ',') {
        row.push(field);
        field = '';
      } else if (ch === '\n' || ch === '\r') {
        if (ch === '\r' && src[i + 1] === '\n') i++;
        row.push(field);
        rows.push(row);
        row = [];
        field = '';
      } else {
        field += ch;
      }
    }
    if (inQuotes) throw new Error('The CSV has a quote (") that is never closed.');
    if (field !== '' || row.length > 0) { row.push(field); rows.push(row); }

    const nonBlank = rows.filter(function (r) {
      return r.some(function (cell) { return cell.trim() !== ''; });
    });
    if (nonBlank.length === 0) return [];

    const header = nonBlank[0].map(function (h) { return h.trim().toLowerCase(); });
    return nonBlank.slice(1).map(function (r) {
      const obj = {};
      header.forEach(function (h, j) { obj[h] = (r[j] === undefined ? '' : r[j]).trim(); });
      return obj;
    });
  }

  // Convert one CSV cell to a number. Allows a leading $ and thousands
  // commas (common in files saved from Excel). Anything else, including an
  // empty cell, is an error rather than a silent zero.
  function toNumber(value, label) {
    const cleaned = String(value).trim().replace(/[$,]/g, '');
    const n = Number(cleaned);
    if (cleaned === '' || !Number.isFinite(n)) {
      throw new Error(label + ' is "' + value + '", which is not a number.');
    }
    return n;
  }

  function requireColumns(rows, columns, fileLabel) {
    if (rows.length === 0) throw new Error(fileLabel + ' has no data rows.');
    columns.forEach(function (c) {
      if (!(c in rows[0])) throw new Error(fileLabel + ' is missing the "' + c + '" column.');
    });
  }

  const SECTIONS = ['income_statement', 'asset', 'liability_or_equity'];

  // The lines the cash conversion cycle needs, and the section each must be in.
  const REQUIRED_LINES = [
    { section: 'income_statement', item: 'revenue' },
    { section: 'income_statement', item: 'cogs' },
    { section: 'asset', item: 'accounts_receivable' },
    { section: 'asset', item: 'inventory' },
    { section: 'liability_or_equity', item: 'accounts_payable' }
  ];

  // Read the statements CSV (section,item,before,after).
  // Returns every line as numbers, plus the five lines the CCC uses for each
  // period, plus balance-sheet totals by section for a data check.
  function readStatements(rows, fileLabel) {
    const label = fileLabel || 'The statements file';
    requireColumns(rows, ['section', 'item', 'before', 'after'], label);

    const lines = {};
    rows.forEach(function (r, i) {
      const where = label + ', row ' + (i + 2) + ' (' + (r.item || 'no item') + ')';
      const section = r.section.toLowerCase();
      const item = r.item.toLowerCase();
      if (SECTIONS.indexOf(section) === -1) {
        throw new Error(where + ': section "' + r.section + '" must be one of ' + SECTIONS.join(', ') + '.');
      }
      if (item === '') throw new Error(where + ': the item name is blank.');
      const key = section + '|' + item;
      if (key in lines) throw new Error(where + ': ' + item + ' appears twice in ' + section + '.');
      lines[key] = {
        section: section,
        item: item,
        before: toNumber(r.before, where + ' Before'),
        after: toNumber(r.after, where + ' After')
      };
    });

    const before = {};
    const after = {};
    REQUIRED_LINES.forEach(function (need) {
      const line = lines[need.section + '|' + need.item];
      if (!line) throw new Error(label + ' needs a line with section ' + need.section + ' and item ' + need.item + '.');
      before[need.item] = line.before;
      after[need.item] = line.after;
    });
    ['revenue', 'cogs'].forEach(function (k) {
      if (!(before[k] > 0) || !(after[k] > 0)) {
        throw new Error(label + ': ' + k + ' must be greater than zero in both periods, because the day counts divide by it.');
      }
    });

    function sectionTotal(section, period) {
      return Object.keys(lines).reduce(function (sum, key) {
        return lines[key].section === section ? sum + lines[key][period] : sum;
      }, 0);
    }

    return {
      lines: Object.keys(lines).map(function (k) { return lines[k]; }),
      before: before,
      after: after,
      totals: {
        before: { assets: sectionTotal('asset', 'before'), liabilitiesAndEquity: sectionTotal('liability_or_equity', 'before') },
        after: { assets: sectionTotal('asset', 'after'), liabilitiesAndEquity: sectionTotal('liability_or_equity', 'after') }
      }
    };
  }

  // Read the assumptions CSV (assumption,value,note) into { name: number }.
  function readAssumptions(rows, fileLabel) {
    const label = fileLabel || 'The assumptions file';
    requireColumns(rows, ['assumption', 'value'], label);
    const out = {};
    rows.forEach(function (r, i) {
      const name = r.assumption.toLowerCase();
      if (name === '') throw new Error(label + ', row ' + (i + 2) + ': the assumption name is blank.');
      out[name] = toNumber(r.value, label + ', ' + name);
    });
    if (!(out.days_in_year > 0)) {
      throw new Error(label + ' needs a days_in_year greater than zero.');
    }
    return out;
  }

  // ------------------------------------------------------------------
  // The cash conversion cycle
  // ------------------------------------------------------------------

  function dio(inventory, cogs, daysInYear) { return inventory / cogs * daysInYear; }
  function dso(receivables, revenue, daysInYear) { return receivables / revenue * daysInYear; }
  function dpo(payables, cogs, daysInYear) { return payables / cogs * daysInYear; }
  function ccc(dioDays, dsoDays, dpoDays) { return dioDays + dsoDays - dpoDays; }

  // All four day counts for one period's figures.
  function cycle(p, daysInYear) {
    const d = {
      dio: dio(p.inventory, p.cogs, daysInYear),
      dso: dso(p.accounts_receivable, p.revenue, daysInYear),
      dpo: dpo(p.accounts_payable, p.cogs, daysInYear)
    };
    d.ccc = ccc(d.dio, d.dso, d.dpo);
    return d;
  }

  // ------------------------------------------------------------------
  // Cash freed
  // ------------------------------------------------------------------

  // An asset (inventory, receivables): a drop frees cash.
  function cashFreedByAsset(before, after) { return before - after; }

  // Accounts payable: a rise frees cash (suppliers finance more of the cycle).
  function cashFreedByPayables(before, after) { return after - before; }

  // The same figure worked out from the days: days changed x annual base / days in year.
  function cashFromDays(daysChanged, annualBase, daysInYear) { return daysChanged * annualBase / daysInYear; }

  // Everything the page shows, worked out from the two CSV files.
  function analyze(statements, assumptions) {
    const days = assumptions.days_in_year;
    const b = statements.before;
    const a = statements.after;
    const before = cycle(b, days);
    const after = cycle(a, days);

    // The days-based check only holds when the base (COGS or revenue) is the
    // same in both periods, as the case assumes. If it changed, report null.
    const sameCogs = b.cogs === a.cogs;
    const sameRevenue = b.revenue === a.revenue;

    const inventory = {
      before: b.inventory,
      after: a.inventory,
      freed: cashFreedByAsset(b.inventory, a.inventory),
      daysChanged: before.dio - after.dio, // days cut
      base: b.cogs,
      baseName: 'COGS'
    };
    inventory.fromDays = sameCogs ? cashFromDays(inventory.daysChanged, b.cogs, days) : null;

    const receivables = {
      before: b.accounts_receivable,
      after: a.accounts_receivable,
      freed: cashFreedByAsset(b.accounts_receivable, a.accounts_receivable),
      daysChanged: before.dso - after.dso, // days cut
      base: b.revenue,
      baseName: 'revenue'
    };
    receivables.fromDays = sameRevenue ? cashFromDays(receivables.daysChanged, b.revenue, days) : null;

    const payables = {
      before: b.accounts_payable,
      after: a.accounts_payable,
      freed: cashFreedByPayables(b.accounts_payable, a.accounts_payable),
      daysChanged: after.dpo - before.dpo, // days added
      base: b.cogs,
      baseName: 'COGS'
    };
    payables.fromDays = sameCogs ? cashFromDays(payables.daysChanged, b.cogs, days) : null;

    return {
      daysInYear: days,
      inputs: { before: b, after: a },
      before: before,
      after: after,
      change: {
        dio: after.dio - before.dio,
        dso: after.dso - before.dso,
        dpo: after.dpo - before.dpo,
        ccc: after.ccc - before.ccc
      },
      cashFreed: {
        inventory: inventory,
        receivables: receivables,
        payables: payables,
        total: inventory.freed + receivables.freed + payables.freed
      },
      checks: {
        before: statements.totals.before,
        after: statements.totals.after,
        sameCogs: sameCogs,
        sameRevenue: sameRevenue
      }
    };
  }

  // ------------------------------------------------------------------
  // Formatting for display (the only place anything is rounded)
  // ------------------------------------------------------------------

  const TWO_DP = new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const WHOLE = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });
  const UP_TO_TWO_DP = new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 });

  // Round half away from zero, and never show "-0".
  function roundTo(x, places) {
    const f = Math.pow(10, places);
    const r = Math.sign(x) * Math.round(Math.abs(x) * f) / f;
    return r === 0 ? 0 : r;
  }

  // Days to two decimals: 73.00
  function formatDays(x) { return TWO_DP.format(roundTo(x, 2)); }

  // A change in days with its sign: +18.25, -58.40, 0.00
  function formatDaysChange(x) {
    const r = roundTo(x, 2);
    return (r > 0 ? '+' : '') + TWO_DP.format(r);
  }

  // Dollars to the nearest dollar: $600,000 or -$100,000
  function formatDollars(x) {
    const r = roundTo(x, 0);
    return (r < 0 ? '-' : '') + '$' + WHOLE.format(Math.abs(r));
  }

  // A figure inside a written-out formula, as it appears in the data: 1,200,000
  function formatAmount(x) { return UP_TO_TWO_DP.format(x); }

  // A rate as a percent to two decimals: 0.08 -> 8.00%
  function formatPercent(x) { return TWO_DP.format(roundTo(x * 100, 2)) + '%'; }

  const api = {
    parseCsv: parseCsv,
    toNumber: toNumber,
    readStatements: readStatements,
    readAssumptions: readAssumptions,
    dio: dio,
    dso: dso,
    dpo: dpo,
    ccc: ccc,
    cycle: cycle,
    cashFreedByAsset: cashFreedByAsset,
    cashFreedByPayables: cashFreedByPayables,
    cashFromDays: cashFromDays,
    analyze: analyze,
    formatDays: formatDays,
    formatDaysChange: formatDaysChange,
    formatDollars: formatDollars,
    formatAmount: formatAmount,
    formatPercent: formatPercent
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else {
    root.CCC = api;
  }
})(typeof window !== 'undefined' ? window : this);
