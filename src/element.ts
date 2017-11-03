import { Observable, Behavior, IObserver } from 'impulsejs'
import {
  SERIALIZE, DESERIALIZE, CAST, DEFAULT,
  toAttrName, toPropName, toEventName,
  TypeMap, JSX,
} from './types'

export class Element extends HTMLElement {

  private _processInput = true
  private _ignoredOutputs: string[] = []
  _debug = false

  private _inputs: {
    [attr: string]: {type: keyof TypeMap, $: Behavior<any>},
  } = {}

  private attributeChangedCallback(
    attr: string,
    prev: string | null,
    next: string | null,
  ) {
    if (!this._processInput) return
    if (prev === next) return
    if (!this._inputs[attr]) return
    const {type, $} = this._inputs[attr]
    if (type == 'any') return
    const value = next === null ? DEFAULT[type] : DESERIALIZE[type](next)
    this._log('input', {name, value})
    this._ignoreOutput(attr, () => $.next(value))
  }

  render(cb: (parent: ShadowRoot, vdom: JSX.Element) => any): IObserver<JSX.Element> {
    if (!this.shadowRoot) this.attachShadow({mode: 'open'})
    return {
      next: dom => {
        cb(this.shadowRoot!, dom)
        this._log('render', {dom})
      },
      error: error => this._log('render error', {error}),
    }
  }

  event<
    T extends keyof HTMLElementTagNameMap,
    E extends keyof HTMLElementEventMap
  >(
    selector: T,
    event: E,
  ): Observable<{ev: HTMLElementEventMap[E], el: HTMLElementTagNameMap[T]}>
  event(selector: string, event: string): Observable<{ev: CustomEvent, el: HTMLElement}>
  event(selector: string, event: string): Observable<{ev: Event, el: HTMLElement}> {
    return new Observable(emit => {
      const shadow = this.shadowRoot || this.attachShadow({mode: 'open'})
      const cb = (ev: Event) => {
        for (let el = ev.target as HTMLElement; el; el = el.parentElement!) {
          if (el.matches(selector)) {
            this._log('event', {name: `${selector} ${event}`, ev, el})
            ev.preventDefault()
            emit.next({ev, el})
            break
          }
        }
      }
      shadow.addEventListener(event, cb)
      return () => shadow.removeEventListener(event, cb)
    })
  }

  input<T extends keyof TypeMap>(name: string, type: T): Observable<TypeMap[T]>
  input(name: string, type: keyof TypeMap = 'any'): Observable<any> {

    if (!(type in CAST)) throw new TypeError(`Invalid type "${type}" for input "${name}"`)

    const prop = toPropName(name)
    const attr = toAttrName(name)

    if (this._inputs[attr]) return Observable.from(this._inputs[attr].$)

    let init
    if (type != 'any') {
      init = this.hasAttribute(attr)
        ? DESERIALIZE[type](this.getAttribute(attr)!)
        : DEFAULT[type]
    }
    if (this.hasOwnProperty(prop)) {
      init = CAST[type]((this as {[prop: string]: any})[prop])
    }
    this._log('input', {name, value: init})
    const $ = new Behavior(init)

    Object.defineProperty(this, prop, {
      get: () => $.value,
      set: value => {
        if (this._processInput && value !== $.value) {
          const inputValue = CAST[type](value)
          this._log('input', {name, value: inputValue})
          this._ignoreOutput(attr, () => $.next(inputValue))
        }
      },
    })

    this._inputs[attr] = ({type, $})
    return Observable.from($)

  }

  output<T extends keyof TypeMap>(name: string, type: T): IObserver<TypeMap[T]>
  output(name: string, type: keyof TypeMap = 'any'): IObserver<any> {

    if (!(type in CAST)) throw new TypeError(`Invalid type "${type}" for output "${name}"`)

    const event = toEventName(name)
    const prop = toPropName(name)
    const attr = toAttrName(name)

    return {
      next: value => this._ignoreInputs(() => {

        const propValue = CAST[type](value)
        const attrValue = type == 'any' ? null : SERIALIZE[type](value)

        // skip when prop value is the same
        if (this[prop] === propValue) return
        // skip when attr value is the same
        if (type != 'any' && this.getAttribute(attr) == attrValue) return

        this._log('output', {name, value: propValue})
        this[prop] = value

        if (type != 'any') {
          if (attrValue === null) this.removeAttribute(attr)
          else this.setAttribute(attr, attrValue)
        }

        // don't emit event when it comes from the input with the same name
        if (this._ignoredOutputs.every(output => output != attr)) {
          const ev = new CustomEvent(event, {
            detail: propValue,
            bubbles: true,
          })
          this.dispatchEvent(ev)
        }

      }),
      error: error => this._log('output error', {name, error}),
    }

  }

  private _ignoreInputs(callback: () => any) {
    this._processInput = false
    try { callback() }
    finally { this._processInput = true }
  }

  private _ignoreOutput(output: string, callback: () => any) {
    this._ignoredOutputs.push(output)
    try { callback() }
    finally {
      this._ignoredOutputs = this._ignoredOutputs.filter(o => o != output)
    }
  }

  private _log(type: string, {name, value, error, ...details}: {[opt: string]: any}) {

    if (this._debug || error) {

      let s = `<${this.tagName.toLowerCase()}> ${type.toUpperCase()}`

      if (name && value) s += ` ${name} = ${JSON.stringify(value)}`
      else if (name) s += ` ${name}`

      if (error) console.group(s)
      else console.groupCollapsed(s)

      console.log(this)
      if (error) console.error(error)
      Object.keys(details).forEach(k => console.log(`${k}:`, details[k]))

      console.groupEnd()

    }

  }

}
