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
  const mergedMap = new Map();
  const potentialPaths = [
    path.resolve(process.cwd(), 'data', 'verifications.json'),
    path.resolve(process.cwd(), '..', 'Carpool app', 'data', 'verifications.json'),
    path.resolve(process.cwd(), '..', 'raahi-admin-portal', 'data', 'verifications.json'),
    'C:\\Users\\Nihar Shankar Parab\\Projects\\Carpool app\\data\\verifications.json',
    'C:\\Users\\Nihar Shankar Parab\\Projects\\raahi-admin-portal\\data\\verifications.json',
  ];

  for (const filePath of potentialPaths) {
    try {
      if (fs.existsSync(filePath)) {
        const raw = fs.readFileSync(filePath, 'utf8');
        const list = JSON.parse(raw);
        if (Array.isArray(list)) {
          list.forEach((rec) => {
            if (rec && (rec.id || rec.email)) {
              const recId = rec.id || (rec.email ? rec.email.toLowerCase().trim() : 'rec_' + Math.random());
              const existing = mergedMap.get(recId);
              mergedMap.set(recId, {
                ...(existing || {}),
                ...rec,
                id: recId,
                idProofBase64: rec.idProofBase64 || existing?.idProofBase64 || '',
                drivingLicenseBase64: rec.drivingLicenseBase64 || existing?.drivingLicenseBase64 || '',
              });
            }
          });
        }
      }
    } catch (err) {}
  }

  return Array.from(mergedMap.values());
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
    if (r && (r.id || r.email)) {
      const subId = r.id || (r.email ? r.email.toLowerCase().trim() : 'rec_' + Math.random());
      recordsMap.set(subId, { ...r, id: subId });
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
            if (r && (r.id || r.email)) {
              const subId = r.id || (r.email ? r.email.toLowerCase().trim() : 'rec_' + Math.random());
              const existing = recordsMap.get(subId);
              recordsMap.set(subId, {
                ...(existing || {}),
                ...r,
                id: subId,
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
      rows.forEach((r) => {
        if (r.driver && (r.driver.type === 'DOC_VERIFICATION' || r.driver.email)) {
          const recId = r.driver.id || r.id;
          const existing = recordsMap.get(recId);
          const status = r.status === 'VERIFICATION_APPROVED' ? 'APPROVED'
            : r.status === 'VERIFICATION_REJECTED' ? 'REJECTED'
            : (r.driver?.status || existing?.status || 'PENDING');

          recordsMap.set(recId, {
            ...(existing || {}),
            ...r.driver,
            id: recId,
            status,
            rowId: r.id,
            idProofBase64: r.driver?.idProofBase64 || existing?.idProofBase64 || '',
            idProofName: r.driver?.idProofName || existing?.idProofName || 'Identity Document',
            drivingLicenseBase64: r.driver?.drivingLicenseBase64 || existing?.drivingLicenseBase64 || '',
            drivingLicenseName: r.driver?.drivingLicenseName || existing?.drivingLicenseName || 'Driving License',
            submittedAt: r.driver?.submittedAt || existing?.submittedAt || r.created_at,
            reviewedAt: r.driver?.reviewedAt || existing?.reviewedAt || (status !== 'PENDING' ? r.updated_at : null),
            adminNotes: r.driver?.adminNotes || existing?.adminNotes || '',
          });
        }
      });
    }
  } catch (err) {}

  const result = Array.from(recordsMap.values()).sort(
    (a, b) =>
      new Date(b.submittedAt || b.reviewedAt || 0) -
      new Date(a.submittedAt || a.reviewedAt || 0)
  );

  return Response.json({ success: true, verifications: result });
}
