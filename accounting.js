/* Saf hesaplar: DOM, localStorage ve devir kayıtları içermez. Tüm tutarlar kuruştur. */
(function (root) {
  'use strict';
  const MAX_AMOUNT = 100000000000;
  const pad = n => String(n).padStart(2, '0');
  const iso = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const today = () => iso(new Date());
  const normalizeName = s => s.trim().replace(/\s+/g, ' ').normalize('NFC');
  const nameKey = s => normalizeName(s).toLocaleLowerCase('tr-TR');
  function validPeriod(p) {
    return typeof p === 'string' && /^\d{4}-\d{2}$/.test(p) && +p.slice(0, 4) >= 1900 && +p.slice(0, 4) <= 9998 && +p.slice(5) >= 1 && +p.slice(5) <= 12;
  }
  function validDate(s) {
    if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
    const d = new Date(s + 'T12:00:00');
    return !isNaN(d) && iso(d) === s && +s.slice(0, 4) >= 1900 && +s.slice(0, 4) <= 9998;
  }
  function periodOf(s) {
    if (!validDate(s)) throw Error('Geçersiz tarih.');
    let [y, m, d] = s.split('-').map(Number);
    if (d < 15 && --m === 0) { m = 12; y--; }
    return `${y}-${pad(m)}`;
  }
  function movePeriod(p, delta) {
    if (!validPeriod(p) || !Number.isInteger(delta)) throw Error('Geçersiz dönem.');
    const [y, m] = p.split('-').map(Number), serial = y * 12 + m - 1 + delta;
    return `${Math.floor(serial / 12)}-${pad(serial % 12 + 1)}`;
  }
  const bounds = p => ({ start: p + '-15', end: movePeriod(p, 1) + '-14' });
  function cents(s, { signed = false, zero = false } = {}) {
    s = String(s).trim().replace(',', '.');
    if (!(signed ? /^-?\d+(\.\d{1,2})?$/ : /^\d+(\.\d{1,2})?$/).test(s)) throw Error('Tutarı 1250,50 biçiminde, en fazla iki ondalıkla girin.');
    const negative = s.startsWith('-'), [whole, fraction = ''] = s.replace('-', '').split('.');
    const n = (Number(whole) * 100 + Number(fraction.padEnd(2, '0'))) * (negative ? -1 : 1);
    if (!Number.isSafeInteger(n) || Math.abs(n) > MAX_AMOUNT || (!zero && n === 0) || (!signed && n < 0)) throw Error('Tutar geçersiz veya 1 milyar TL sınırını aşıyor.');
    return n;
  }
  function sum(values) {
    const n = values.reduce((a, b) => a + b, 0);
    if (!Number.isSafeInteger(n)) throw Error('Hesap toplamı güvenli tutar sınırını aşıyor.');
    return n;
  }
  function earliestDate(d, fallback = today()) {
    return [...d.expenses, ...d.payments].reduce((a, x) => x.date < a ? x.date : a, fallback);
  }
  function blank(date = today()) {
    return { version: 2, people: [], materials: [], expenses: [], payments: [], periods: {}, cash: { amount: 0, date }, migrationNoticeSeen: true, updatedAt: null };
  }
  function validate(d) {
    if (!d || ![1, 2].includes(d.version) || !['people', 'materials', 'expenses', 'payments'].every(k => Array.isArray(d[k])) || !d.periods || typeof d.periods !== 'object' || Array.isArray(d.periods)) throw Error('Geçerli bir Pay Defteri yedeği değil.');
    const ids = new Set();
    for (const arr of [d.people, d.materials, d.expenses, d.payments]) for (const x of arr) {
      if (!x || typeof x !== 'object' || typeof x.id !== 'string' || !x.id || x.id.length > 100 || ids.has(x.id)) throw Error('Geçersiz veya tekrarlanan kayıt kimliği.');
      ids.add(x.id);
    }
    for (const arr of [d.people, d.materials]) for (const x of arr) {
      if (typeof x.name !== 'string' || !normalizeName(x.name) || x.name.length > 120 || typeof x.archived !== 'boolean') throw Error('Geçersiz kişi veya malzeme.');
    }
    const ps = new Set(d.people.map(x => x.id)), ms = new Set(d.materials.map(x => x.id));
    for (const [p, members] of Object.entries(d.periods)) {
      if (!validPeriod(p) || !Array.isArray(members) || new Set(members).size !== members.length || members.some(x => !ps.has(x))) throw Error('Geçersiz dönem katılımcıları.');
    }
    for (const [arr, expense] of [[d.expenses, true], [d.payments, false]]) for (const x of arr) {
      if (!validDate(x.date) || !Number.isSafeInteger(x.amount) || x.amount <= 0 || x.amount > MAX_AMOUNT || typeof x.note !== 'string' || x.note.length > 500) throw Error('Geçersiz tarih, tutar veya açıklama.');
      if (expense ? !ms.has(x.materialId) || !validPeriod(periodOf(x.date)) : !ps.has(x.personId) || !validPeriod(x.period)) throw Error('Kayıt ilişkisi veya hesap dönemi geçersiz.');
    }
    if (d.updatedAt !== null && (typeof d.updatedAt !== 'string' || isNaN(Date.parse(d.updatedAt)))) throw Error('Geçersiz son kayıt zamanı.');
    const total = sum([...d.expenses, ...d.payments].map(x => x.amount));
    if (d.version === 2) {
      if (!d.cash || !validDate(d.cash.date) || !Number.isSafeInteger(d.cash.amount) || Math.abs(d.cash.amount) > MAX_AMOUNT || typeof d.migrationNoticeSeen !== 'boolean') throw Error('Geçersiz başlangıç kasa ayarı.');
      sum([total, Math.abs(d.cash.amount)]);
    }
    return d;
  }
  function migrate(input, date = today()) {
    validate(input);
    const d = structuredClone(input);
    if (d.version === 1) {
      d.version = 2;
      d.cash = { amount: 0, date: earliestDate(d, date) };
      d.migrationNoticeSeen = false;
    }
    return validate(d);
  }
  function split(total, members) {
    const base = members.length ? Math.floor(total / members.length) : 0;
    const rem = members.length ? total % members.length : 0;
    return new Map(members.map((pid, i) => [pid, base + (i < rem ? 1 : 0)]));
  }
  function periodKeys(d) {
    return [...new Set([...Object.keys(d.periods), ...d.expenses.map(x => periodOf(x.date)), ...d.payments.map(x => x.period)])].sort();
  }
  function periodTotals(d) {
    const totals = new Map();
    for (const x of d.expenses) { const p = periodOf(x.date); totals.set(p, sum([totals.get(p) || 0, x.amount])); }
    return totals;
  }
  function paymentTotals(d) {
    const totals = new Map();
    for (const x of d.payments) {
      if (!totals.has(x.period)) totals.set(x.period, new Map());
      const group = totals.get(x.period);
      group.set(x.personId, sum([group.get(x.personId) || 0, x.amount]));
    }
    return totals;
  }
  function calculate(d, p) {
    if (!validPeriod(p)) throw Error('Geçersiz hesap dönemi.');
    const totals = periodTotals(d), paymentsByPeriod = paymentTotals(d), balances = new Map(d.people.map(x => [x.id, 0]));
    for (const key of periodKeys(d).filter(key => key < p)) {
      const shares = split(totals.get(key) || 0, d.periods[key] || []), paid = paymentsByPeriod.get(key) || new Map();
      for (const pid of balances.keys()) balances.set(pid, sum([balances.get(pid), shares.get(pid) || 0, -(paid.get(pid) || 0)]));
    }
    const members = d.periods[p] || [], total = totals.get(p) || 0, shares = split(total, members), payments = d.payments.filter(x => x.period === p);
    const paidByPerson = paymentsByPeriod.get(p) || new Map();
    const rows = d.people.map(person => {
      const opening = balances.get(person.id), due = shares.get(person.id) || 0, paid = paidByPerson.get(person.id) || 0, net = sum([opening, due, -paid]);
      return { id: person.id, member: members.includes(person.id), opening, openingDebt: Math.max(0, opening), openingCredit: Math.max(0, -opening), due, paid, net, remaining: Math.max(0, net), excess: Math.max(0, -net) };
    });
    return { rows, members: [...members], total, payments, expenses: d.expenses.filter(x => periodOf(x.date) === p), paid: sum(payments.map(x => x.amount)), base: members.length ? Math.floor(total / members.length) : 0, rem: members.length ? total % members.length : 0, remaining: sum(rows.map(x => x.remaining)), excess: sum(rows.map(x => x.excess)), unallocated: members.length ? 0 : total };
  }
  function cashMovements(d) {
    return [
      ...d.payments.map(x => ({ ...x, type: 'payment', incoming: x.amount, outgoing: 0 })),
      ...d.expenses.map(x => ({ ...x, type: 'expense', incoming: 0, outgoing: x.amount }))
    ].filter(x => x.date >= d.cash.date).sort((a, b) => a.date.localeCompare(b.date) || a.type.localeCompare(b.type) || a.id.localeCompare(b.id));
  }
  function cashAt(d, date) {
    if (!validDate(date)) throw Error('Geçersiz kasa tarihi.');
    if (date < d.cash.date) return 0;
    return sum([d.cash.amount, ...cashMovements(d).filter(x => x.date <= date).map(x => x.incoming - x.outgoing)]);
  }
  function cashSummary(d, p, date = today()) {
    const { start, end } = bounds(p), movements = cashMovements(d);
    const opening = d.cash.date <= end ? sum([d.cash.amount, ...movements.filter(x => x.date < start).map(x => x.incoming - x.outgoing)]) : 0;
    const inPeriod = movements.filter(x => x.date >= start && x.date <= end);
    const received = sum(inPeriod.map(x => x.incoming)), spent = sum(inPeriod.map(x => x.outgoing));
    let balance = opening;
    const rows = inPeriod.map(x => ({ ...x, balance: (balance = sum([balance, x.incoming, -x.outgoing])) }));
    return { start, end, opening, received, spent, closing: sum([opening, received, -spent]), today: cashAt(d, date), rows, startsWithin: d.cash.date > start && d.cash.date <= end, beforeStart: end < d.cash.date, effectiveStart: d.cash.date > start ? d.cash.date : start, omitted: [...d.expenses, ...d.payments].filter(x => x.date < d.cash.date).length };
  }
  function personHistory(d, pid) {
    return periodKeys(d).map(p => ({ period: p, ...calculate(d, p).rows.find(x => x.id === pid) })).filter(x => x.member || x.paid || x.opening || x.due);
  }
  function csvCell(value) {
    let s = String(value ?? '');
    if (/^[\s]*[=+\-@]/.test(s) || /^[\t\r\n]/.test(s)) s = "'" + s;
    return '"' + s.replace(/"/g, '""') + '"';
  }
  const api = { MAX_AMOUNT, iso, today, validPeriod, validDate, periodOf, movePeriod, bounds, cents, sum, blank, validate, migrate, normalizeName, nameKey, earliestDate, split, calculate, cashMovements, cashAt, cashSummary, personHistory, periodKeys, csvCell };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.PayAccounting = Object.freeze(api);
})(typeof globalThis !== 'undefined' ? globalThis : this);
