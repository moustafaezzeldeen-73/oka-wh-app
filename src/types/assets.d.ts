/** Metro resolves font and audio files to asset module ids (numbers). */
declare module '*.ttf' {
  const asset: number;
  export default asset;
}

declare module '*.otf' {
  const asset: number;
  export default asset;
}

declare module '*.wav' {
  const asset: number;
  export default asset;
}
