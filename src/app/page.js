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
} from 'lucide-react';
import styles from './admin.module.css';

export default function AdminPortalHome() {
  const [verifications, setVerifications] = useState([]);
  const [filter, setFilter] = useState('ALL');
  const [loading, setLoading] = useState(true);
  const [actionInProgress, setActionInProgress] = useState({});
  const [adminNotes, setAdminNotes] = useState({});
  const [backendUrl, setBackendUrl] = useState('');

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

  const getTargetBackend = useCallback(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('raahi_carpool_backend_url');
      if (saved) return saved.trim();
    }
    return backendUrl || process.env.NEXT_PUBLIC_CARPOOL_API_URL || '';
  }, [backendUrl]);

  const fetchVerifications = useCallback(async () => {
    try {
      setLoading(true);
      const emailMap = new Map();

      // 1. DIRECT QUERY TO SUPABASE CLOUD DATABASE
      try {
        const { data: rideRows, error: sbError } = await supabase
          .from('rides')
          .select('*')
          .ilike('status', 'VERIFICATION_%');

        if (rideRows && rideRows.length > 0) {
          const sortedRows = rideRows.sort((a, b) => {
            const timeA = new Date(a.driver?.submittedAt || a.driver?.reviewedAt || 0).getTime();
            const timeB = new Date(b.driver?.submittedAt || b.driver?.reviewedAt || 0).getTime();
            return timeB - timeA;
          });

          sortedRows.forEach((r) => {
            if (r.driver && (r.driver.type === 'DOC_VERIFICATION' || r.driver.email)) {
              const userEmail = (r.driver.email || '').toLowerCase().trim();
              if (userEmail && !emailMap.has(userEmail)) {
                const status = r.status === 'VERIFICATION_APPROVED' ? 'APPROVED'
                  : r.status === 'VERIFICATION_REJECTED' ? 'REJECTED'
                  : (r.driver.status || 'PENDING');
                emailMap.set(userEmail, {
                  ...r.driver,
                  id: r.driver.id || r.id,
                  status,
                  rowId: r.id,
                });
              }
            }
          });
        }
      } catch (err) {
        console.error('Supabase direct fetch error:', err);
      }

      // 2. Also merge from API route if available
      try {
        const activeBackend = getTargetBackend();
        const headers = activeBackend ? { 'x-carpool-backend-url': activeBackend } : {};
        const res = await fetch('/api/verifications', { headers, cache: 'no-store' });
        if (res.ok) {
          const data = await res.json();
          if (data.verifications && Array.isArray(data.verifications)) {
            data.verifications.forEach((v) => {
              if (v && v.email && !emailMap.has(v.email.toLowerCase())) {
                emailMap.set(v.email.toLowerCase(), v);
              }
            });
          }
        }
      } catch (e) {}

      const list = Array.from(emailMap.values());
      setVerifications(list.sort((a, b) => new Date(b.submittedAt || 0) - new Date(a.submittedAt || 0)));
    } catch (err) {
      console.error('Failed to fetch verifications:', err);
    } finally {
      setLoading(false);
    }
  }, [getTargetBackend]);

  useEffect(() => {
    fetchVerifications();
    // Auto-refresh periodically every 5 seconds to catch new user uploads live
    const interval = setInterval(fetchVerifications, 5000);
    return () => clearInterval(interval);
  }, [fetchVerifications]);

  const handleReview = async (item, action) => {
    const status = action === 'APPROVE' ? 'APPROVED' : 'REJECTED';
    const note = adminNotes[item.id] || (action === 'REJECT' ? 'Invalid documents try with Original documents' : 'Verified successfully.');
    const reviewedAt = new Date().toISOString();
    const activeBackend = getTargetBackend();

    setActionInProgress((prev) => ({ ...prev, [item.id]: true }));

    // Optimistically update UI
    setVerifications((prev) =>
      prev.map((v) =>
        v.id === item.id || v.email === item.email
          ? { ...v, status, adminNotes: note, reviewedAt }
          : v
      )
    );

    try {
      const normEmail = item.email.toLowerCase();
      const updateId = `doc_${normEmail.replace(/[^a-z0-9]/g, '_')}_${Date.now()}`;
      const updatedDriver = {
        ...item,
        status,
        adminNotes: note,
        reviewedAt,
      };

      // 1. Direct write to Supabase cloud database
      try {
        await supabase.from('rides').insert([
          {
            id: updateId,
            driver: {
              type: 'DOC_VERIFICATION',
              ...updatedDriver,
            },
            status: action === 'APPROVE' ? 'VERIFICATION_APPROVED' : 'VERIFICATION_REJECTED',
          },
        ]);
      } catch (sbErr) {
        console.error('Supabase direct review insert error:', sbErr);
      }

      // 2. Also notify admin portal review API & backend if connected
      try {
        const headers = {
          'Content-Type': 'application/json',
          ...(activeBackend ? { 'x-carpool-backend-url': activeBackend } : {}),
        };
        await fetch(`/api/verifications/${encodeURIComponent(item.id)}/review`, {
          method: 'POST',
          headers,
          body: JSON.stringify({ action, adminNotes: note }),
        });
      } catch (e) {}

      await fetchVerifications();
    } catch (err) {
      console.error('Error reviewing in admin portal:', err);
      alert('Error updating status: ' + err.message);
    } finally {
      setActionInProgress((prev) => ({ ...prev, [item.id]: false }));
    }
  };

  const handleConfigureBackend = () => {
    const current = localStorage.getItem('raahi_carpool_backend_url') || backendUrl || '';
    const entered = window.prompt(
      'Enter your deployed Carpool App URL (e.g. https://your-carpool-app.vercel.app):',
      current
    );
    if (entered !== null) {
      const cleaned = entered.trim();
      localStorage.setItem('raahi_carpool_backend_url', cleaned);
      setBackendUrl(cleaned);
      setTimeout(fetchVerifications, 100);
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
          <ShieldCheck size={28} color="#10b981" />
          <span className={styles.logoTitle}>Raahi Admin</span>
          <span className={styles.logoBadge}>PROD PORTAL</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <button
            type="button"
            onClick={handleConfigureBackend}
            style={{
              background: 'rgba(16, 185, 129, 0.1)',
              border: '1px solid rgba(16, 185, 129, 0.35)',
              color: '#10b981',
              padding: '5px 12px',
              borderRadius: '6px',
              fontSize: '0.8rem',
              fontWeight: 500,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
            }}
            title="Click to configure deployed Carpool App URL"
          >
            <Globe size={13} />
            {backendUrl ? `Backend: ${backendUrl.replace(/^https?:\/\//, '')}` : 'Connect Carpool App 🔗'}
          </button>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: 'var(--text-secondary)', fontSize: '0.85rem' }}>
            <Lock size={14} color="#10b981" /> Live Sync
          </div>
        </div>
      </div>

      <div className={styles.header}>
        <div className={styles.titleArea}>
          <h1>
            <FileText size={26} color="#10b981" /> Document Verification Portal
          </h1>
          <p className={styles.subtitle}>
            Review official Aadhaar Cards & Driving Licenses submitted by Raahi users directly in Supabase.
          </p>
        </div>
        <div>
          <button className={styles.refreshBtn} onClick={fetchVerifications} disabled={loading}>
            <RefreshCw size={16} className={loading ? 'spin' : ''} /> Refresh Records
          </button>
        </div>
      </div>

      {/* Stats Bar */}
      <div className={styles.statsBar}>
        <div className={styles.statCard}>
          <span className={styles.statLabel}>Total Submitted</span>
          <span className={styles.statNumber}>{verifications.length}</span>
        </div>
        <div className={styles.statCard}>
          <span className={styles.statLabel}>Pending Review</span>
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
          All ({verifications.length})
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
            const aadharSrc = item.idProofBase64;
            const licenseSrc = item.drivingLicenseBase64;

            return (
              <div key={item.id} className={styles.verifCard}>
                <div className={styles.cardTop}>
                  <div className={styles.userMeta}>
                    <h2>{item.fullName}</h2>
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
                        {new Date(item.submittedAt).toLocaleDateString()}{' '}
                        {new Date(item.submittedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
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
                    <div className={styles.previewBox}>
                      {aadharSrc && (aadharSrc.startsWith('data:image/') || aadharSrc.startsWith('http') || /\.(png|jpe?g|webp|gif)$/i.test(item.idProofName)) ? (
                        <img
                          src={aadharSrc.startsWith('data:') || aadharSrc.startsWith('http') ? aadharSrc : `data:image/jpeg;base64,${aadharSrc}`}
                          alt="Aadhaar ID Proof"
                          className={styles.docImage}
                          onClick={() => {
                            const src = aadharSrc.startsWith('data:') || aadharSrc.startsWith('http') ? aadharSrc : `data:image/jpeg;base64,${aadharSrc}`;
                            window.open(src, '_blank');
                          }}
                          title="Click to view full size"
                        />
                      ) : aadharSrc ? (
                        <div className={styles.pdfFallback}>
                          <FileText size={42} color="#0284c7" />
                          <span style={{ fontWeight: 600, color: 'var(--text-primary)' }}>PDF Document</span>
                          <a
                            href={aadharSrc}
                            target="_blank"
                            rel="noreferrer"
                            className={styles.viewBtn}
                          >
                            <ExternalLink size={14} /> Open & View Document
                          </a>
                        </div>
                      ) : (
                        <div className={styles.pdfFallback}>
                          <FileText size={36} color="#94a3b8" />
                          <span style={{ color: 'var(--text-tertiary)', fontSize: '0.85rem' }}>No document uploaded</span>
                        </div>
                      )}
                    </div>
                    <div className={styles.docFooterRow}>
                      <span className={styles.docFooter}>{item.idProofName}</span>
                      {aadharSrc && (
                        <a
                          href={aadharSrc.startsWith('data:') || aadharSrc.startsWith('http') ? aadharSrc : `data:image/jpeg;base64,${aadharSrc}`}
                          target="_blank"
                          rel="noreferrer"
                          className={styles.smallOpenLink}
                        >
                          <ExternalLink size={12} /> View Full
                        </a>
                      )}
                    </div>
                  </div>

                  {/* Driving License */}
                  <div className={styles.docColumn}>
                    <div className={styles.docHeader}>
                      <FileText size={18} color="#10b981" />
                      <span>Driving License Document</span>
                    </div>
                    <div className={styles.previewBox}>
                      {licenseSrc && (licenseSrc.startsWith('data:image/') || licenseSrc.startsWith('http') || /\.(png|jpe?g|webp|gif)$/i.test(item.drivingLicenseName)) ? (
                        <img
                          src={licenseSrc.startsWith('data:') || licenseSrc.startsWith('http') ? licenseSrc : `data:image/jpeg;base64,${licenseSrc}`}
                          alt="Driving License"
                          className={styles.docImage}
                          onClick={() => {
                            const src = licenseSrc.startsWith('data:') || licenseSrc.startsWith('http') ? licenseSrc : `data:image/jpeg;base64,${licenseSrc}`;
                            window.open(src, '_blank');
                          }}
                          title="Click to view full size"
                        />
                      ) : licenseSrc ? (
                        <div className={styles.pdfFallback}>
                          <FileText size={42} color="#10b981" />
                          <span style={{ fontWeight: 600, color: 'var(--text-primary)' }}>PDF Document</span>
                          <a
                            href={licenseSrc}
                            target="_blank"
                            rel="noreferrer"
                            className={styles.viewBtn}
                          >
                            <ExternalLink size={14} /> Open & View Document
                          </a>
                        </div>
                      ) : (
                        <div className={styles.pdfFallback}>
                          <FileText size={36} color="#94a3b8" />
                          <span style={{ color: 'var(--text-tertiary)', fontSize: '0.85rem' }}>No document uploaded</span>
                        </div>
                      )}
                    </div>
                    <div className={styles.docFooterRow}>
                      <span className={styles.docFooter}>{item.drivingLicenseName}</span>
                      {licenseSrc && (
                        <a
                          href={licenseSrc.startsWith('data:') || licenseSrc.startsWith('http') ? licenseSrc : `data:image/jpeg;base64,${licenseSrc}`}
                          target="_blank"
                          rel="noreferrer"
                          className={styles.smallOpenLink}
                        >
                          <ExternalLink size={12} /> View Full
                        </a>
                      )}
                    </div>
                  </div>
                </div>

                {/* Feedback remarks if reviewed */}
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
                    placeholder="Remarks (e.g., 'Invalid documents try with Original documents' or 'Clear DL verified')"
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
    </div>
  );
}
