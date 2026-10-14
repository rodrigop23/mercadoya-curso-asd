import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync, writeFileSync, unlinkSync, copyFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const require = createRequire(new URL('../../packages/contracts/package.json', import.meta.url));
const yaml = require('yaml');
const directory = resolve('tests/perf/out');
const config = `${directory}/kong-delay.yml`;
const override = `${directory}/compose-delay.yml`;
const kong = yaml.parse(readFileSync('infra/kong/kong.yml', 'utf8'));
kong.plugins.push({
  name: 'pre-function',
  config: {
    access: ['if string.find(ngx.var.uri, "/runs/wait", 1, true) then ngx.sleep(2) end'],
  },
});
writeFileSync(config, yaml.stringify(kong));
writeFileSync(
  override,
  yaml.stringify({
    services: { kong: { volumes: [`${config}:/etc/kong/kong.yml:ro`] } },
  }),
);

function compose(extra) {
  const files = ['-f', 'docker-compose.yml', '-f', 'tests/perf/compose.perf.yml'];
  if (extra) files.push('-f', override);
  const result = spawnSync(
    'docker',
    [
      'compose',
      '-p',
      'mercadoya-perf',
      '--profile',
      'agent',
      '--env-file',
      'tests/perf/out/stack.env',
      ...files,
      'up',
      '-d',
      '--wait',
      '--wait-timeout',
      '60',
      'kong',
    ],
    { encoding: 'utf8' },
  );
  assert.equal(result.status, 0, result.stderr);
}

try {
  compose(true);
  const result = spawnSync(
    'bash',
    ['scripts/k6.sh', 'run', '--no-usage-report', '-e', 'K6_PROFILE=ci', 'tests/perf/gateway.js'],
    { encoding: 'utf8' },
  );
  assert.equal(result.status, 99, result.stdout + result.stderr);
  assert.match(result.stdout, /✗ http_req_duration\{name:agent_chat\}/);
  copyFileSync('tests/perf/out/summary.json', `${directory}/negative-summary.json`);
  console.log(
    result.stdout
      .split('\n')
      .filter((line) => /^[✓✗]/.test(line))
      .join('\n'),
  );
  console.log('PASS temporary Kong delay rejected, k6 exit 99');
} finally {
  try {
    compose(false);
  } finally {
    unlinkSync(override);
    unlinkSync(config);
  }
}
