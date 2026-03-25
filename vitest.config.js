import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['b24-imbot/**/*.test.js'],
    environment: 'node',
  },
});
