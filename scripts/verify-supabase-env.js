#!/usr/bin/env node
/**
 * Validates Supabase-related env vars and optionally calls the Storage API.
 * Does not print secret values (only type, length, masked fingerprint).
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { createClient } = require('@supabase/supabase-js');

function mask(s) {
  if (!s || s.length < 10) return '(empty or too short)';
  return `${s.length} chars (value not printed)`;
}

const urlRaw = process.env.SUPABASE_URL;
const keyRaw = process.env.SUPABASE_SERVICE_ROLE_KEY;
const url = typeof urlRaw === 'string' ? urlRaw.trim() : '';
const key = typeof keyRaw === 'string' ? keyRaw.trim() : '';
const bucket =
  (process.env.SUPABASE_STORAGE_BRAND_TAGS_BUCKET || 'brand-tag-images').trim();

let fatal = false;
const warnings = [];

console.log('--- Supabase env check (secrets not shown) ---\n');

if (!url) {
  console.log('SUPABASE_URL: MISSING');
  fatal = true;
} else {
  try {
    const u = new URL(url);
    const okHost = /\.supabase\.co$/i.test(u.hostname);
    console.log(`SUPABASE_URL: OK — host=${u.hostname} scheme=${u.protocol}`);
    if (u.protocol !== 'https:') {
      console.log('  ! use https://');
      fatal = true;
    }
    if (!okHost) {
      warnings.push('Host is not *.supabase.co — OK only if you know what you are doing.');
    }
  } catch {
    console.log('SUPABASE_URL: INVALID (not a URL)');
    fatal = true;
  }
}

if (!key) {
  console.log('SUPABASE_SERVICE_ROLE_KEY: MISSING');
  fatal = true;
} else {
  const pub = key.startsWith('sb_publishable_');
  const sec = key.startsWith('sb_secret_');
  const jwt = key.startsWith('eyJ');
  let kind = 'unknown';
  if (pub) kind = 'publishable (WRONG for this app)';
  else if (sec) kind = 'secret (correct type)';
  else if (jwt) kind = 'legacy JWT (service_role-style, OK)';
  else kind = 'unrecognized prefix — check key';

  console.log(`SUPABASE_SERVICE_ROLE_KEY: ${mask(key)}`);
  console.log(`  detected: ${kind}`);

  if (pub) {
    fatal = true;
    console.log('  ! Use a Secret key or legacy service_role key, not Publishable.');
  }
  if (!sec && !jwt && !pub) {
    fatal = true;
    console.log('  ! Expected sb_secret_… or eyJ… (legacy service_role).');
  }
}

console.log(`SUPABASE_STORAGE_BRAND_TAGS_BUCKET: ${bucket}`);
warnings.forEach((w) => console.log(`\nWARN: ${w}`));

async function live() {
  if (fatal) {
    console.log('\nLive API test skipped (fix the issues above).');
    process.exit(1);
    return;
  }

  console.log('\nLive test: Supabase Storage listBuckets() …');
  try {
    const sb = createClient(url, key, { auth: { persistSession: false } });
    const { data, error } = await sb.storage.listBuckets();

    if (error) {
      console.log('FAIL:', error.message);
      process.exit(1);
      return;
    }

    const names = (data || []).map((b) => b.name);
    console.log(`OK — ${names.length} bucket(s) visible to this key.`);

    if (!names.includes(bucket)) {
      console.log(
        `FAIL — bucket "${bucket}" not found. Create it (Dashboard → Storage) or run database/supabase_storage_brand_tag_images.sql`
      );
      if (names.length) console.log('Existing buckets:', names.join(', '));
      process.exit(1);
      return;
    }

    console.log(`OK — bucket "${bucket}" exists.`);
    console.log('\nAll Supabase Storage checks passed.');
    process.exit(0);
  } catch (e) {
    console.log('FAIL:', e.message || e);
    process.exit(1);
  }
}

live();
