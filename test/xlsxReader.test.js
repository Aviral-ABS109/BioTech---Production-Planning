import { describe, it, expect } from 'vitest';
import { parseSharedStrings, decodeXml, decodeRef } from '../src/lib/xlsxReader.js';

describe('xlsx scanners', () => {
  it('shared strings: plain, rich text, phonetic, empty, entities', () => {
    const xml = '<sst><si><t>Plant</t></si><si><r><t>Mor</t></r><r><rPr/><t xml:space="preserve">occo </t></r></si>'
      + '<si><t>A</t><rPh><t>x</t></rPh></si><si/><si><t>B &amp; C &#x3E;</t></si></sst>';
    expect(parseSharedStrings(xml)).toEqual(['Plant', 'Morocco ', 'A', '', 'B & C >']);
  });
  it('prefixed tags', () => {
    expect(parseSharedStrings('<x:sst><x:si><x:t>IOL</x:t></x:si></x:sst>')).toEqual(['IOL']);
  });
  it('helpers', () => {
    expect(decodeXml('&lt;1&gt;')).toBe('<1>');
    expect(decodeRef('AW50')).toEqual({ col: 48, row: 49 });
  });
});
