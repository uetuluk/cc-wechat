declare module 'qrcode-terminal' {
  interface GenerateOptions {
    small?: boolean
  }

  function generate(
    text: string,
    options?: GenerateOptions,
    callback?: (qrcode: string) => void,
  ): void

  const qrcode: {
    generate: typeof generate
  }

  export default qrcode
}
