export function normaliseInvoiceNumber(value: string): string {
  return value.toUpperCase().replace(/[^A-Z0-9]/g, '')
}
