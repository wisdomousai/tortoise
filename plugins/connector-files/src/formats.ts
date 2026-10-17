/**
 * The file formats a file exchange reads and writes: JSON (an array of records, or an object
 * whose `items` is one), newline-delimited JSON, CSV with a header row (RFC 4180) and a flat XML
 * subset (`<records><record><field>text</field></record></records>`). CSV and XML values are
 * strings; JSON keeps its types. A file that does not parse throws, so a half-written or foreign
 * file is reported instead of read as empty.
 */
export type FileFormat = 'json' | 'ndjson' | 'csv' | 'xml';
export type FileRecord = Readonly<Record<string, unknown>>;

/** Element names of the XML subset. */
export interface XmlNames {
  readonly root?: string;
  readonly record?: string;
}

export const extensionOf: Readonly<Record<FileFormat, string>> = {
  json: 'json',
  ndjson: 'ndjson',
  csv: 'csv',
  xml: 'xml',
};

const isRecord = (value: unknown): value is FileRecord =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

function parseJson(text: string): FileRecord[] {
  const value = JSON.parse(text) as unknown;
  const items = Array.isArray(value) ? value : isRecord(value) ? value.items : undefined;
  if (!Array.isArray(items) || !items.every(isRecord))
    throw new Error('A JSON file must hold an array of objects or an object with an items array');
  return items;
}

function parseNdjson(text: string): FileRecord[] {
  return text
    .split(/\r?\n/)
    .filter((line) => line.trim())
    .map((line, index) => {
      const value = JSON.parse(line) as unknown;
      if (!isRecord(value)) throw new Error(`Line ${index + 1} is not a JSON object`);
      return value;
    });
}

/** RFC 4180 rows: quoted fields may hold separators, quotes (doubled) and line breaks. */
function csvRows(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  let index = text.charCodeAt(0) === 0xfeff ? 1 : 0;
  for (; index < text.length; index++) {
    const char = text[index]!;
    if (quoted) {
      if (char !== '"') field += char;
      else if (text[index + 1] === '"') ((field += '"'), index++);
      else quoted = false;
    } else if (char === '"' && field === '') quoted = true;
    else if (char === ',') (row.push(field), (field = ''));
    else if (char === '\n' || char === '\r') {
      if (char === '\r' && text[index + 1] === '\n') index++;
      (row.push(field), rows.push(row), (row = []), (field = ''));
    } else field += char;
  }
  if (quoted) throw new Error('A CSV file ends inside a quoted field');
  if (field !== '' || row.length) (row.push(field), rows.push(row));
  return rows.filter((cells) => cells.length > 1 || cells[0] !== '');
}

function parseCsv(text: string): FileRecord[] {
  const [header, ...rows] = csvRows(text);
  if (!header) return [];
  if (new Set(header).size !== header.length) throw new Error('A CSV header repeats a column');
  return rows.map((cells, index) => {
    if (cells.length !== header.length)
      throw new Error(
        `CSV row ${index + 2} has ${cells.length} fields, the header ${header.length}`,
      );
    return Object.fromEntries(header.map((name, column) => [name, cells[column]]));
  });
}

const entities: Readonly<Record<string, string>> = {
  lt: '<',
  gt: '>',
  amp: '&',
  quot: '"',
  apos: "'",
};
function decodeXml(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#[0-9]+|[a-z]+);/gi, (match, entity: string) => {
    if (entity[0] === '#')
      return String.fromCodePoint(
        entity[1] === 'x' || entity[1] === 'X'
          ? parseInt(entity.slice(2), 16)
          : parseInt(entity.slice(1), 10),
      );
    const decoded = entities[entity];
    if (decoded === undefined) throw new Error(`Unknown XML entity ${match}`);
    return decoded;
  });
}
const encodeXml = (text: string) =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const xmlName = /^[A-Za-z_][\w.-]*$/;
/**
 * The flat XML subset. A document type is refused, so no entity is ever expanded beyond the
 * five predefined ones and numeric references; attributes and nested elements inside a field
 * are refused rather than flattened, so a richer file is reported, not misread.
 */
function parseXml(text: string, names: XmlNames): FileRecord[] {
  const root = names.root ?? 'records';
  const record = names.record ?? 'record';
  if (/<!DOCTYPE/i.test(text)) throw new Error('An XML file may not declare a document type');
  const body = text
    .replace(/^﻿/, '')
    .replace(/<\?xml[^?]*\?>/, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .trim();
  const rootMatch = new RegExp(`^<${root}\\s*>([\\s\\S]*)</${root}\\s*>$|^<${root}\\s*/>$`).exec(
    body,
  );
  if (!rootMatch) throw new Error(`An XML file must have one <${root}> root element`);
  const inner = rootMatch[1] ?? '';
  const records: FileRecord[] = [];
  const recordPattern = new RegExp(
    `<${record}\\s*>([\\s\\S]*?)</${record}\\s*>|<${record}\\s*/>`,
    'g',
  );
  let rest = inner;
  for (const match of inner.matchAll(recordPattern)) {
    rest = rest.replace(match[0], '');
    const fields: Record<string, string> = {};
    let content = (match[1] ?? '').trim();
    const fieldPattern = /^<([A-Za-z_][\w.-]*)\s*(?:\/>|>([^<]*)<\/\1\s*>)\s*/;
    while (content) {
      const field = fieldPattern.exec(content);
      if (!field) throw new Error(`A <${record}> holds something other than flat fields`);
      const name = field[1]!;
      if (name in fields) throw new Error(`A <${record}> repeats the field ${name}`);
      fields[name] = decodeXml(field[2] ?? '');
      content = content.slice(field[0].length);
    }
    records.push(fields);
  }
  if (rest.trim()) throw new Error(`The <${root}> element holds something other than <${record}>`);
  return records;
}

export function parseRecords(format: FileFormat, text: string, names: XmlNames = {}) {
  switch (format) {
    case 'json':
      return parseJson(text);
    case 'ndjson':
      return parseNdjson(text);
    case 'csv':
      return parseCsv(text);
    case 'xml':
      return parseXml(text, names);
  }
}

/** A scalar as CSV or XML text; objects and arrays are refused rather than stringified. */
function text(value: unknown, name: string): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  throw new Error(`Field ${name} is not a scalar and cannot be written as text`);
}
const csvCell = (value: string) =>
  /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;

/** Columns in first-seen order across all records, so every row has every column. */
function columnsOf(records: readonly FileRecord[]) {
  const columns = new Set<string>();
  for (const record of records) for (const key of Object.keys(record)) columns.add(key);
  return [...columns];
}

export function serializeRecords(
  format: FileFormat,
  records: readonly FileRecord[],
  names: XmlNames = {},
): string {
  switch (format) {
    case 'json':
      return `${JSON.stringify(records, null, 2)}\n`;
    case 'ndjson':
      return records.map((record) => `${JSON.stringify(record)}\n`).join('');
    case 'csv': {
      const columns = columnsOf(records);
      return [columns, ...records.map((record) => columns.map((name) => text(record[name], name)))]
        .map((cells) => `${cells.map(csvCell).join(',')}\r\n`)
        .join('');
    }
    case 'xml': {
      const root = names.root ?? 'records';
      const record = names.record ?? 'record';
      const lines = ['<?xml version="1.0" encoding="UTF-8"?>', `<${root}>`];
      for (const item of records) {
        lines.push(`  <${record}>`);
        for (const [name, value] of Object.entries(item)) {
          if (!xmlName.test(name)) throw new Error(`Field ${name} is not a valid XML element name`);
          lines.push(`    <${name}>${encodeXml(text(value, name))}</${name}>`);
        }
        lines.push(`  </${record}>`);
      }
      lines.push(`</${root}>`, '');
      return lines.join('\n');
    }
  }
}
