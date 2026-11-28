// Only explicit non-content fields may enter the audit trail. Never infer safety from a value.
const fields = { 'terminal:resize': ['cols', 'rows'] }
export function auditArgs(channel, args) {
  const out = { count: args.length }
  for (const field of fields[channel] ?? []) {
    const value = args[1]?.[field]
    if (Number.isFinite(value)) out[field] = value
  }
  return out
}
