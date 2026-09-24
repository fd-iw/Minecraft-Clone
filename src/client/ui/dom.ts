type Child = Node | string | null | undefined | false;

export interface ElProps {
  class?: string;
  text?: string;
  style?: Partial<CSSStyleDeclaration>;
  attrs?: Record<string, string>;
  on?: Partial<{ [K in keyof HTMLElementEventMap]: (e: HTMLElementEventMap[K]) => void }>;
}

/** Tiny DOM builder: el('div', { class: 'x', on: { click } }, child, ...). */
export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: ElProps = {},
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (props.class) e.className = props.class;
  if (props.text !== undefined) e.textContent = props.text;
  if (props.style) Object.assign(e.style, props.style);
  if (props.attrs) for (const [k, v] of Object.entries(props.attrs)) e.setAttribute(k, v);
  if (props.on) for (const [k, fn] of Object.entries(props.on)) e.addEventListener(k, fn as EventListener);
  for (const c of children) if (c) e.append(c);
  return e;
}

export function button(label: string, onClick: () => void, cls = ''): HTMLButtonElement {
  return el('button', { class: `btn ${cls}`.trim(), text: label, on: { click: onClick } });
}
