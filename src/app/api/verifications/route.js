import fs from 'fs';
import path from 'path';
import { supabase } from '@/lib/supabase';

async function withTimeout(promise, ms = 2000) {
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

function getRowTimestamp(r) {
  if (!r) return 0;
  const tRev = r.driver?.reviewedAt ? new Date(r.driver.reviewedAt).getTime() : 0;
  const tSub = r.driver?.submittedAt ? new Date(r.driver.submittedAt).getTime() : 0;
  const idMatch = (r.id || '').match(/_(\d{13})$/);
  const tId = idMatch ? parseInt(idMatch[1], 10) : 0;
  const tCreated = r.created_at ? new Date(r.created_at).getTime() : 0;
  const tUpdated = r.updated_at ? new Date(r.updated_at).getTime() : 0;
  return Math.max(tRev, tSub, tId, tCreated, tUpdated);
}

export async function GET(req) {
  const recordsMap = new Map();

  // 1. Authoritative local file storage (always has full base64 photos)
  const fileRecords = getLocalVerificationsFromFile();
  fileRecords.forEach((r) => {
    if (r && (r.email || r.id)) {
      const email = (r.email || r.id).toLowerCase().trim();
      recordsMap.set(email, { ...r, email });
    }
  });

  // 2. Fetch from Carpool App API if available
  const customBackendUrl = req.headers.get('x-carpool-backend-url');
  const backendBase = customBackendUrl || process.env.CARPOOL_API_URL || process.env.NEXT_PUBLIC_CARPOOL_API_URL || 'http://localhost:3000';
  if (backendBase) {
    try {
      const targetUrl = backendBase.replace(/\/$/, '') + '/api/verification';
      const res = await withTimeout(fetch(targetUrl, { cache: 'no-store' }), 2000);
      if (res.ok) {
        const data = await res.json();
        if (data.verifications && Array.isArray(data.verifications)) {
          data.verifications.forEach((r) => {
            if (r && r.email) {
              const email = r.email.toLowerCase().trim();
              const existing = recordsMap.get(email);
              recordsMap.set(email, {
                ...(existing || {}),
                ...r,
                email,
                idProofBase64: r.idProofBase64 || existing?.idProofBase64 || '',
                drivingLicenseBase64: r.drivingLicenseBase64 || existing?.drivingLicenseBase64 || '',
              });
            }
          });
        }
      }
    } catch (err) {}
  }

  // 3. Supabase rides cloud query with timeout
  try {
    const { data: rows } = await withTimeout(
      supabase
        .from('rides')
        .select('*')
        .ilike('status', 'VERIFICATION_%'),
      3000
    );
    if (rows && Array.isArray(rows)) {
      const groups = new Map();
      rows.forEach((r) => {
        if (r.driver && (r.driver.type === 'DOC_VERIFICATION' || r.driver.email)) {
          const email = (r.driver.email || '').toLowerCase().trim();
          if (email) {
            if (!groups.has(email)) groups.set(email, []);
            groups.get(email).push(r);
          }
        }
      });

      groups.forEach((userRows, email) => {
        userRows.sort((a, b) => getRowTimestamp(b) - getRowTimestamp(a));
        const latest = userRows[0];
        const photoRow = userRows.find(
          (r) => r.driver?.idProofBase64 || r.driver?.drivingLicenseBase64
        ) || latest;

        const existing = recordsMap.get(email);
        const status = latest.status === 'VERIFICATION_APPROVED' ? 'APPROVED'
          : latest.status === 'VERIFICATION_REJECTED' ? 'REJECTED'
          : (latest.driver?.status || existing?.status || 'PENDING');

        recordsMap.set(email, {
          ...(existing || {}),
          ...photoRow.driver,
          ...latest.driver,
          id: latest.driver?.id || latest.id || existing?.id,
          email,
          status,
          rowId: latest.id,
          idProofBase64: photoRow.driver?.idProofBase64 || latest.driver?.idProofBase64 || existing?.idProofBase64 || '',
          idProofName: photoRow.driver?.idProofName || latest.driver?.idProofName || existing?.idProofName || 'Identity Document',
          drivingLicenseBase64: photoRow.driver?.drivingLicenseBase64 || latest.driver?.drivingLicenseBase64 || existing?.drivingLicenseBase64 || '',
          drivingLicenseName: photoRow.driver?.drivingLicenseName || latest.driver?.drivingLicenseName || existing?.drivingLicenseName || 'Driving License',
          submittedAt: latest.driver?.submittedAt || photoRow.driver?.submittedAt || existing?.submittedAt || new Date(getRowTimestamp(photoRow)).toISOString(),
          reviewedAt: latest.driver?.reviewedAt || existing?.reviewedAt || (status !== 'PENDING' ? new Date(getRowTimestamp(latest)).toISOString() : null),
          adminNotes: latest.driver?.adminNotes || existing?.adminNotes || '',
        });
      });
    }
  } catch (err) {}

  const result = Array.from(recordsMap.values()).sort(
    (a, b) =>
      new Date(b.reviewedAt || b.submittedAt || 0) -
      new Date(a.reviewedAt || a.submittedAt || 0)
  );

  return Response.json({ success: true, verifications: result });
}
