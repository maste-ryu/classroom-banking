import { writeFileSync } from 'node:fs';

const url = process.env.SUPABASE_URL?.trim();
const publishableKey = process.env.SUPABASE_PUBLISHABLE_KEY?.trim();
if (!url || !publishableKey) {
  throw new Error('Set the SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY GitHub Actions secrets before deploying.');
}
if (!/^https:\/\/[a-z0-9-]+\.supabase\.co\/?$/i.test(url)) {
  throw new Error('SUPABASE_URL must be your HTTPS Supabase project URL.');
}
const config = { supabaseUrl: url.replace(/\/$/, ''), supabasePublishableKey: publishableKey };
writeFileSync(new URL('../public/config.js', import.meta.url), `window.APP_CONFIG = ${JSON.stringify(config)};\n`, 'utf8');
console.log('Wrote public/config.js for static deployment.');
