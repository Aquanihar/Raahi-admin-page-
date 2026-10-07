import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://lsvsquzofjgvuhfksfqi.supabase.co';
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'sb_publishable_p2ITbNifbZgsFUXd3uqeGQ_Wi9HuxUW';

export const supabase = createClient(supabaseUrl, supabaseAnonKey);
