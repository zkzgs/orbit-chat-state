declare module 'selecto' {
  interface SelectoOptions {
    container: HTMLElement
    dragContainer: HTMLElement
    selectableTargets: string[]
    selectByClick: boolean
    selectFromInside: boolean
    hitRate: number
    toggleContinueSelect: string
    dragCondition: (event: { inputEvent: MouseEvent | TouchEvent }) => boolean
  }
  export default class Selecto {
    constructor(options: SelectoOptions)
    on(
      name: 'select',
      listener: (event: { selected: HTMLElement[] }) => void,
    ): this
    findSelectableTargets(): void
    setSelectedTargets(elements: HTMLElement[]): void
    destroy(): void
  }
}
