'use client';

import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import {
  ShieldCheck,
  CheckCircle,
  XCircle,
  Clock,
  FileText,
  RefreshCw,
  ExternalLink,
  Mail,
  Phone,
  Calendar,
  Lock,
  Globe,
  Eye,
  Download,
  X,
  Maximize2,
} from 'lucide-react';
import styles from './admin.module.css';

// Safely format document string into a valid displayable Data URL or Web URL
function formatDocSrc(raw, fallbackType = 'image/jpeg') {
  if (!raw || typeof raw !== 'string') return '';
  const trimmed = raw.trim();
  if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) return trimmed;
  if (trimmed.startsWith('data:')) return trimmed;
  if (trimmed.startsWith('JVBERi')) return `data:application/pdf;base64,${trimmed}`;
  if (trimmed.startsWith('iVBORw')) return `data:image/png;base64,${trimmed}`;
  if (trimmed.startsWith('/9j/')) return `data:image/jpeg;base64,${trimmed}`;
  if (trimmed.startsWith('UklGR')) return `data:image/webp;base64,${trimmed}`;
  return `data:${fallbackType};base64,${trimmed}`;
}

// Check whether the document is an image or PDF
function isImageDoc(src, fileName = '') {
  if (!src) return false;
  if (src.startsWith('data:image/')) return true;
  if (src.startsWith('data:application/pdf')) return false;
  if (src.startsWith('http://') || src.startsWith('https://')) {
    return !/\.pdf$/i.test(src);
  }
  if (/\.(png|jpe?g|webp|gif|bmp|svg)$/i.test(fileName)) return true;
  if (/\.pdf$/i.test(fileName) && (src.startsWith('data:application/pdf') || src.includes('JVBERi'))) {
    return false;
  }
  return true;
}

// Download document safely without hitting browser top-level data URL security blocks
function downloadDocument(src, fileName) {
  if (!src) return;
  try {
    if (src.startsWith('data:')) {
      const parts = src.split(';base64,');
      if (parts.length === 2) {
        const contentType = parts[0].split(':')[1] || 'application/octet-stream';
        const raw = window.atob(parts[1]);
        const uInt8Array = new Uint8Array(raw.length);
        for (let i = 0; i < raw.length; ++i) {
          uInt8Array[i] = raw.charCodeAt(i);
        }
        const blob = new Blob([uInt8Array], { type: contentType });
        const blobUrl = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = blobUrl;
        a.download = fileName || (contentType.includes('pdf') ? 'document.pdf' : 'document.jpg');
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setTimeout(() => URL.revokeObjectURL(blobUrl), 1000);
        return;
      }
    }
    const a = document.createElement('a');
    a.href = src;
    a.download = fileName || 'document';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  } catch (err) {
    console.error('Download error:', err);
  }
}

// Safely open in new window avoiding Chrome top-level data: navigation block
function openInNewTab(src, title = 'Document Preview') {
  if (!src) return;
  if (src.startsWith('http')) {
    window.open(src, '_blank');
    return;
  }
  const win = window.open('', '_blank');
  if (win) {
    win.document.write(`
      <!DOCTYPE html>
      <html>
        <head>
          <title>${title}</title>
          <style>
            body { margin: 0; background: #0f172a; display: flex; align-items: center; justify-content: center; min-height: 100vh; font-family: sans-serif; }
            img { max-width: 95vw; max-height: 95vh; object-fit: contain; box-shadow: 0 10px 30px rgba(0,0,0,0.5); border-radius: 8px; }
            iframe { width: 100vw; height: 100vh; border: none; }
          </style>
        </head>
        <body>
          ${src.startsWith('data:application/pdf') 
            ? `<iframe src="${src}"></iframe>` 
            : `<img src="${src}" alt="${title}" />`}
        </body>
      </html>
    `);
    win.document.close();
  }
}

export default function AdminPortalHome() {
  const [verifications, setVerifications] = useState([]);
  const [filter, setFilter] = useState('ALL');
  const [loading, setLoading] = useState(true);
  const [actionInProgress, setActionInProgress] = useState({});
  const [adminNotes, setAdminNotes] = useState({});
  const [backendUrl, setBackendUrl] = useState('');
  const [previewModal, setPreviewModal] = useState(null); // { src, title, fileName, isImage, user }

  useEffect(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('raahi_carpool_backend_url');
      if (saved) {
        setBackendUrl(saved);
      } else if (process.env.NEXT_PUBLIC_CARPOOL_API_URL) {
        setBackendUrl(process.env.NEXT_PUBLIC_CARPOOL_API_URL);
      } else if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
        setBackendUrl('http://localhost:3000');
      }
    }
  }, []);

  // Close modal on Escape key
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') setPreviewModal(null);
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  const getTargetBackend = useCallback(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('raahi_carpool_backend_url');
      if (saved) return saved.trim();
    }
    return backendUrl || process.env.NEXT_PUBLIC_CARPOOL_API_URL || '';
  }, [backendUrl]);

  const getRowTimestamp = (r) => {
    if (!r) return 0;
    const tRev = r.driver?.reviewedAt ? new Date(r.driver.reviewedAt).getTime() : 0;
    const tSub = r.driver?.submittedAt ? new Date(r.driver.submittedAt).getTime() : 0;
    const idMatch = (r.id || '').match(/_(\d{13})$/);
    const tId = idMatch ? parseInt(idMatch[1], 10) : 0;
    const tCreated = r.created_at ? new Date(r.created_at).getTime() : 0;
    const tUpdated = r.updated_at ? new Date(r.updated_at).getTime() : 0;
    return Math.max(tRev, tSub, tId, tCreated, tUpdated);
  };

  const fetchVerifications = useCallback(async () => {
    try {
      setLoading(true);
      const emailMap = new Map();

      // 1. Fetch from authoritative API route first (has local persistence + photos)
      try {
        const activeBackend = getTargetBackend();
        const headers = activeBackend ? { 'x-carpool-backend-url': activeBackend } : {};
        const res = await fetch('/api/verifications', { headers, cache: 'no-store' });
        if (res.ok) {
          const data = await res.json();
          if (data.verifications && Array.isArray(data.verifications)) {
            data.verifications.forEach((v) => {
              if (v && v.email) {
                emailMap.set(v.email.toLowerCase().trim(), v);
              }
            });
          }
        }
      } catch (e) {
        console.error('API verifications fetch error:', e);
      }

      // 2. Also merge Supabase entries with a 3s safety timeout
      try {
        const timeoutPromise = new Promise((_, reject) =>
          setTimeout(() => reject(new Error('Supabase timeout')), 3000)
        );
        const queryPromise = supabase
          .from('rides')
          .select('*')
          .ilike('status', 'VERIFICATION_%');

        const { data: rideRows } = await Promise.race([queryPromise, timeoutPromise]);

        if (rideRows && rideRows.length > 0) {
          const groups = new Map();
          rideRows.forEach((r) => {
            if (r.driver && (r.driver.type === 'DOC_VERIFICATION' || r.driver.email)) {
              const userEmail = (r.driver.email || '').toLowerCase().trim();
              if (userEmail) {
                if (!groups.has(userEmail)) groups.set(userEmail, []);
                groups.get(userEmail).push(r);
              }
            }
          });

          groups.forEach((userRows, userEmail) => {
            userRows.sort((a, b) => getRowTimestamp(b) - getRowTimestamp(a));
            const latest = userRows[0];
            const photoRow = userRows.find(
              (r) => r.driver?.idProofBase64 || r.driver?.drivingLicenseBase64
            ) || latest;

            const existing = emailMap.get(userEmail);
            const status = latest.status === 'VERIFICATION_APPROVED' ? 'APPROVED'
              : latest.status === 'VERIFICATION_REJECTED' ? 'REJECTED'
              : (latest.driver?.status || existing?.status || 'PENDING');

            emailMap.set(userEmail, {
              ...(existing || {}),
              ...photoRow.driver,
              ...latest.driver,
              id: latest.driver?.id || latest.id || existing?.id,
              status,
              rowId: latest.id,
              idProofBase64: existing?.idProofBase64 || photoRow.driver?.idProofBase64 || latest.driver?.idProofBase64 || '',
              idProofName: existing?.idProofName || photoRow.driver?.idProofName || latest.driver?.idProofName || 'Identity Document',
              drivingLicenseBase64: existing?.drivingLicenseBase64 || photoRow.driver?.drivingLicenseBase64 || latest.driver?.drivingLicenseBase64 || '',
              drivingLicenseName: existing?.drivingLicenseName || photoRow.driver?.drivingLicenseName || latest.driver?.drivingLicenseName || 'Driving License',
              submittedAt: latest.driver?.submittedAt || photoRow.driver?.submittedAt || existing?.submittedAt || new Date(getRowTimestamp(photoRow)).toISOString(),
              reviewedAt: latest.driver?.reviewedAt || existing?.reviewedAt || (status !== 'PENDING' ? new Date(getRowTimestamp(latest)).toISOString() : null),
              adminNotes: latest.driver?.adminNotes || existing?.adminNotes || '',
            });
          });
        }
      } catch (err) {
        // Supabase error or timeout; API data in emailMap is retained
      }

      const list = Array.from(emailMap.values());
      setVerifications(
        list.sort(
          (a, b) =>
            new Date(b.reviewedAt || b.submittedAt || 0) -
            new Date(a.reviewedAt || a.submittedAt || 0)
        )
      );
    } catch (err) {
      console.error('Failed to fetch verifications:', err);
    } finally {
      setLoading(false);
    }
  }, [getTargetBackend]);

  useEffect(() => {
    fetchVerifications();
    const interval = setInterval(fetchVerifications, 5000);
    return () => clearInterval(interval);
  }, [fetchVerifications]);

  const handleReview = async (item, action) => {
    const status = action === 'APPROVE' ? 'APPROVED' : 'REJECTED';
    const note = adminNotes[item.id] || (action === 'REJECT' ? 'Invalid documents try with Original documents' : 'Verified successfully.');
    const now = new Date();
    const reviewedAt = now.toISOString();
    const activeBackend = getTargetBackend();
    const normEmail = (item.email || '').toLowerCase().trim();
    const updateId = `doc_${normEmail.replace(/[^a-z0-9]/g, '_')}_${now.getTime()}`;

    setActionInProgress((prev) => ({ ...prev, [item.id]: true }));

    // Optimistically update UI
    setVerifications((prev) =>
      prev.map((v) =>
        (v.id === item.id || v.email?.toLowerCase().trim() === normEmail)
          ? { ...v, status, adminNotes: note, reviewedAt }
          : v
      )
    );

    try {
      const updatedDriver = {
        ...item,
        id: updateId,
        status,
        adminNotes: note,
        reviewedAt,
        idProofBase64: item.idProofBase64 || '',
        idProofName: item.idProofName || '',
        drivingLicenseBase64: item.drivingLicenseBase64 || '',
        drivingLicenseName: item.drivingLicenseName || '',
      };

      // 1. Direct write to Supabase
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
            ...updatedDriver,
          },
          created_at: item?.submittedAt || now.toISOString(),
          updated_at: reviewedAt,
        };
        await supabase.from('rides').upsert([payload], { onConflict: 'id' });
      } catch (sbErr) {
        console.error('Supabase direct review insert error:', sbErr);
      }

      // 2. Call local Admin Portal API Route
      try {
        await fetch(`/api/verifications/${encodeURIComponent(item.id)}/review`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(activeBackend ? { 'x-carpool-backend-url': activeBackend } : {}),
          },
          body: JSON.stringify({ action, adminNotes: note }),
        });
      } catch (e) {}

      // Refresh to confirm live state from database
      await fetchVerifications();
    } catch (err) {
      console.error('Error updating review:', err);
      alert('Error updating review status.');
    } finally {
      setActionInProgress((prev) => ({ ...prev, [item.id]: false }));
    }
  };

  const handleSaveBackendUrl = () => {
    if (typeof window !== 'undefined') {
      localStorage.setItem('raahi_carpool_backend_url', backendUrl.trim());
      alert(`Connected Carpool Backend set to: ${backendUrl.trim() || 'Default auto-detect'}`);
      fetchVerifications();
    }
  };

  const filteredVerifications = verifications.filter((v) => {
    if (filter === 'ALL') return true;
    return v.status === filter;
  });

  const pendingCount = verifications.filter((v) => v.status === 'PENDING').length;
  const approvedCount = verifications.filter((v) => v.status === 'APPROVED').length;
  const rejectedCount = verifications.filter((v) => v.status === 'REJECTED').length;

  return (
    <div className={styles.container}>
      {/* Top Bar */}
      <div className={styles.topBar}>
        <div className={styles.logoArea}>
          <span className={styles.logoBadge}>OFFICIAL</span>
          <span className={styles.logoTitle}>Raahi Admin Verification Portal</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
          <Lock size={14} color="#10b981" />
          <span>Independent Verification System</span>
        </div>
      </div>

      {/* Backend API Configuration */}
      <div className={styles.backendConfigBox}>
        <div className={styles.configLabel}>
          <Globe size={16} color="#0284c7" />
          <span>Connected Carpool Backend Server URL:</span>
        </div>
        <div className={styles.configInputArea}>
          <input
            type="text"
            className={styles.configInput}
            value={backendUrl}
            onChange={(e) => setBackendUrl(e.target.value)}
            placeholder="e.g. http://localhost:3000"
          />
          <button type="button" className={styles.configSaveBtn} onClick={handleSaveBackendUrl}>
            Save
          </button>
        </div>
      </div>

      {/* Header */}
      <div className={styles.header}>
        <div className={styles.titleArea}>
          <h1>
            <ShieldCheck size={28} color="#10b981" /> Identity & License Verification
          </h1>
          <p className={styles.subtitle}>
            Approve or reject user driver verifications. Review uploaded Aadhaar Cards & Driving Licenses with authentic document validation.
          </p>
        </div>
        <div className={styles.headerActions}>
          <button className={styles.refreshBtn} onClick={fetchVerifications} disabled={loading}>
            <RefreshCw size={16} className={loading ? 'spin' : ''} /> Refresh
          </button>
        </div>
      </div>

      {/* Stats Bar */}
      <div className={styles.statsBar}>
        <div className={styles.statCard}>
          <span className={styles.statLabel}>Total Submissions</span>
          <span className={styles.statNumber}>{verifications.length}</span>
        </div>
        <div className={styles.statCard}>
          <span className={styles.statLabel}>Awaiting Verification</span>
          <span className={`${styles.statNumber} ${styles.pendingStat}`}>{pendingCount}</span>
        </div>
        <div className={styles.statCard}>
          <span className={styles.statLabel}>Approved Documents</span>
          <span className={`${styles.statNumber} ${styles.approvedStat}`}>{approvedCount}</span>
        </div>
        <div className={styles.statCard}>
          <span className={styles.statLabel}>Rejected Documents</span>
          <span className={`${styles.statNumber} ${styles.rejectedStat}`}>{rejectedCount}</span>
        </div>
      </div>

      {/* Tabs */}
      <div className={styles.tabs}>
        <button
          className={`${styles.tabBtn} ${filter === 'ALL' ? styles.activeTab : ''}`}
          onClick={() => setFilter('ALL')}
        >
          All Submissions ({verifications.length})
        </button>
        <button
          className={`${styles.tabBtn} ${filter === 'PENDING' ? styles.activeTab : ''}`}
          onClick={() => setFilter('PENDING')}
        >
          Pending Review ({pendingCount})
        </button>
        <button
          className={`${styles.tabBtn} ${filter === 'APPROVED' ? styles.activeTab : ''}`}
          onClick={() => setFilter('APPROVED')}
        >
          Approved ({approvedCount})
        </button>
        <button
          className={`${styles.tabBtn} ${filter === 'REJECTED' ? styles.activeTab : ''}`}
          onClick={() => setFilter('REJECTED')}
        >
          Rejected ({rejectedCount})
        </button>
      </div>

      {/* List */}
      {filteredVerifications.length === 0 ? (
        <div className={styles.emptyState}>
          <h3>No records found</h3>
          <p>
            {filter === 'ALL'
              ? 'No users have submitted documents yet.'
              : `No submissions with status ${filter}.`}
          </p>
        </div>
      ) : (
        <div className={styles.cardsGrid}>
          {filteredVerifications.map((item) => {
            const isWorking = actionInProgress[item.id];
            const aadharSrc = formatDocSrc(item.idProofBase64);
            const aadharIsImg = isImageDoc(aadharSrc, item.idProofName);
            const licenseSrc = formatDocSrc(item.drivingLicenseBase64);
            const licenseIsImg = isImageDoc(licenseSrc, item.drivingLicenseName);

            return (
              <div key={item.id} className={styles.verifCard}>
                <div className={styles.cardTop}>
                  <div className={styles.userMeta}>
                    <h2>{item.fullName || 'User Document Verification'}</h2>
                    <div className={styles.metaRow}>
                      <span>
                        <Mail size={15} /> {item.email}
                      </span>
                      {item.phone && (
                        <span>
                          <Phone size={15} /> {item.phone}
                        </span>
                      )}
                      <span>
                        <Calendar size={15} />{' '}
                        {new Date(item.submittedAt || Date.now()).toLocaleDateString()}{' '}
                        {new Date(item.submittedAt || Date.now()).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </span>
                    </div>
                  </div>

                  <div>
                    {item.status === 'PENDING' && (
                      <span className={`${styles.badge} ${styles.badgePending}`}>
                        <Clock size={14} /> Pending Review
                      </span>
                    )}
                    {item.status === 'APPROVED' && (
                      <span className={`${styles.badge} ${styles.badgeApproved}`}>
                        <CheckCircle size={14} /> Verified & Allowed
                      </span>
                    )}
                    {item.status === 'REJECTED' && (
                      <span className={`${styles.badge} ${styles.badgeRejected}`}>
                        <XCircle size={14} /> Invalid / Rejected
                      </span>
                    )}
                  </div>
                </div>

                {/* Document Scans Grid */}
                <div className={styles.docsSection}>
                  {/* Aadhaar */}
                  <div className={styles.docColumn}>
                    <div className={styles.docHeader}>
                      <FileText size={18} color="#0284c7" />
                      <span>Aadhaar / Identity Proof Document</span>
                    </div>
                    <div
                      className={styles.previewBox}
                      onClick={() => {
                        if (aadharSrc) {
                          setPreviewModal({
                            src: aadharSrc,
                            title: `Aadhaar / ID Document - ${item.fullName || item.email}`,
                            fileName: item.idProofName || 'aadhaar_card.jpg',
                            isImage: aadharIsImg,
                            user: item.fullName,
                          });
                        }
                      }}
                    >
                      {aadharSrc && aadharIsImg ? (
                        <>
                          <img
                            src={aadharSrc}
                            alt="Aadhaar ID Proof"
                            className={styles.docImage}
                          />
                          <div className={styles.previewOverlay}>
                            <Eye size={18} /> Click to Inspect Photo
                          </div>
                        </>
                      ) : aadharSrc ? (
                        <div className={styles.pdfFallback}>
                          <FileText size={42} color="#0284c7" />
                          <span style={{ fontWeight: 600, color: 'var(--text-primary)' }}>PDF Document</span>
                          <span style={{ fontSize: '0.8rem', color: 'var(--primary-500)' }}>
                            Click to view PDF
                          </span>
                        </div>
                      ) : (
                        <div className={styles.pdfFallback}>
                          <FileText size={36} color="#94a3b8" />
                          <span style={{ color: 'var(--text-tertiary)', fontSize: '0.85rem' }}>No document uploaded</span>
                        </div>
                      )}
                    </div>
                    <div className={styles.docFooterRow}>
                      <span className={styles.docFooter}>{item.idProofName || 'Identity Document'}</span>
                      {aadharSrc && (
                        <div className={styles.docActions}>
                          <button
                            type="button"
                            className={styles.inspectBtn}
                            onClick={() =>
                              setPreviewModal({
                                src: aadharSrc,
                                title: `Aadhaar / ID Document - ${item.fullName || item.email}`,
                                fileName: item.idProofName || 'aadhaar_card.jpg',
                                isImage: aadharIsImg,
                                user: item.fullName,
                              })
                            }
                          >
                            <Maximize2 size={13} /> Inspect
                          </button>
                          <button
                            type="button"
                            className={styles.downloadBtn}
                            onClick={() => downloadDocument(aadharSrc, item.idProofName || 'aadhaar_card.jpg')}
                            title="Download original file"
                          >
                            <Download size={13} /> Download
                          </button>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Driving License */}
                  <div className={styles.docColumn}>
                    <div className={styles.docHeader}>
                      <FileText size={18} color="#10b981" />
                      <span>Driving License Document</span>
                    </div>
                    <div
                      className={styles.previewBox}
                      onClick={() => {
                        if (licenseSrc) {
                          setPreviewModal({
                            src: licenseSrc,
                            title: `Driving License - ${item.fullName || item.email}`,
                            fileName: item.drivingLicenseName || 'driving_license.jpg',
                            isImage: licenseIsImg,
                            user: item.fullName,
                          });
                        }
                      }}
                    >
                      {licenseSrc && licenseIsImg ? (
                        <>
                          <img
                            src={licenseSrc}
                            alt="Driving License"
                            className={styles.docImage}
                          />
                          <div className={styles.previewOverlay}>
                            <Eye size={18} /> Click to Inspect Photo
                          </div>
                        </>
                      ) : licenseSrc ? (
                        <div className={styles.pdfFallback}>
                          <FileText size={42} color="#10b981" />
                          <span style={{ fontWeight: 600, color: 'var(--text-primary)' }}>PDF Document</span>
                          <span style={{ fontSize: '0.8rem', color: 'var(--primary-500)' }}>
                            Click to view PDF
                          </span>
                        </div>
                      ) : (
                        <div className={styles.pdfFallback}>
                          <FileText size={36} color="#94a3b8" />
                          <span style={{ color: 'var(--text-tertiary)', fontSize: '0.85rem' }}>No document uploaded</span>
                        </div>
                      )}
                    </div>
                    <div className={styles.docFooterRow}>
                      <span className={styles.docFooter}>{item.drivingLicenseName || 'Driving License'}</span>
                      {licenseSrc && (
                        <div className={styles.docActions}>
                          <button
                            type="button"
                            className={styles.inspectBtn}
                            onClick={() =>
                              setPreviewModal({
                                src: licenseSrc,
                                title: `Driving License - ${item.fullName || item.email}`,
                                fileName: item.drivingLicenseName || 'driving_license.jpg',
                                isImage: licenseIsImg,
                                user: item.fullName,
                              })
                            }
                          >
                            <Maximize2 size={13} /> Inspect
                          </button>
                          <button
                            type="button"
                            className={styles.downloadBtn}
                            onClick={() => downloadDocument(licenseSrc, item.drivingLicenseName || 'driving_license.jpg')}
                            title="Download original file"
                          >
                            <Download size={13} /> Download
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                </div>

                {/* Feedback / Admin Notes display if reviewed */}
                {item.adminNotes && (
                  <div className={styles.reviewFeedback}>
                    <div className={styles.feedbackTitle}>Backend Verification Remarks:</div>
                    <div>{item.adminNotes}</div>
                  </div>
                )}

                {/* Action Area */}
                <div className={styles.actionArea}>
                  <input
                    type="text"
                    placeholder="Remarks (e.g. 'Invalid documents try with Original documents' or 'Verified & approved')"
                    className={styles.notesInput}
                    value={adminNotes[item.id] !== undefined ? adminNotes[item.id] : ''}
                    onChange={(e) =>
                      setAdminNotes((prev) => ({ ...prev, [item.id]: e.target.value }))
                    }
                    disabled={isWorking}
                  />

                  <button
                    type="button"
                    className={`${styles.rejectBtn} ${isWorking ? styles.btnDisabled : ''}`}
                    onClick={() => handleReview(item, 'REJECT')}
                    disabled={isWorking}
                  >
                    <XCircle size={16} /> Reject (Invalid Document)
                  </button>

                  <button
                    type="button"
                    className={`${styles.approveBtn} ${isWorking ? styles.btnDisabled : ''}`}
                    onClick={() => handleReview(item, 'APPROVE')}
                    disabled={isWorking}
                  >
                    <CheckCircle size={16} /> Allow & Verify Document
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Document Lightbox / Fullscreen Modal */}
      {previewModal && (
        <div className={styles.modalBackdrop} onClick={() => setPreviewModal(null)}>
          <div className={styles.modalContainer} onClick={(e) => e.stopPropagation()}>
            <div className={styles.modalHeader}>
              <div className={styles.modalHeaderInfo}>
                <h3>
                  <FileText size={20} color="#10b981" /> {previewModal.title}
                </h3>
                <p>Original filename: {previewModal.fileName}</p>
              </div>
              <button
                type="button"
                className={styles.modalCloseBtn}
                onClick={() => setPreviewModal(null)}
                aria-label="Close Preview"
              >
                <X size={20} />
              </button>
            </div>

            <div className={styles.modalBody}>
              {previewModal.isImage ? (
                <img
                  src={previewModal.src}
                  alt={previewModal.title}
                  className={styles.modalImage}
                />
              ) : (
                <iframe
                  src={previewModal.src}
                  title={previewModal.title}
                  className={styles.modalIframe}
                />
              )}
            </div>

            <div className={styles.modalFooter}>
              <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
                Press <kbd style={{ background: 'var(--bg-hover)', padding: '2px 6px', borderRadius: '4px', border: '1px solid var(--border-color)' }}>Esc</kbd> or click background to exit
              </div>
              <div className={styles.modalFooterActions}>
                <button
                  type="button"
                  className={styles.inspectBtn}
                  onClick={() => openInNewTab(previewModal.src, previewModal.title)}
                >
                  <ExternalLink size={14} /> Open in New Tab
                </button>
                <button
                  type="button"
                  className={styles.approveBtn}
                  onClick={() => downloadDocument(previewModal.src, previewModal.fileName)}
                >
                  <Download size={15} /> Download Document
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
