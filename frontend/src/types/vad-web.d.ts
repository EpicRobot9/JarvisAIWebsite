declare module '@ricky0123/vad-web' {
  // Minimal ambient types to satisfy TypeScript; the runtime API is resolved dynamically.
  export class MicVAD {
    static new(options?: any): Promise<any>
    pause?: () => void
    stop?: () => void
    destroy?: () => void
  }
  const _default: { MicVAD: typeof MicVAD } | any
  export default _default
}
