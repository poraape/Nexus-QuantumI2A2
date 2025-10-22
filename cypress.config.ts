import { defineConfig } from 'cypress';

export default defineConfig({
  video: false,
  e2e: {
    baseUrl: process.env.CYPRESS_BASE_URL || 'http://localhost:4173',
    supportFile: false,
  },
});
