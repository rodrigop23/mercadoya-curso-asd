import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { writeFileSync, unlinkSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

function cruise(file, source) {
  writeFileSync(file, source, { flag: 'wx' });
  try {
    return spawnSync(
      'pnpm',
      ['exec', 'depcruise', file, '--config', '.dependency-cruiser.cjs', '--output-type', 'err'],
      { encoding: 'utf8' },
    );
  } finally {
    unlinkSync(file);
  }
}

const id = randomUUID();
for (const [rule, file, source] of [
  [
    'no-cross-service',
    `apps/catalog-service/.fitness-${id}.ts`,
    "import type { IdentityContract } from '../identity-service/src/contract.js';",
  ],
  [
    'no-service-internals-from-packages',
    `packages/contracts/.fitness-${id}.ts`,
    "import '../../apps/catalog-service/src/auth.js';",
  ],
  [
    'only-public-package-entry',
    `apps/web/.fitness-${id}.tsx`,
    "import '../../packages/ui/src/lib/utils.ts';",
  ],
  [
    'no-unresolved-workspace-package',
    `apps/web/.fitness-${id}.tsx`,
    "import '@mercadoya/ui/src/lib/utils';",
  ],
]) {
  test(`${rule} rejects a temporary TypeScript violation`, () => {
    const result = cruise(file, source);
    assert.equal(result.status, 1, result.stdout + result.stderr);
    assert.match(result.stdout + result.stderr, new RegExp(`error ${rule}`));
  });
}

test('public UI export resolving to src is allowed', () => {
  const result = cruise(`apps/web/.fitness-${id}.tsx`, "import '@mercadoya/ui/lib/utils';");
  assert.equal(result.status, 0, result.stdout + result.stderr);
});

test('no-circular reports a temporary cycle as a warning', () => {
  const first = `apps/web/.fitness-cycle-a-${id}.ts`;
  const second = `apps/web/.fitness-cycle-b-${id}.ts`;
  writeFileSync(second, `import './.fitness-cycle-a-${id}.ts';`, { flag: 'wx' });
  try {
    const result = cruise(first, `import './.fitness-cycle-b-${id}.ts';`);
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.match(result.stdout, /warn no-circular/);
  } finally {
    unlinkSync(second);
  }
});

test('each Python contract rejects the other service without installing it', () => {
  for (const [service, module, forbidden] of [
    ['agent-service', 'agent_service', 'mercadoya_mcp'],
    ['agent-service', 'agent_service', 'mcp_server'],
    ['mcp-server', 'mercadoya_mcp', 'agent_service'],
  ]) {
    const file = `apps/${service}/src/${module}/_fitness_${id.replaceAll('-', '')}.py`;
    writeFileSync(file, `from ${forbidden}.server import app\n`, { flag: 'wx' });
    try {
      const result = spawnSync(
        'uv',
        ['run', '--locked', 'lint-imports', '--no-cache', '--no-logo'],
        { cwd: `apps/${service}`, encoding: 'utf8' },
      );
      assert.equal(result.status, 1, result.stdout + result.stderr);
      assert.match(result.stdout, /BROKEN/);
    } finally {
      unlinkSync(file);
    }
  }
});
