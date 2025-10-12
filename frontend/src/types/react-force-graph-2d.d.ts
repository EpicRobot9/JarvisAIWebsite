declare module 'react-force-graph-2d' {
  import { ComponentType } from 'react'
  type ForceGraphMethods = {
    zoomToFit?: (ms?: number, px?: number) => void
    centerAt?: (x?: number, y?: number, ms?: number) => void
    zoom?: (k: number, ms?: number) => void
  }
  const ForceGraph2D: ComponentType<any> & { prototype: ForceGraphMethods }
  export default ForceGraph2D
}
