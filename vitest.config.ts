import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.{ts,js,mjs,cjs}', 'daemon/**/*.test.{ts,js,mjs,cjs}'],
  },
});
