import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { test } from 'node:test';

test('contracts solo importa Zod y archivos del propio paquete', async () => {
  const source = new URL('../src/', import.meta.url);
  const files = await readdir(source, { recursive: true });
  for (const file of files.filter((name) => name.endsWith('.ts'))) {
    const code = await readFile(new URL(file, source), 'utf8');
    const dependencies = [...code.matchAll(/(?:from\s*|import\s*\(\s*)['"]([^'"]+)['"]/g)].map(
      (match) => match[1],
    );
    for (const dependency of dependencies) {
      assert.ok(
        dependency === 'zod' || (dependency.startsWith('./') && !dependency.includes('/db/')),
        `${file} importa ${dependency} fuera del borde permitido`,
      );
    }
  }
});
