import { createVuePlugin } from 'vite-plugin-vue2';
import path from 'path';
import { defineConfig } from 'vite';

export default defineConfig({
  clearScreen: false,
  resolve: {
    alias: {
      'vue-request': path.resolve(__dirname, '../src/index.ts'),
    },
  },
  plugins: [createVuePlugin()],
});
