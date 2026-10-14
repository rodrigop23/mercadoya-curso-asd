module.exports = {
  forbidden: [
    {
      name: 'no-cross-service',
      severity: 'error',
      from: { path: '^apps/([^/]+)/' },
      to: { path: '^apps/', pathNot: '^apps/$1/' },
    },
    {
      name: 'no-service-internals-from-packages',
      severity: 'error',
      from: { path: '^packages/' },
      to: { path: '^apps/' },
    },
    {
      name: 'only-public-package-entry',
      severity: 'error',
      from: { path: '^apps/' },
      // exportsFields limita la resolución por nombre a los exports públicos.
      // Una ruta relativa conserva el tipo local aunque llegue al mismo archivo.
      to: { path: '^packages/', dependencyTypes: ['local'] },
    },
    {
      name: 'no-unresolved-workspace-package',
      severity: 'error',
      from: {},
      to: { path: '^@mercadoya/', couldNotResolve: true },
    },
    { name: 'no-circular', severity: 'warn', from: {}, to: { circular: true } },
  ],
  options: {
    parser: 'swc',
    doNotFollow: { path: 'node_modules' },
    exclude: { path: '(^|/)(node_modules|dist|\\.venv|\\.langgraph_api)/' },
    // SWC lee el AST original, incluidos los imports solo de tipos.
    enhancedResolveOptions: {
      exportsFields: ['exports'],
      conditionNames: ['import', 'node', 'default', 'types'],
    },
  },
};
