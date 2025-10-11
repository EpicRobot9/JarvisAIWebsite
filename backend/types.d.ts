// Ambient module shims for optional runtime-only deps used via dynamic import
// These suppress TS errors without pulling in full type packages.
declare module 'tesseract.js';
declare module 'mammoth';
declare module 'pptx-parser';
