import { XMLParser } from 'fast-xml-parser';

const ARRAYS = new Set([
  'Layer', 'Fixture', 'GroupObject', 'Address', 'DMXMode', 'DMXChannel', 'LogicalChannel',
]);

export const xml = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@',
  parseTagValue: false,
  parseAttributeValue: false,
  trimValues: true,
  isArray: (name) => ARRAYS.has(name),
});

/** Text content of an element that may or may not carry attributes. */
export function text(node: unknown): string {
  if (node === undefined || node === null) return '';
  if (typeof node === 'object') return String((node as Record<string, unknown>)['#text'] ?? '');
  return String(node);
}

export function list<T = Record<string, unknown>>(node: unknown): T[] {
  if (node === undefined || node === null || node === '') return [];
  return (Array.isArray(node) ? node : [node]) as T[];
}
