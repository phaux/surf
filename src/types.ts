// Convert name to propName
export const toPropName = (str: string) =>
  str.replace(/\W\w/g, s => s.substr(1).toUpperCase())
// Convert name to attr-name
export const toAttrName = (str: string) =>
  str.replace(/[A-Z]/, s => '-' + s.toLowerCase())
// Convert name to eventname
export const toEventName = (str: string) =>
  str.replace(/\W/g, '').toLowerCase()

export interface TypeMap {
  string: string
  number: number
  boolean: boolean
  any: any
}

export const DESERIALIZE: {[t: string]: (x: string) => any} = {
  string:  x => '' + x,
  number:  x => +x,
  boolean: x => true,
}

export const SERIALIZE: {[t: string]: (x: any) => string | null} = {
  string:  x => x === null || x === undefined ? null : '' + x,
  number:  x => x === null || x === undefined ? null : '' + x,
  boolean: x => x ? '' : null,
}

export const DEFAULT: {[t: string]: any} = {
  string: '',
  number: 0,
  boolean: false,
  any: undefined,
}

export const CAST: {[t: string]: (x: any) => any} = {
  string: x => '' + x,
  number: x => +x,
  boolean: x => !!x,
  any: x => x,
}

export declare namespace JSX {
  type Element = any
}
