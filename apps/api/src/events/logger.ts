export function logEvent(entry: Record<string, unknown>) {
  console.info(JSON.stringify({ timestamp: new Date().toISOString(), ...entry }));
}

export function logEventHandlerError(input: {
  subject: string;
  consumer: string;
  transport: string;
  error: unknown;
}) {
  console.error(
    JSON.stringify({
      timestamp: new Date().toISOString(),
      type: 'event.handler_error',
      ...input,
      error: input.error instanceof Error ? input.error.message : String(input.error),
    }),
  );
}
