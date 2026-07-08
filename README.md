# libimagequant-wasm

A TypeScript/JavaScript WebAssembly wrapper for the [libimagequant](https://github.com/ImageOptim/libimagequant) image quantization library. This package provides high-quality image color quantization in the browser using Web Workers for optimal performance.

## Features

- **High-quality image quantization** - Convert 24/32-bit images to an indexed palette PNG with alpha channel
- **Dynamic bit depth** - Automatically uses 1/2/4/8-bit indexed PNG based on actual palette size for smaller files
- **Web Worker support** - Non-blocking image processing using Web Workers
- **Promise-based API** - Modern, easy-to-use async interface
- **Optimized WASM** - Size and performance optimized WebAssembly build
- **Browser compatible** - Works in all modern browsers supporting WebAssembly
- **Multiple formats** - Supports ESM and CommonJS

## Installation

```bash
pnpm install libimagequant-wasm
```

### Requirements

- Node.js >= 20.19.0
- Modern browser with WebAssembly and Web Worker support

## Quick Start

### Quantize a PNG

```typescript
import LibImageQuant from 'libimagequant-wasm';

const quantizer = new LibImageQuant();

// Fetch a PNG and quantize it
const response = await fetch('image.png');
const pngData = new Uint8Array(await response.arrayBuffer());

const result = await quantizer.quantizePng(pngData, {
  maxColors: 64,
  quality: { min: 0, target: 100 },
  speed: 3,
});

console.log(`Quantized to ${result.paletteLength} colors`);
console.log(`Quality: ${Math.round(result.quality * 100)}%`);

// result.pngBytes - quantized indexed PNG as Uint8Array
// result.imageData - quantized image as ImageData (for canvas rendering)

quantizer.dispose();
```

### Quantize from Canvas

```typescript
import LibImageQuant from 'libimagequant-wasm';

const quantizer = new LibImageQuant();

const canvas = document.getElementById('myCanvas') as HTMLCanvasElement;
const ctx = canvas.getContext('2d')!;
const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);

const result = await quantizer.quantizeImageData(imageData, {
  maxColors: 32,
  speed: 1,
  dithering: 0.8,
});

// Draw quantized result back to canvas
ctx.putImageData(result.imageData, 0, 0);

quantizer.dispose();
```

### Input Formats

`quantizePng` accepts multiple input types:

```typescript
// Uint8Array
const result = await quantizer.quantizePng(pngBytes);

// ArrayBuffer
const result = await quantizer.quantizePng(arrayBuffer);

// Blob
const result = await quantizer.quantizePng(blob);
```

## API Reference

### LibImageQuant

#### Constructor

```typescript
const quantizer = new LibImageQuant(options?: LibImageQuantOptions);
```

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `workerUrl` | `string` | auto-detected | Custom path to the worker module |
| `wasmUrl` | `string` | auto-detected | Custom path to the WASM module directory |
| `initTimeout` | `number` | `10000` | Worker initialization timeout (ms) |
| `operationTimeout` | `number` | `30000` | Per-operation timeout (ms) |

#### Methods

##### `quantizePng(pngData, options?)`

Quantizes a PNG image from binary data.

- `pngData`: `Uint8Array | ArrayBuffer | Blob` - PNG file bytes
- `options`: `QuantizationOptions` (optional)
- Returns: `Promise<QuantizationResult>`

##### `quantizeImageData(imageData, options?)`

Quantizes an `ImageData` object (e.g. from canvas).

- `imageData`: `ImageData` - RGBA image data
- `options`: `QuantizationOptions` (optional)
- Returns: `Promise<QuantizationResult>`

##### `dispose()`

Terminates the worker, rejects any pending operations, and releases resources. Safe to call multiple times.

### QuantizationOptions

```typescript
{
  speed?: number;          // Speed vs quality (1-10, lower = better quality)
  quality?: {
    min: number;           // Minimum acceptable quality (0-100)
    target: number;        // Target quality (0-100)
  };
  maxColors?: number;      // Maximum colors in palette (2-256)
  dithering?: number;      // Dithering level (0.0-1.0)
  posterization?: number;  // Posterization level (0-4)
}
```

### QuantizationResult

```typescript
{
  palette: number[][];     // Color palette as [[r,g,b,a], ...]
  pngBytes: Uint8Array;    // Quantized indexed PNG file bytes
  imageData: ImageData;    // Quantized RGBA image data (for canvas)
  quality: number;         // Achieved quality (0.0-1.0)
  paletteLength: number;   // Number of colors in palette
  width: number;           // Image width in pixels
  height: number;          // Image height in pixels
}
```

## Output Format

The generated PNG is an indexed color image. The encoder automatically selects
the smallest bit depth that can represent the actual palette:

| Actual palette size | PNG bit depth | Indices per byte |
|---------------------|---------------|------------------|
| 1–2 colors          | 1-bit         | 8                |
| 3–4 colors          | 2-bit         | 4                |
| 5–16 colors         | 4-bit         | 2                |
| 17–256 colors       | 8-bit         | 1                |

This keeps files smaller than a fixed 8-bit indexed PNG when fewer colors are
used, without changing the quantization behavior or image quality.

## Build from Source

### Prerequisites

- [Rust](https://rustup.rs/) with the `wasm32-unknown-unknown` target
- [wasm-pack](https://rustwasm.github.io/wasm-pack/installer/)
- Node.js >= 20.19.0
- [wasm-opt](https://github.com/WebAssembly/binaryen) (optional, for WASM size optimization)

### Setup

```bash
# Install Rust and wasm-pack
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
curl https://rustwasm.github.io/wasm-pack/installer/init.sh -sSf | sh
rustup target add wasm32-unknown-unknown

# Install dependencies
pnpm install

# Build
pnpm run build
```

### Scripts

| Script | Description |
|--------|-------------|
| `pnpm run build` | Full build (WASM + TypeScript + types) |
| `pnpm run build:wasm` | Build WASM module only |
| `pnpm run build:types` | Generate TypeScript declarations only |
| `pnpm run typecheck` | Run TypeScript type checking |
| `pnpm test` | Run tests (vitest + browser) |
| `pnpm run test:watch` | Run tests in watch mode |
| `pnpm run dev` | Start Vite dev server |
| `pnpm run clean` | Remove build output |

## Testing

Tests run in a real browser via [Vitest](https://vitest.dev/) with `@vitest/browser` and Playwright. No mocks — the actual WASM module is loaded and executed.

```bash
# Build first (tests run against built output)
pnpm run build

# Run tests (headless Chromium)
pnpm test
```

The test suite covers:
- **High-level API** - `LibImageQuant` class, all input formats, options, disposal, concurrency, error handling
- **Low-level WASM** - `ImageQuantizer`, `QuantizationResult`, PNG encode/decode, memory management
- **Result validation** - Color accuracy, PNG integrity, transparency roundtrips

## Browser Support

Requires WebAssembly and Web Worker support:

- Chrome 57+
- Firefox 52+
- Safari 11+
- Edge 16+

## Performance Tips

1. **Reuse quantizer instances** when processing multiple images
2. **Use appropriate speed settings** - higher speed for real-time, lower for final output
3. **Consider image size** - quantization time scales with pixel count
4. **Call `dispose()`** when done to release the Web Worker

## Examples

See `examples/test.html` for a complete working example with:
- File upload
- Real-time parameter adjustment
- Visual comparison
- Palette display
- Performance metrics

## License

MIT License - See LICENSE file for details.

**Important Note**: This project wraps the libimagequant library, which is dual-licensed under GPL-3.0 and commercial licenses. While this wrapper is MIT licensed, you must ensure you comply with the appropriate libimagequant license for your use case. For commercial use, you may need to obtain a commercial license from the libimagequant authors.

## Contributing

1. Fork the repository
2. Create your feature branch
3. Build: `pnpm run build`
4. Test: `pnpm test`
5. Submit a pull request

## Troubleshooting

### Worker Loading Issues
Ensure the worker module is served from the same origin, or pass a custom `workerUrl` to the constructor.

### WASM Loading Issues
- Verify WebAssembly support: `typeof WebAssembly === 'object'`
- Check browser console for loading errors
- Ensure proper MIME type for `.wasm` files (`application/wasm`)
- Pass a custom `wasmUrl` if the WASM files are hosted separately

### Performance Issues
- Large images may take significant time to quantize
- Consider resizing images before quantization
- Use higher `speed` settings for real-time applications
