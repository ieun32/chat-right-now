export function releaseConfig(config, env = process.env) {
  const supabase = env.SUPABASE_URL || env.SUPABASE_PUBLISHABLE_KEY
    ? { url: env.SUPABASE_URL, anonKey: env.SUPABASE_PUBLISHABLE_KEY } : config.supabase;
  let url;
  try { url = new URL(supabase?.url); } catch { throw new Error('Release requires a valid Supabase project URL.'); }
  if (url.protocol !== 'https:' || !url.hostname.endsWith('.supabase.co') || url.hostname.includes('your-project') || url.username || url.password) throw new Error('Release requires an HTTPS Supabase project URL.');
  const key = supabase?.anonKey || '';
  let anon = false;
  try { anon = JSON.parse(Buffer.from(key.split('.')[1], 'base64url')).role === 'anon'; } catch {}
  if (!key.startsWith('sb_publishable_') && !anon) throw new Error('Release requires a publishable/anon client key; secret keys are forbidden.');
  return { signaling: 'supabase', supabase: { url: url.origin, anonKey: key } };
}
