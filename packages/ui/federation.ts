// Cada subpath público es una clave shared: UI no tiene un barrel raíz.
export function catalogShared(host: boolean) {
  const provider = host ? {} : { import: false as const };
  const singleton = {
    singleton: true,
    strictVersion: true,
    allowNodeModulesSuffixMatch: true,
    ...provider,
  };
  return {
    react: { ...singleton, requiredVersion: '^19.3.0' },
    'react/jsx-runtime': { ...singleton, requiredVersion: '^19.3.0' },
    'react/jsx-dev-runtime': { ...singleton, requiredVersion: '^19.3.0' },
    'react-dom': { ...singleton, requiredVersion: '^19.3.0' },
    'react-dom/client': { ...singleton, requiredVersion: '^19.3.0' },
    '@tanstack/react-query': { ...singleton, requiredVersion: '^5.103.2' },
    ...Object.fromEntries(
      [
        'alert-dialog',
        'avatar',
        'button',
        'card',
        'dialog',
        'dropdown-menu',
        'field',
        'input',
        'label',
        'spinner',
        'textarea',
      ].map((component) => [
        `@mercadoya/ui/components/${component}`,
        { ...singleton, version: '0.0.0', requiredVersion: '0.0.0' },
      ]),
    ),
  };
}
