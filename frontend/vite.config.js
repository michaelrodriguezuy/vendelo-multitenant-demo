import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    host: '0.0.0.0',
    port: 5173,
    // Los navegadores resuelven *.localhost a 127.0.0.1 sin tocar /etc/hosts,
    // y es lo que permite probar el ruteo por subdominio de verdad.
    allowedHosts: ['.localhost'],
    // `shared/` vive fuera del root del front.
    fs: { allow: ['..'] },
    proxy: {
      '/api': {
        target: process.env.BACKEND_URL || 'http://localhost:8080',
        // changeOrigin en false: el backend resuelve el tenant leyendo el
        // header Host, así que hay que preservarlo tal cual lo mandó el
        // navegador. Reescribirlo rompería la resolución.
        changeOrigin: false,
      },
    },
  },
});
