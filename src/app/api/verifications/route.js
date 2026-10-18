import fs from 'fs';
import path from 'path';
import { supabase } from '@/lib/supabase';

async function withTimeout(promise, ms = 1500) {
  let timeoutId;
  const timeoutPromise = new Promise((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error('Timeout')), ms);
  });
  return Promise.race([
    promise.then((res) => {
      clearTimeout(timeoutId);
      return res;
    }),
    timeoutPromise,
  ]);
}

function getLocalVerificationsFromFile() {
  try {
    // Check Carpool app shared data folder
    const carpoolDataFile = path.resolve(process.cwd(), '..', 'Carpool app', 'data', 'verifications.json');
    if (fs.existsSync(carpoolDataFile)) {
      const raw = fs.readFileSync(carpoolDataFile, 'utf8');
      const list = JSON.parse(raw);
      if (Array.isArray(list)) return list;
    }
  } catch (err) {
    console.error('Error reading shared verifications file:', err.message);
  }
  return [];
}

export async function GET(req) {
  const recordsMap = new Map();

  // 1. First load from shared local file
  const fileRecords = getLocalVerificationsFromFile();
  fileRecords.forEach((r) => {
    if (r && r.email) recordsMap.set(r.email.toLowerCase(), r);
  });

  // 2. Fetch from Carpool App API (port 3000)
  try {
    const res = await withTimeout(
      fetch('http://localhost:3000/api/verification', { cache: 'no-store' }),
      2000
    );
    if (res.ok) {
      const data = await res.json();
      if (data.verifications && Array.isArray(data.verifications)) {
        data.verifications.forEach((r) => {
          if (r && r.email) recordsMap.set(r.email.toLowerCase(), r);
        });
      }
    }
  } catch (err) {
    // If Carpool app is restarting, local file fallback was already populated
  }

  // 3. Try Supabase dedicated table with fast timeout
  try {
    const { data: dedicated } = await withTimeout(
      supabase
        .from('verifications')
        .select('*')
        .order('submittedAt', { ascending: false }),
      1500
    );
    if (dedicated && Array.isArray(dedicated)) {
      dedicated.forEach((r) => {
        if (r && r.email) recordsMap.set(r.email.toLowerCase(), r);
      });
    }
  } catch (err) {}

  // 4. Try Supabase rides storage with fast timeout
  try {
    const { data: rows } = await withTimeout(
      supabase
        .from('rides')
        .select('*')
        .ilike('status', 'VERIFICATION_%')
        .order('id', { ascending: false }),
      1500
    );
    if (rows && Array.isArray(rows)) {
      rows.forEach((r) => {
        if (r.driver && r.driver.type === 'DOC_VERIFICATION' && r.driver.email) {
          const email = r.driver.email.toLowerCase();
          if (!recordsMap.has(email)) {
            recordsMap.set(email, r.driver);
          }
        }
      });
    }
  } catch (err) {}

  const result = Array.from(recordsMap.values()).sort(
    (a, b) => new Date(b.submittedAt || 0) - new Date(a.submittedAt || 0)
  );

  return Response.json({ success: true, verifications: result });
}
