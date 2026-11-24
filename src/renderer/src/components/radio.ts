// Radio-group keyboard behavior for custom radio buttons: one Tab stop (roving tabindex) and
// arrow keys that move the selection, as the radiogroup role promises.

const NEXT: Record<string, number> = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }

/** tabIndex for the radio at `index`: the checked one, or the first when none is checked. */
export const radioTabIndex = (checked: boolean, index: number, anyChecked: boolean): number => (checked || (!anyChecked && index === 0) ? 0 : -1)

export function onRadioKeyDown(e: React.KeyboardEvent<HTMLElement>): void {
  const step = NEXT[e.key]
  if (!step) return
  const radios = [...e.currentTarget.querySelectorAll<HTMLButtonElement>('[role="radio"]:not(:disabled)')]
  if (!radios.length) return
  e.preventDefault()
  const at = radios.indexOf(document.activeElement as HTMLButtonElement)
  const next = radios[(at + step + radios.length) % radios.length]
  next.focus()
  next.click()
}
