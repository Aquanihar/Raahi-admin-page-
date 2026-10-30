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

function updateLocalFile(id, action, adminNotes) {
  let updatedItem = null;
  const status = action === 'APPROVE' ? 'APPROVED' : 'REJECTED';
  const reviewedAt = new Date().toISOString();

  const files = [
    path.resolve(process.cwd(), 'data', 'verifications.json'),
    path.resolve(process.cwd(), '..', 'Carpool app', 'data', 'verifications.json'),
  ];

  files.forEach((filePath) => {
    try {
      if (fs.existsSync(filePath)) {
        const raw = fs.readFileSync(filePath, 'utf8');
        const list = JSON.parse(raw);
        if (Array.isArray(list)) {
          const updatedList = list.map((item) => {
            if (item.id === id || item.email?.toLowerCase() === id.toLowerCase()) {
              const u = {
                ...item,
                status,
                adminNotes: adminNotes || (action === 'REJECT' ? 'Invalid documents try with Original documents' : 'Verified successfully.'),
                reviewedAt,
              };
              updatedItem = u;
              return u;
            }
            return item;
          });
          fs.writeFileSync(filePath, JSON.stringify(updatedList, null, 2), 'utf8');
        }
      }
    } catch (err) {
      console.error('Error updating local file in review:', err.message);
    }
  });

  return updatedItem;
}

export async function POST(req, { params }) {
  try {
    const { id } = await params;
    const body = await req.json();
    const { action, adminNotes } = body;

    let updatedRecord = null;
    const customBackendUrl = req.headers.get('x-carpool-backend-url');
    const backendBase = customBackendUrl || process.env.CARPOOL_API_URL || process.env.NEXT_PUBLIC_CARPOOL_API_URL;

    // 1. Try calling Carpool App backend review route if URL is set
    if (backendBase) {
      try {
        const targetUrl = `${backendBase.replace(/\/$/, '')}/api/verification/${encodeURIComponent(id)}/review`;
        const res = await withTimeout(
          fetch(targetUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action, adminNotes }),
          }),
          3000
        );
        if (res.ok) {
          const data = await res.json();
          if (data.success && data.verification) {
            updatedRecord = data.verification;
          }
        }
      } catch (e) {}
    }

    // 2. Update local files (internal and shared)
    const localResult = updateLocalFile(id, action, adminNotes);
    if (!updatedRecord) {
      updatedRecord = localResult;
    }

    // 3. If still no record, query Supabase cloud rides table directly
    const decodedId = decodeURIComponent(id);
    const normEmail = decodedId.includes('@') ? decodedId.toLowerCase().trim() : '';

    if (!updatedRecord) {
      try {
        const { data: rows } = await withTimeout(
          supabase
            .from('rides')
            .select('*')
            .ilike('status', 'VERIFICATION_%'),
          3000
        );
        if (rows && Array.isArray(rows)) {
          const matching = rows.filter((r) => {
            const rEmail = (r.driver?.email || '').toLowerCase().trim();
            return r.id === decodedId || (normEmail && rEmail === normEmail);
          });
          if (matching.length > 0) {
            const photoRow = matching.find(
              (r) => r.driver?.idProofBase64 || r.driver?.drivingLicenseBase64
            ) || matching[0];
            updatedRecord = {
              ...photoRow.driver,
              ...matching[0].driver,
              id: decodedId,
              email: matching[0].driver?.email || normEmail,
            };
          }
        }
      } catch (err) {}
    }

    // 4. Persist review row to Supabase cloud database
    const userEmail = (updatedRecord?.email || normEmail || decodedId).toLowerCase().trim();
    const status = action === 'APPROVE' ? 'APPROVED' : 'REJECTED';
    const finalNotes = adminNotes || (action === 'REJECT' ? 'Invalid documents try with Original documents' : 'Verified successfully.');
    const now = new Date();
    const reviewedAt = now.toISOString();
    const updateId = `doc_${userEmail.replace(/[^a-z0-9]/g, '_')}_${now.getTime()}`;

    const completeRecord = {
      ...(updatedRecord || {}),
      id: updateId,
      email: userEmail,
      status,
      adminNotes: finalNotes,
      reviewedAt,
    };

    try {
      const payload = {
        id: updateId,
        driver_id: updateId,
        origin: 'Verification Portal',
        destination: 'Document Verification',
        origin_latitude: 0,
        origin_longitude: 0,
        destination_latitude: 0,
        destination_longitude: 0,
        departure_date: now.toISOString().split('T')[0],
        departure_time: '00:00',
        total_seats: 1,
        available_seats: 1,
        price_per_seat: 0,
        status: action === 'APPROVE' ? 'VERIFICATION_APPROVED' : 'VERIFICATION_REJECTED',
        driver: {
          type: 'DOC_VERIFICATION',
          ...completeRecord,
        },
        created_at: completeRecord?.submittedAt || now.toISOString(),
        updated_at: reviewedAt,
      };
      await withTimeout(
        supabase.from('rides').upsert([payload], { onConflict: 'id' }),
        3000
      );
    } catch (e) {
      console.error('Supabase review insert error in API route:', e);
    }

    return Response.json({
      success: true,
      message: action === 'APPROVE' ? 'Document verified and approved successfully!' : 'Document rejected.',
      verification: completeRecord,
    });
  } catch (error) {
    console.error('Error reviewing in admin portal API:', error);
    return Response.json({ success: false, message: error.message }, { status: 500 });
  }
}
