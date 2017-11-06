import { Observable, Behavior, IObserver } from 'impulsejs'
import {
  SERIALIZE, DESERIALIZE, CAST, DEFAULT,
  toAttrName, toPropName, toEventName,
  TypeMap, JSX,
} from './types'

/**
 * Reactive Component base class
 */
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

  /**
   * Obtains a render observer.
   *
   * It will render virtual DOM into the element's shadow root.
   * Every event observed schedules a rerender on next tick.
   * Actual renderer function must be specified (e.g. `IncrementalDOM.patch`).
   *
   * @param cb Renderer function
   * @return Observer of virtual DOM events
   */
  render(cb: (parent: ShadowRoot, vdom: JSX.Element) => any): IObserver<JSX.Element> {
    if (!this.shadowRoot) this.attachShadow({mode: 'open'})
    let timeout
    return {
      next: dom => {
        if (timeout) clearTimeout(timeout)
        timeout = setTimeout(() => {
          this._log('render', {dom})
          cb(this.shadowRoot!, dom)
        }, 1)
      },
      error: error => this._log('render error', {error}),
    }
  }

  /**
   * Obtains a stream of events coming from element's shadow DOM.
   *
   * Registers an event listener for specified event name on the element's shadow root.
   * If the event target or any of it's parents matches the specified CSS selector,
   * an object of matched element and DOM event is emitted.
   *
   * @param selector
   * @param event
   * @return Stream of events
   */
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

  /**
   * Obtains a stream of input value changes, which emits values of given property/attribute.
   *
   * Type argument is used to (de)serialize value to/from attribute value.
   * Note that values of type `any` can't be passed via attribute (changes are ignored).
   *
   * Also note that this won't sync property and attribute values.
   * You should instead loop back the stream to the corresponding `output` observer.
   *
   * Changes made by element itself via output observer won't generate an input stream event.
   *
   * @param name Property/attribute name
   * @param type Type of input's values
   * @return Stream of values
   */
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

  /**
   * Obtains an observer of output values, which controls the value of given property/attribute.
   * Additionally a DOM event with the same name will be emitted upon value change.
   *
   * Type argument is used to (de)serialize value to/from attribute value.
   * Note that values of type `any` won't be reflected as attribute.
   *
   * Changes won't trigger corresponding input event in order to prevent infinite loop.
   *
   * Also a DOM event won't be emitted when a change was caused by corresponding input.
   * I.e. setting element's property `foo` won't cause the same element to emit DOM event `foo`.
   *
   * @param {string} name
   * @param {keyof TypeMap = 'any'} type
   * @return {IObserver<any>}
   */
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

        this._log('output', {name, value: propValue})
        this[prop] = value

        if (type != 'any') {
          if (attrValue === null) this.removeAttribute(attr)
          else this.setAttribute(attr, attrValue)
        }

        // skip when prop value is the same
        if (type != 'any' && this[prop] === propValue) return
        // skip when attr value is the same
        if (type != 'any' && this.getAttribute(attr) === attrValue) return
        // don't emit event when it comes from the input with the same name
        if (this._ignoredOutputs.some(o => o == attr)) return

        const ev = new CustomEvent(event, {
          detail: propValue,
          bubbles: true,
        })
        this.dispatchEvent(ev)

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

      if (name && value !== undefined) s += ` ${name} = ${JSON.stringify(value)}`
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
