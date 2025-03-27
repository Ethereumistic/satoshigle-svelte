import { join } from 'path'

/** @type {import('tailwindcss').Config} */
export default {
  content: [
    join(import.meta.dir, './src/**/*.{svelte,js,ts}')
  ],
  theme: {
    extend: {},
  },
  plugins: [],
}