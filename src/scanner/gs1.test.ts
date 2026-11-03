// Run with: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { gtinToEan, parseGs1 } from './gs1.ts';

const GS = String.fromCharCode(29);

test('a medicine DataMatrix gives its expiry date, batch and product', () => {
  // GTIN, expiry 31 Jan 2028, batch, then serial (FMD layout).
  const r = parseGs1(`010594002691002517280131${'10'}AB12C${GS}21XYZ987654`);
  assert.deepEqual(r, { gtin: '05940026910025', expiry: { iso: '2028-01-31', precision: 'day' }, batch: 'AB12C' });
  // With a symbology prefix, fields in another order.
  assert.equal(parseGs1(`]d21728113010L4421${GS}0109501101530003`)?.expiry?.iso, '2028-11-30');
  // DD 00: the end of the month.
  assert.deepEqual(parseGs1('17270500')?.expiry, { iso: '2027-05-31', precision: 'month' });
  // Best before on food.
  assert.equal(parseGs1('0109501101530003152611251010')?.bestBefore?.iso, '2026-11-25');
});

test('a GS1 Digital Link QR code gives the same fields', () => {
  const r = parseGs1('https://id.gs1.org/01/09501101530003/10/ABC%201?17=280131');
  assert.equal(r?.gtin, '09501101530003');
  assert.equal(r?.expiry?.iso, '2028-01-31');
  assert.equal(r?.batch, 'ABC 1');
  assert.equal(parseGs1('https://example.com/01/9501101530003/17/261125')?.expiry?.iso, '2026-11-25');
});

test('ordinary codes are not GS1', () => {
  assert.equal(parseGs1('https://example.com/menu'), null);
  assert.equal(parseGs1('hello world'), null);
  assert.equal(parseGs1('17991399'), null);
  assert.equal(gtinToEan('05940026910025'), '5940026910025');
  assert.equal(gtinToEan('00012345678905'), '0012345678905');
});
