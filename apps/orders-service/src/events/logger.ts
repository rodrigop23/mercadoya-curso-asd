export function logEvent(entry: Record<string, unknown>) {
  console.info(JSON.stringify({ ...entry, timestamp: new Date().toISOString() }));
}
