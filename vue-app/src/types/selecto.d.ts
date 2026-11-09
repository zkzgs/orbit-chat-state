declare module 'selecto' {
  interface SelectoOptions {
    container: HTMLElement
    dragContainer: HTMLElement
    selectableTargets: (string | (() => HTMLElement[]))[]
    selectByClick: boolean
    selectFromInside: boolean
    hitRate: number
    toggleContinueSelect?: string
    preventDragFromInside?: boolean
    preventClickEventOnDrag?: boolean
    keyContainer?: Window
    scrollOptions?: {
      container: HTMLElement
      threshold: number
      throttleTime: number
      checkScrollEvent: boolean
      requestScroll: (event: {
        container: HTMLElement
        direction: number[]
      }) => void
    }
    dragCondition: (event: { inputEvent: MouseEvent | TouchEvent }) => boolean
  }
  export default class Selecto {
    constructor(options: SelectoOptions)
    on(
      name: 'select' | 'selectStart' | 'selectEnd' | 'dragEnd',
      listener: (event: { selected: HTMLElement[] }) => void,
    ): this
    findSelectableTargets(): void
    setSelectedTargets(elements: HTMLElement[]): void
    destroy(): void
  }
}
