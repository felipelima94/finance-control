export function Notice({ ok, error }: { ok?: string; error?: string }) {
  if (error) return <div className="notice error" role="alert">{error}</div>;
  if (ok) return <div className="notice ok" role="status">{ok}</div>;
  return null;
}
