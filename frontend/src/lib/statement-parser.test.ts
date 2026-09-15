import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parseStatementPdf, parseStatementText } from './statement-parser'

describe('statement parser', () => {
  it('parses fixed-width text statements', () => {
    const records = parseStatementText([
      '12028700   I1000064240   DI1000045981   12.12.24   Sales invoice (1005775160)   25 108 709,00',
      '12028700   DI1000045981  C1000023252    12.12.24   Credit note               -4 800 000,00',
    ].join('\n'))

    expect(records).toHaveLength(2)
    expect(records[0]).toMatchObject({
      identifiers: ['I1000064240', 'DI1000045981', '1005775160'],
      amount: 25108709,
      description: 'Sales invoice',
    })
  })

  it('reads every transaction from the real 92-page statement without pdftotext', async () => {
    const path = resolve(process.cwd(), '../Cola_Reconciliation/UTUKUFU LTD SEMUTO statement Jan 2024 to 30th April 2026.pdf')
    const records = await parseStatementPdf(new Uint8Array(await readFile(path)))

    expect(records).toHaveLength(1814)
    expect(records[606]).toMatchObject({
      identifiers: ['I1000064240', 'DI1000045981', '1005775160'],
      amount: 25108709,
      description: 'Sales invoice',
      lineIndex: 607,
      page: 32,
    })
  })
})
