/**
 * Compact CSS-ish path for an element, for analytics click events.
 * Walks at most the element plus 4 ancestors; an ancestor with an id
 * anchors the path (`#id > …`) and stops the walk. Other segments are
 * `tag.firstClass:nth-of-type(n)` (class/nth only when present/needed).
 * Output is hard-capped at 120 chars.
 */
export function selectorPath(el: Element): string {
  const parts: string[] = []
  let node: Element | null = el

  while (node && parts.length < 5) {
    const cur: Element = node
    if (cur === document.body || cur === document.documentElement) break

    if (cur.id) {
      parts.unshift(`#${cur.id}`)
      break
    }

    let seg = cur.tagName.toLowerCase()
    const cls = cur.classList[0]
    if (cls && /^[A-Za-z0-9_-]+$/.test(cls)) seg += `.${cls}`

    const parent = cur.parentElement
    if (parent) {
      const sameTag = Array.from(parent.children).filter((c) => c.tagName === cur.tagName)
      if (sameTag.length > 1) seg += `:nth-of-type(${sameTag.indexOf(cur) + 1})`
    }

    parts.unshift(seg)
    node = parent
  }

  return (parts.join(' > ') || el.tagName.toLowerCase()).slice(0, 120)
}
