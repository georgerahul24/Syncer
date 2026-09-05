// Central PDF.js setup, shared by the full reader and the library-grid
// thumbnail. Import `pdfjs` from here rather than 'pdfjs-dist' directly so
// the worker is always configured exactly once.
import * as pdfjs from 'pdfjs-dist';
// Vite's `?url` suffix resolves to the built asset's final URL, which is
// what GlobalWorkerOptions.workerSrc needs (a same-origin URL string, not a
// module object).
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

export { pdfjs };
