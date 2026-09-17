import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.js'],
    // Los tests comparten un emulador: correrlos en paralelo haría que el
    // clearFirestore() de un archivo borre los datos de otro.
    fileParallelism: false,
    testTimeout: 20000,
    hookTimeout: 30000,
  },
});
