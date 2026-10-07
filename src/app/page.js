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
} from 'lucide-react';
import styles from './admin.module.css';

export default function AdminPortalHome() {
  const [verifications, setVerifications] = useState([]);
  const [filter, setFilter] = useState('ALL');
  const [loading, setLoading] = useState(true);
  const [actionInProgress, setActionInProgress] = useState({});
  const [adminNotes, setAdminNotes] = useState({});

  const fetchVerifications = useCallback(async () => {
    try {
      setLoading(true);
      const emailMap = new Map();

      // 1. Try dedicated table first if available
      try {
        const { data: dedicated } = await supabase
          .from('verifications')
          .select('*')
          .order('submittedAt', { ascending: false });
        if (dedicated && dedicated.length > 0) {
          setVerifications(dedicated);
          setLoading(false);
          return;
        }
      } catch (err) {}

      // 2. Fetch directly from Supabase rides storage
      const { data: rows, error } = await supabase
        .from('rides')
        .select('*')
        .ilike('status', 'VERIFICATION_%')
        .order('id', { ascending: false });

      if (rows && rows.length > 0) {
        rows.forEach((r) => {
          if (r.driver && r.driver.type === 'DOC_VERIFICATION' && r.driver.email) {
            const userEmail = r.driver.email.toLowerCase();
            if (!emailMap.has(userEmail)) {
              emailMap.set(userEmail, r.driver);
            }
          }
        });
      }

      const list = Array.from(emailMap.values());
      setVerifications(list.sort((a, b) => new Date(b.submittedAt) - new Date(a.submittedAt)));
    } catch (err) {
      console.error('Failed to fetch from Supabase:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchVerifications();
  }, [fetchVerifications]);

  const handleReview = async (item, action) => {
    const status = action === 'APPROVE' ? 'APPROVED' : 'REJECTED';
    const note = adminNotes[item.id] || (action === 'REJECT' ? 'Invalid documents try with Original documents' : 'Verified successfully.');
    const reviewedAt = new Date().toISOString();

    setActionInProgress((prev) => ({ ...prev, [item.id]: true }));

    try {
      const normEmail = item.email.toLowerCase();
      const updateId = `doc_${normEmail.replace(/[^a-z0-9]/g, '_')}_${Date.now()}`;

      const updatedDriver = {
        ...item,
        status,
        adminNotes: note,
        reviewedAt,
      };

      // 1. Insert update into Supabase rides audit store
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

      // 2. Also update dedicated verifications table if present
      try {
        await supabase
          .from('verifications')
          .update({
            status,
            adminNotes: note,
            reviewedAt,
          })
          .eq('email', normEmail);
      } catch (e) {}

      await fetchVerifications();
    } catch (err) {
      console.error('Error reviewing in Supabase:', err);
      alert('Error updating status: ' + err.message);
    } finally {
      setActionInProgress((prev) => ({ ...prev, [item.id]: false }));
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
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: 'var(--text-secondary)', fontSize: '0.85rem' }}>
          <Lock size={14} color="#10b981" /> Supabase Connected
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
