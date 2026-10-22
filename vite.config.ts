import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// VITE_BASE : sous-dossier GitHub Pages (ex. /cap-emploi/). Port 3000 : URL de site par défaut de Supabase Auth.
export default defineConfig({
  base: process.env.VITE_BASE || '/',
  plugins: [react()],
  server: { port: 3000, strictPort: true },
});
