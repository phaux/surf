import { Observable, Behavior } from 'impulsejs'
import { Observer } from 'impulsejs/dist/types'
import {
  SERIALIZE, DESERIALIZE, CAST, DEFAULT,
  toAttrName, toPropName, toEventName,
  ATTR_TYPES, TypeMap, JSX,
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
    if (ATTR_TYPES.indexOf(type) < 0) return
    const value = next === null ? DEFAULT[type] : DESERIALIZE[type](next)
    if (this._debug) console.log(this.tagName, 'attr', attr, '<-', value)
    this._ignoreOutput(attr, () => $.next(value))
  }

  render(cb: (parent: ShadowRoot, vdom: JSX.Element) => any): Observer<JSX.Element> {
    if (!this.shadowRoot) this.attachShadow({mode: 'open'})
    return {
      next: vdom => {
        cb(this.shadowRoot!, vdom)
        if (this._debug) console.log(this.tagName, 'render')
      },
      error: err => console.error(this.tagName, 'error', err),
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
            if (this._debug) console.log(this.tagName, 'event', selector, event, '<-', ev)
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

    if (this._inputs[attr]) return this._inputs[attr].$

    let init
    if (ATTR_TYPES.indexOf(type) >= 0) {
      init = this.hasAttribute(attr)
        ? DESERIALIZE[type](this.getAttribute(attr)!)
        : DEFAULT[type]
      if (this._debug) console.log(this.tagName, 'attr', attr, '<-', init)
    }
    if (this.hasOwnProperty(prop)) {
      init = CAST[type]((this as {[prop: string]: any})[prop])
      if (this._debug) console.log(this.tagName, 'prop', prop, '<-', init)
    }

    const $ = new Behavior(init)

    Object.defineProperty(this, prop, {
      get: () => $.value,
      set: value => {
        if (this._processInput && value !== $.value) {
          if (this._debug) console.log(this.tagName, 'prop', prop, '<-', value)
          this._ignoreOutput(attr, () => $.next(CAST[type](value)))
        }
      },
    })

    this._inputs[attr] = ({type, $})
    return $

  }

  output<T extends keyof TypeMap>(name: string, type: T): Observer<TypeMap[T]>
  output(name: string, type: keyof TypeMap = 'any'): Observer<any> {

    if (!(type in CAST)) throw new TypeError(`Invalid type "${type}" for output "${name}"`)

    const event = toEventName(name)
    const prop = toPropName(name)
    const attr = toAttrName(name)

    return {
      next: value => this._ignoreInputs(() => {

        const propValue = CAST[type](value)
        const attrValue = SERIALIZE[type](value)

        if (this._debug) console.log(this.tagName, 'prop', prop, '->', propValue)
        this[prop] = value

        if (ATTR_TYPES.indexOf(type) >= 0) {
          if (this._debug) console.log(this.tagName, 'attr', attr, '->', attrValue)
          if (attrValue === null) this.removeAttribute(attr)
          else this.setAttribute(attr, attrValue)
        }

        if (this._ignoredOutputs.every(output => output != attr)) {
          const ev = new CustomEvent(event, {
            detail: propValue,
            bubbles: true,
          })
          if (this._debug) console.log(this.tagName, 'event', event, '->', ev)
          this.dispatchEvent(ev)
        }

      }),
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

}
