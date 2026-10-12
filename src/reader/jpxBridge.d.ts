// Types of jpxBridge.js. That file is copied as it is into pdf.js's worker; TypeScript reads these declarations.

/** The members of pdf.js's openjpeg module that JpxImage.decode uses. */
export interface JpxModule {
  /** Decoded pixels, interleaved by component, after a successful `_jp2_decode`. pdf.js takes them and clears this. */
  imageData: Uint8ClampedArray | null;
  /** Why the last `_jp2_decode` failed. pdf.js throws it and deletes it. */
  errorMessages?: string;
  /** Allocates an input buffer and returns its pointer (never 0). */
  _malloc(size: number): number;
  /** Releases the buffer of a pointer. */
  _free(pointer: number): void;
  /** Copies the codestream into the buffer of a pointer. */
  writeArrayToMemory(array: Uint8Array, pointer: number): void;
  /** Decodes the codestream: 0 on success, otherwise DECODE_FAILED or REQUEST_FAILED. */
  _jp2_decode(
    pointer: number,
    size: number,
    components: number,
    indexed: boolean,
    smask: boolean,
    reduce: number,
  ): number;
}

export declare const LINUX_BASE: "atril://localhost";
export declare const WINDOWS_BASE: "http://atril.localhost";
export declare const DECODE_FAILED: 1;
export declare const REQUEST_FAILED: 2;
export declare function protocolBase(userAgent: string): string;
export default function openjpeg(): JpxModule;
