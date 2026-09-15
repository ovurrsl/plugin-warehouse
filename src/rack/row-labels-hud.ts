export class RowLabelHud {
  private element: HTMLDivElement

  constructor() {
    this.element = document.createElement('div')
    this.element.style.position = 'fixed'
    this.element.style.top = '0'
    this.element.style.left = '0'
    this.element.style.pointerEvents = 'none'
    this.element.style.zIndex = '50'
    
    // Base styling - yellow badge
    this.element.style.backgroundColor = '#facc15'
    this.element.style.color = '#1c1917'
    this.element.style.padding = '2px 8px'
    this.element.style.borderRadius = '4px'
    this.element.style.fontSize = '12px'
    this.element.style.fontWeight = 'bold'
    this.element.style.boxShadow = '0 2px 4px rgba(0,0,0,0.2)'
    this.element.style.whiteSpace = 'nowrap'
    this.element.style.opacity = '0'
    this.element.style.transition = 'opacity 0.2s ease-in-out'

    document.body.appendChild(this.element)
  }

  update(label: string, x: number, y: number, visible: boolean) {
    if (visible && label) {
      this.element.textContent = label
      this.element.style.transform = `translate(-50%, -100%) translate(${x}px, ${y - 10}px)`
      this.element.style.opacity = '1'
    } else {
      this.element.style.opacity = '0'
    }
  }

  destroy() {
    if (this.element.parentNode) {
      this.element.parentNode.removeChild(this.element)
    }
  }
}
