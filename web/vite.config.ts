import tailwindcss from '@tailwindcss/postcss';
import vinext from 'vinext';
import { defineConfig } from 'vite';
export default defineConfig({
  css: { postcss: { plugins: [tailwindcss()] } },
  server: { host: '127.0.0.1', port: 5173, strictPort: true, proxy: { '/api': {target:'http://127.0.0.1:4242',changeOrigin:true} } },
  plugins: [vinext()],
});
