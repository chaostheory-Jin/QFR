// Deterministic synthetic fixtures. No customer exports or network services are read.
// Run with @oai/artifact-tool available; see test-data/uploads/README.md.
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { Workbook, SpreadsheetFile } from '@oai/artifact-tool';

const output = path.resolve(process.argv[2] ?? 'test-data/uploads');
const previewDir = process.env.QFR_FIXTURE_PREVIEWS;
await fs.mkdir(output, { recursive: true });
if (previewDir) await fs.mkdir(previewDir, { recursive: true });
const headers = ['Date', 'Amount', 'Currency', 'Account', 'Description', 'LineID', 'InvoiceNumber', 'Contact', 'Category', 'Role', 'TaxAmount', 'Department'];
const categories = ['Sales', 'Purchases', 'Rent', 'Office Expenses', 'Bank Fees', 'Subscriptions', 'Travel - National', 'Interest Income'];
const metadata = (currency = 'AUD', kind = 'ledger', company = 'SYNTHETIC Upload QA') => ({ source: 'Synthetic Upload QA v1', company, currency, kind, sample: true });
const options = { dateFormat: 'ISO', duplicates: 'block' };
const fixtures = [];
function rows(prefix, count, currency = 'AUD', kind = 'ledger') {
  return Array.from({ length: count }, (_, i) => {
    const category = kind === 'invoice' ? categories[1 + i % 6] : categories[i % categories.length];
    const role = category === 'Sales' ? 'income' : category === 'Interest Income' ? 'other_income' : category === 'Purchases' ? 'cost_of_goods_sold' : 'expense';
    const cents = i % 37 === 0 ? 0 : (1000 + (i * 7919 + 12345) % 499000) * (i % 23 === 0 ? -1 : 1);
    const amount = cents / 100;
    return [new Date(Date.UTC(2026, 0, 1 + i % 273)).toISOString().slice(0, 10), amount, currency,
      category, `Synthetic ${kind} item ${i + 1}`, `${prefix}-${String(i + 1).padStart(6, '0')}`,
      `SYN-INV-${String(i + 1).padStart(6, '0')}`, `Synthetic Party ${1 + i % 25}`, category, role,
      Math.round(cents / 10) / 100, ['Operations', 'Sales', 'Admin'][i % 3]];
  });
}
function summary(data) {
  const result = {};
  for (const row of data) {
    if (typeof row[1] !== 'number' || !categories.includes(row[8])) continue;
    result[row[8]] = (result[row[8]] ?? 0) + Math.round(row[1] * 100);
  }
  return Object.fromEntries(Object.entries(result).map(([key, cents]) => [key, cents / 100]));
}
function expectRows(data, errors = {}, warnings = {}, extra = {}) {
  return { records: data.length, errors, warnings, ...extra };
}
async function save(name, content, sheets, note, meta = metadata(), readError) {
  const bytes = typeof content === 'string' ? Buffer.from(content) : content;
  await fs.writeFile(path.join(output, name), bytes);
  fixtures.push({ file: name, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex'), metadata: meta, note, sheets, ...(readError ? { readError } : {}) });
}
const escapeCSV = value => { const s = String(value ?? ''); return /[",\r\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s; };
async function csv(name, data, note, config = {}) {
  const columns = config.headers ?? headers;
  // UTF-8 BOM preserves Chinese/accented text in both Excel and the current CSV reader.
  await save(name, '\uFEFF' + [columns, ...data].map(row => row.map(escapeCSV).join(',')).join('\r\n') + '\r\n',
    [{ name: 'Sheet1', rows: data.length, options: { ...options, ...config.options }, ...(config.mapping ? { mapping: config.mapping } : {}), expected: config.readError ? null : config.expected ?? expectRows(data, {}, {}, { categoryTotals: summary(data) }), ...(config.alternatives ? { alternatives: config.alternatives } : {}) }],
    note, config.metadata ?? metadata(), config.readError);
}
await csv('01_valid_ledger_100.csv', rows('L100', 100), 'Starter: 100 valid AUD transaction lines.');
await csv('02_valid_ledger_1000.csv', rows('L1000', 1000), 'Normal volume: 1,000 valid AUD transaction lines.');
await csv('03_valid_ledger_10000.csv', rows('L10000', 10000), 'Maximum supported row count: 10,000 data rows; file remains under 3 MB.');
await csv('04_valid_invoices_150.csv', rows('INVOICE', 150, 'AUD', 'invoice'), 'Separate invoice evidence, not extra ledger revenue.', { metadata: metadata('AUD', 'invoice') });
await csv('05_valid_bank_300.csv', rows('BANK', 300, 'AUD', 'bank'), 'Separate bank movements, not extra ledger revenue.', { metadata: metadata('AUD', 'bank') });
await csv('06_valid_usd_200.csv', rows('USD', 200, 'USD'), 'Select USD for the batch; do not combine with AUD.', { metadata: metadata('USD') });
for (const convention of ['DMY', 'MDY']) {
  const data = rows(convention, 30).map(row => { const [y, m, d] = row[0].split('-'); return [convention === 'DMY' ? `${d}/${m}/${y}` : `${m}/${d}/${y}`, ...row.slice(1)]; });
  await csv(`07_valid_dates_${convention.toLowerCase()}_30.csv`, data, `Choose ${convention}; ISO should reject all 30 dates.`, { options: { dateFormat: convention } });
}
const customHeaders = ['记账日期', '金额', '币种', '科目', '摘要', '原始行号', '发票号', '往来方', '分类', '行类型', '税额', '部门'];
await csv('08_manual_column_mapping_30.csv', rows('MANUAL', 30), 'Map the Chinese headers manually using the mapping in this manifest.', { headers: customHeaders, mapping: Object.fromEntries(['date', 'amount', 'currency', 'account', 'description', 'recordId', 'invoice', 'contact', 'category', 'role', 'tax', 'department'].map((field, i) => [field, customHeaders[i]])) });
const edge = rows('EDGE', 6);
edge[0][1] = 0; edge[0][10] = 0;
edge[1][1] = -125.50; edge[1][10] = -12.55;
edge[2][1] = '1,250.50'; edge[2][10] = 125.05;
edge[3][4] = 'Synthetic café, "meeting"\n第二行摘要'; edge[3][5] = '00000042';
edge[4][0] = '2024-02-29'; edge[5][0] = '2026-12-31';
await csv('09_valid_edge_cases_6.csv', edge, 'Zero, credit/refund, grouped amount, UTF-8, escaped quotes/newline, leading-zero ID, leap day and year end.', { expected: expectRows(edge) });
const invalid = rows('BAD', 12);
invalid[0][0] = '2026-02-30'; invalid[1][0] = '';
invalid[2][1] = '100AUD'; invalid[3][1] = '$12'; invalid[4][1] = '1,00'; invalid[5][1] = '1.001';
invalid[6][3] = ''; invalid[7][4] = ''; invalid[8][10] = 'invalid'; invalid[9][9] = 'revenue';
invalid[10][1] = '1000000000001'; invalid[11][1] = 'Infinity';
await csv('10_invalid_fields_12.csv', invalid, 'Intentionally blocked: 12 field errors. Fix errors before commit.', { expected: expectRows(invalid, { date: 2, amount: 6, account: 1, description: 1, tax: 1, role: 1 }) });
const currencies = rows('CURRENCY', 4); currencies[1][2] = 'USD'; currencies[2][2] = 'XYZ'; currencies[3][2] = '';
await csv('11_invalid_currencies_4.csv', currencies, 'Intentionally blocked: mixed, unsupported and missing currencies.', { expected: expectRows(currencies, { currency: 3, amount: 2, tax: 2 }) });
const repeated = rows('DUP', 2); repeated.push([...repeated[0]]);
await csv('12_duplicate_rows_3.csv', repeated, 'Default blocks; Exclude keeps 2 records and archives the repeated original row.', { expected: expectRows(repeated, { duplicate: 1 }), alternatives: [{ options: { ...options, duplicates: 'exclude' }, expected: { records: 2, errors: {}, warnings: { duplicate: 1 }, excludedRows: [4] } }] });
const noIds = rows('NOID', 2).map(row => { row[5] = ''; return row; }); noIds.push([...noIds[0]]);
await csv('13_duplicates_without_ids_3.csv', noIds, 'Default blocks; Keep is permitted only when source IDs are absent.', { expected: expectRows(noIds, { duplicate: 1 }), alternatives: [{ options: { ...options, duplicates: 'keep' }, expected: expectRows(noIds, {}, { duplicate: 1 }) }] });
const conflicts = rows('CONFLICT', 2); conflicts.push([...conflicts[0]]); conflicts[2][1] = 123.45;
await csv('14_conflicting_ids_3.csv', conflicts, 'Same ID with changed amount: both Block and Exclude must reject.', { expected: expectRows(conflicts, { duplicate: 1 }), alternatives: [{ options: { ...options, duplicates: 'exclude' }, expected: expectRows(conflicts, { duplicate: 1 }) }] });
const warnings = rows('REVIEW', 5).map(row => { row[8] = 'Unknown synthetic category'; row[9] = ''; return row; });
await csv('15_category_review_5.csv', warnings, 'No blocking errors; 5 review warnings; unknown categories become Unmapped, roles unknown.', { expected: expectRows(warnings, {}, { category: 5 }, { category: 'Unmapped', role: 'unknown' }) });
await csv('16_cross_batch_a_20.csv', rows('CROSS', 20), 'Commit A first, then preview B under identical source/company/kind/currency.');
const crossB = rows('CROSS-B', 20); for (let i = 0; i < 5; i++) crossB[i][5] = `CROSS-${String(i + 1).padStart(6, '0')}`;
await csv('17_cross_batch_b_20.csv', crossB, 'Valid alone. After A is committed, 5 source IDs must be blocked across files.');
await csv('18_invalid_row_limit_10001.csv', rows('OVER', 10001), 'Intentionally rejected before preview: exceeds 10,000 data rows.', { readError: 'Maximum 10,000 rows', expected: null });
await csv('19_invalid_duplicate_headers.csv', [[ '2026-01-01', 1, 2 ]], 'Intentionally rejected before preview: duplicate header.', { headers: ['Date', 'Amount', 'Amount'], readError: 'nonempty and unique', expected: null });
await csv('20_invalid_missing_header.csv', [[ '2026-01-01', 1, 2 ]], 'Intentionally rejected before preview: blank header.', { headers: ['Date', '', 'Amount'], readError: 'nonempty and unique', expected: null });

async function excel(name, specs, note) {
  name = `outputs/upload-qa-v1/${name}`;
  await fs.mkdir(path.dirname(path.join(output, name)), { recursive: true });
  const workbook = Workbook.create();
  const sheetManifest = [];
  for (const spec of specs) {
    const sheet = workbook.worksheets.add(spec.name);
    const data = spec.data.map(row => [new Date(`${row[0]}T00:00:00Z`), ...row.slice(1)]);
    sheet.getRange(`A1:L${data.length + 1}`).values = [headers, ...data];
    sheet.getRange(`A1:L${data.length + 1}`).format.font = { name: 'Arial', size: 10 };
    sheet.getRange(`A1:L${data.length + 1}`).format.rowHeight = 20;
    sheet.getRange('A1:L1').format = { fill: '#23354D', font: { name: 'Arial', size: 10, bold: true, color: '#FFFFFF' }, horizontalAlignment: 'center', rowHeight: 24 };
    for (const [column, width] of [['A', 14], ['B', 14], ['C', 11], ['D', 22], ['E', 36], ['F', 22], ['G', 24], ['H', 23], ['I', 22], ['J', 23], ['K', 14], ['L', 18]]) sheet.getRange(`${column}1:${column}${data.length + 1}`).format.columnWidth = width;
    sheet.getRange(`A2:A${data.length + 1}`).setNumberFormat('yyyy-mm-dd');
    sheet.getRange(`B2:B${data.length + 1}`).setNumberFormat('#,##0.00');
    sheet.getRange(`K2:K${data.length + 1}`).setNumberFormat('#,##0.00');
    sheet.showGridLines = false;
    sheet.freezePanes.freezeRows(1);
    if (spec.formula) sheet.getRange('B2').formulas = [['=50+50']];
    sheetManifest.push({ name: spec.name, rows: spec.data.length, kind: spec.kind ?? 'ledger', options, expected: spec.formula ? expectRows(spec.data, { amount: 1 }) : expectRows(spec.data, {}, {}, { categoryTotals: summary(spec.data) }) });
  }
  workbook.recalculate();
  for (const spec of specs) {
    const inspection = await workbook.inspect({ kind: 'table', range: `${spec.name}!A1:L4`, include: 'values,formulas', tableMaxRows: 4, tableMaxCols: 12, maxChars: 2000 });
    console.log(name, spec.name, inspection.ndjson);
    if (previewDir) {
      const preview = await workbook.render({ sheetName: spec.name, range: 'A1:L8', scale: 1, format: 'png' });
      await fs.writeFile(path.join(previewDir, `${path.basename(name, '.xlsx')}-${spec.name}.png`), new Uint8Array(await preview.arrayBuffer()));
    }
  }
  const exported = await SpreadsheetFile.exportXlsx(workbook);
  await exported.save(path.join(output, name));
  if (previewDir) {
    try { await fs.rename(path.join(output, `${name}.inspect.ndjson`), path.join(previewDir, `${path.basename(name)}.inspect.ndjson`)); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  await save(name, await fs.readFile(path.join(output, name)), sheetManifest, note);
}
await excel('21_valid_multi_sheet.xlsx', [
  { name: 'Ledger', data: rows('XL-LEDGER', 250) },
  { name: 'Invoices', data: rows('XL-INVOICE', 100, 'AUD', 'invoice'), kind: 'invoice' },
  { name: 'Bank', data: rows('XL-BANK', 150, 'AUD', 'bank'), kind: 'bank' },
], '500 rows across 3 sheets. Import only the intended sheet and select the corresponding document kind; do not combine sources as revenue.');
await excel('22_invalid_formula_amount.xlsx', [{ name: 'Ledger', data: rows('XL-FORMULA', 5), formula: true }], 'Intentionally blocked: B2 contains a calculated amount. Upload source values instead of cached formulas.');
await fs.writeFile(path.join(output, 'manifest.json'), JSON.stringify({ schemaVersion: 1, synthetic: true, generatorVersion: 1, period: '2026-01-01..2026-09-30 (explicit date boundary exceptions in edge cases)', categories, fixtures }, null, 2) + '\n');
console.log(JSON.stringify({ files: fixtures.length, dataRows: fixtures.reduce((sum, item) => sum + item.sheets.reduce((n, sheet) => n + sheet.rows, 0), 0), output }, null, 2));
