import { describe, expect, it } from 'vitest';

import { parseCatalogSearch } from './catalog-search';

describe('parseCatalogSearch', () => {
  it('acepta una búsqueda vacía', () => {
    expect(parseCatalogSearch({})).toEqual({});
  });

  it('recorta los espacios de q', () => {
    expect(parseCatalogSearch({ q: '  audífonos bluetooth  ' })).toEqual({
      q: 'audífonos bluetooth',
    });
  });

  it.each([
    '',
    '   ',
    'a'.repeat(101),
    NaN,
    Infinity,
    -Infinity,
    null,
    ['mouse'],
    { text: 'mouse' },
  ])('descarta q inválido: %j', (q) => {
    expect(parseCatalogSearch({ q })).toEqual({});
  });

  it.each([0, 123, 2024])('conserva q numérico finito como string: %j', (q) => {
    expect(parseCatalogSearch({ q })).toEqual({ q: String(q) });
  });

  it('conserva q con 100 caracteres', () => {
    expect(parseCatalogSearch({ q: 'a'.repeat(100) })).toEqual({ q: 'a'.repeat(100) });
  });

  it.each(['minPrice', 'maxPrice'])('descarta valores inválidos de %s', (key) => {
    for (const value of [
      -5,
      '-5',
      'abc',
      NaN,
      Infinity,
      -Infinity,
      1.234,
      '1.234',
      '100.000',
      '',
      ' ',
      true,
      null,
      [],
      {},
    ]) {
      expect(parseCatalogSearch({ [key]: value })).toEqual({});
    }
  });

  it.each([0, '0', 10, '10', 100.05, '100.05', '100.0'])('normaliza el precio %j', (value) => {
    expect(parseCatalogSearch({ minPrice: value, maxPrice: value })).toEqual({
      minPrice: Number(value),
      maxPrice: Number(value),
    });
  });

  it('descarta ambos precios si el mínimo supera al máximo', () => {
    expect(parseCatalogSearch({ q: 'mouse', minPrice: '200', maxPrice: 50 })).toEqual({
      q: 'mouse',
    });
  });

  it('conserva los filtros válidos cuando otro precio es inválido', () => {
    expect(parseCatalogSearch({ q: 'mouse', minPrice: -1, maxPrice: '80' })).toEqual({
      q: 'mouse',
      maxPrice: 80,
    });
  });

  it('conserva un rango válido', () => {
    expect(parseCatalogSearch({ minPrice: '10', maxPrice: 80 })).toEqual({
      minPrice: 10,
      maxPrice: 80,
    });
  });

  it('ignora parámetros desconocidos', () => {
    expect(parseCatalogSearch({ q: 'mouse', page: 2, extra: 'value' })).toEqual({ q: 'mouse' });
  });
});
