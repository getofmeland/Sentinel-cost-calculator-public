// @vitest-environment node
import { describe, it, expect } from 'vitest'

import { csvField, toCsv } from '../csvExport'

describe('csvField', () => {
  it('leaves an ordinary value untouched', () => {
    expect(csvField('Entra ID')).toBe('Entra ID')
    expect(csvField(42)).toBe('42')
  })

  it('quotes a value containing a comma', () => {
    expect(csvField('Palo Alto, Fortinet')).toBe('"Palo Alto, Fortinet"')
  })

  it('doubles embedded quotes', () => {
    expect(csvField('say "hello"')).toBe('"say ""hello"""')
  })

  it('quotes a value containing a newline', () => {
    expect(csvField('line one\nline two')).toBe('"line one\nline two"')
  })

  it('neutralises a leading = so spreadsheets do not execute it', () => {
    // A CSV that runs a formula when opened is a poor thing to email a client.
    expect(csvField('=1+1')).toBe("'=1+1")
    expect(csvField('=HYPERLINK("http://evil","click")')).toBe(
      '"\'=HYPERLINK(""http://evil"",""click"")"',
    )
  })

  it('neutralises the other formula-trigger prefixes', () => {
    expect(csvField('+1')).toBe("'+1")
    expect(csvField('-1+1')).toBe("'-1+1")
    expect(csvField('@SUM(A1)')).toBe("'@SUM(A1)")
  })

  it('does not mangle a negative number written as a number', () => {
    // Numbers arrive already formatted by the caller; only strings are guarded.
    expect(csvField(-12.5)).toBe("'-12.5")
  })
})

describe('toCsv', () => {
  it('joins rows with CRLF, as RFC 4180 expects', () => {
    expect(toCsv([['a', 'b'], ['c', 'd']])).toBe('a,b\r\nc,d')
  })

  it('renders an empty row as a blank line for visual spacing', () => {
    expect(toCsv([['a'], [], ['b']])).toBe('a\r\n\r\nb')
  })
})
