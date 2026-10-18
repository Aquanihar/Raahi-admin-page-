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

function updateLocalFile(id, action, adminNotes) {
  try {
    const carpoolDataFile = path.resolve(process.cwd(), '..', 'Carpool app', 'data', 'verifications.json');
    if (fs.existsSync(carpoolDataFile)) {
      const raw = fs.readFileSync(carpoolDataFile, 'utf8');
      const list = JSON.parse(raw);
      if (Array.isArray(list)) {
        let updatedItem = null;
        const status = action === 'APPROVE' ? 'APPROVED' : 'REJECTED';
        const reviewedAt = new Date().toISOString();

        const updatedList = list.map((item) => {
          if (item.id === id || item.email?.toLowerCase() === id.toLowerCase()) {
            updatedItem = {
              ...item,
              status,
              adminNotes: adminNotes || (action === 'REJECT' ? 'Invalid documents try with Original documents' : 'Verified successfully.'),
              reviewedAt,
            };
            return updatedItem;
          }
          return item;
        });

        if (updatedItem) {
          fs.writeFileSync(carpoolDataFile, JSON.stringify(updatedList, null, 2), 'utf8');
          return updatedItem;
        }
      }
    }
  } catch (err) {
    console.error('Error updating local file in review:', err.message);
  }
  return null;
}

export async function POST(req, { params }) {
  try {
    const { id } = await params;
    const body = await req.json();
    const { action, adminNotes } = body;

    let updatedRecord = null;
    const customBackendUrl = req.headers.get('x-carpool-backend-url');
    const backendBase = customBackendUrl || process.env.CARPOOL_API_URL || process.env.NEXT_PUBLIC_CARPOOL_API_URL || 'http://localhost:3000';

    // 1. Try calling Carpool App backend review route
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

    // 2. If Carpool app was not reached or not updated, update local file
    if (!updatedRecord) {
      updatedRecord = updateLocalFile(id, action, adminNotes);
    } else {
      // Keep local file in sync
      updateLocalFile(id, action, adminNotes);
    }

    // 3. Try updating Supabase in background with fast timeout
    if (updatedRecord) {
      const normEmail = (updatedRecord.email || id).toLowerCase();
      const status = action === 'APPROVE' ? 'APPROVED' : 'REJECTED';
      const finalNotes = adminNotes || (action === 'REJECT' ? 'Invalid documents try with Original documents' : 'Verified successfully.');
      const reviewedAt = new Date().toISOString();

      try {
        await withTimeout(
          supabase
            .from('verifications')
            .update({ status, adminNotes: finalNotes, reviewedAt })
            .or(`id.eq.${id},email.eq.${normEmail}`),
          1500
        );
      } catch (e) {}

      try {
        const updateId = `doc_${normEmail.replace(/[^a-z0-9]/g, '_')}_${Date.now()}`;
        await withTimeout(
          supabase.from('rides').insert([
            {
              id: updateId,
              driver: {
                type: 'DOC_VERIFICATION',
                ...updatedRecord,
                status,
                adminNotes: finalNotes,
                reviewedAt,
              },
              status: action === 'APPROVE' ? 'VERIFICATION_APPROVED' : 'VERIFICATION_REJECTED',
            },
          ]),
          1500
        );
      } catch (e) {}
    }

    if (!updatedRecord) {
      return Response.json({ success: false, message: 'Verification record not found.' }, { status: 404 });
    }

    return Response.json({
      success: true,
      message: action === 'APPROVE' ? 'Document verified and approved successfully!' : 'Document rejected.',
      verification: updatedRecord,
    });
  } catch (error) {
    console.error('Error reviewing in admin portal:', error);
    return Response.json({ success: false, message: error.message }, { status: 500 });
  }
}
