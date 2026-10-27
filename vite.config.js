import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Builds straight into /app, which is the folder `zet pack` zips for Creator.
// Entry file is widget.html so Creator's default Index File (/widget.html) works.
export default defineConfig({
  plugins: [react()],
  base: './', // relative asset paths: the widget runs inside an iframe on Creator's domain
  build: {
    outDir: 'app',
    emptyOutDir: true,
    sourcemap: false, // .map files are not an allowed file type in a widget zip
    rollupOptions: {
      input: 'widget.html',
      output: {
        // short, hash-free names: Creator allows max 50 chars and A-Z a-z 0-9 _ . $ -
        entryFileNames: 'assets/widget.js',
        chunkFileNames: 'assets/[name].js',
        assetFileNames: 'assets/[name].[ext]',
      },
    },
  },
  server: { open: '/widget.html' },
});
