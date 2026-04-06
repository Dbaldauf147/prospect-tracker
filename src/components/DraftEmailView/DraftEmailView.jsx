import { useState, useEffect, useRef, useMemo } from 'react';
import ReactQuill from 'react-quill-new';
import 'react-quill-new/dist/quill.snow.css';
import { secureSet, secureGet, secureClear } from '../../utils/secureStorage';
import styles from './DraftEmailView.module.css';

function TagContactPicker({ allContacts, selectedContacts, onAdd, onRemove, onBulkAdd, onBulkRemove }) {
  const [selectedTags, setSelectedTags] = useState(new Set());
  const [tagSearch, setTagSearch] = useState('');

  const allTags = useMemo(() => {
    const tags = new Set();
    try {
      const cache = JSON.parse(localStorage.getItem('hubspot-sync-cache'));
      (cache?.contacts || []).forEach(c => {
        const t = c.dans_tags || c.dan_s_tags || c.dans_tag || '';
        t.split(';').map(s => s.trim()).filter(Boolean).forEach(tag => tags.add(tag));
      });
    } catch {}
    return [...tags].sort();
  }, []);

  // Contacts matching ALL selected tags (AND logic)
  const tagContacts = useMemo(() => {
    if (selectedTags.size === 0) return [];
    try {
      const cache = JSON.parse(localStorage.getItem('hubspot-sync-cache'));
      return (cache?.contacts || []).filter(c => {
        const tags = (c.dans_tags || c.dan_s_tags || c.dans_tag || '').split(';').map(s => s.trim());
        return [...selectedTags].every(tag => tags.includes(tag)) && c.email;
      }).map(c => ({
        id: c.id,
        name: [c.firstname, c.lastname].filter(Boolean).join(' ') || c.email,
        firstName: c.firstname || '',
        lastName: c.lastname || '',
        email: c.email,
        company: c.company || '',
        title: c.jobtitle || '',
        phone: c.phone || '',
        city: c.city || '',
        state: c.state || '',
      }));
    } catch { return []; }
  }, [selectedTags]);

  function toggleTag(tag) {
    setSelectedTags(prev => {
      const next = new Set(prev);
      if (next.has(tag)) next.delete(tag); else next.add(tag);
      return next;
    });
  }

  const selectedIds = new Set(selectedContacts.map(c => c.id));
  const filteredTags = tagSearch.trim() ? allTags.filter(t => t.toLowerCase().includes(tagSearch.toLowerCase())) : allTags;
  const allTagContactsSelected = tagContacts.length > 0 && tagContacts.every(c => selectedIds.has(c.id));

  return (
    <div>
      <input
        type="text"
        value={tagSearch}
        onChange={e => setTagSearch(e.target.value)}
        placeholder="Search tags..."
        style={{ width: '100%', padding: '0.4rem 0.6rem', border: '1px solid var(--color-border)', borderRadius: '6px', fontSize: '0.78rem', fontFamily: 'inherit', marginBottom: '0.4rem' }}
      />
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.25rem', marginBottom: '0.75rem', maxHeight: '120px', overflowY: 'auto' }}>
        {filteredTags.map(tag => (
          <button
            key={tag}
            onClick={() => toggleTag(tag)}
            style={{
              padding: '0.2rem 0.5rem', borderRadius: '999px', fontSize: '0.68rem', fontWeight: 500, cursor: 'pointer', fontFamily: 'inherit', border: 'none',
              background: selectedTags.has(tag) ? '#0078D4' : '#F1F5F9',
              color: selectedTags.has(tag) ? '#fff' : '#475569',
            }}
          >
            {tag}
          </button>
        ))}
        {filteredTags.length === 0 && <span style={{ fontSize: '0.72rem', color: '#9CA3AF' }}>No tags found</span>}
      </div>

      {selectedTags.size > 0 && (
        <>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.35rem' }}>
            <span style={{ fontSize: '0.72rem', fontWeight: 600, color: 'var(--color-text-secondary)' }}>
              {[...selectedTags].join(' + ')} ({tagContacts.length})
            </span>
            <button
              onClick={() => {
                if (allTagContactsSelected) onBulkRemove(tagContacts.map(c => c.id));
                else onBulkAdd(tagContacts);
              }}
              style={{ background: 'none', border: 'none', color: '#0078D4', fontSize: '0.68rem', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}
            >
              {allTagContactsSelected ? 'Deselect All' : 'Select All'}
            </button>
          </div>
          {tagContacts.length > 0 ? (
            <div style={{ maxHeight: '300px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '0.2rem' }}>
              {tagContacts.map(c => {
                const isSelected = selectedIds.has(c.id);
                return (
                  <label key={c.id} style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', padding: '0.3rem 0.4rem', borderRadius: '4px', cursor: 'pointer', fontSize: '0.75rem', background: isSelected ? '#EFF6FF' : 'transparent' }}>
                    <input type="checkbox" checked={isSelected} onChange={() => isSelected ? onRemove(c.id) : onAdd(c)} style={{ accentColor: '#0078D4' }} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 500, color: 'var(--color-text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.name}</div>
                      <div style={{ fontSize: '0.65rem', color: '#9CA3AF', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.email}</div>
                    </div>
                  </label>
                );
              })}
            </div>
          ) : (
            <p style={{ fontSize: '0.72rem', color: '#9CA3AF', textAlign: 'center' }}>No contacts match all selected tags</p>
          )}
        </>
      )}
    </div>
  );
}

function PreviewTabs({ contacts, subject, body, personalizeForContact, draftCc }) {
  const [activeIdx, setActiveIdx] = useState(0);
  const c = contacts[activeIdx] || contacts[0];
  if (!c) return null;

  // Load To Also and CC maps
  let toAlsoMap = {}, ccMap = {};
  try { toAlsoMap = JSON.parse(localStorage.getItem('prospect-to-also-map') || '{}'); } catch {}
  try { ccMap = JSON.parse(localStorage.getItem('prospect-cc-map') || '{}'); } catch {}
  const toAlso = toAlsoMap[c.email] || [];
  const contactCc = ccMap[c.email] || [];
  const allCc = [...new Set([...contactCc, ...(draftCc || [])])];

  return (
    <div className={styles.previewSection}>
      <div className={styles.previewHeader}>
        <h4 className={styles.previewTitle}>Preview</h4>
        <div className={styles.previewTabs}>
          {contacts.map((ct, i) => (
            <button
              key={ct.id}
              className={i === activeIdx ? styles.previewTabActive : styles.previewTab}
              onClick={() => setActiveIdx(i)}
            >
              {ct.firstName || ct.name.split(' ')[0] || ct.email}
            </button>
          ))}
        </div>
      </div>
      <div className={styles.previewBox}>
        <div className={styles.previewTo}>
          <strong>To:</strong> {c.email}{toAlso.length > 0 && <>, {toAlso.join(', ')}</>}
        </div>
        {allCc.length > 0 && (
          <div className={styles.previewTo}>
            <strong>CC:</strong> {allCc.join(', ')}
          </div>
        )}
        <div className={styles.previewSubject}>{personalizeForContact(subject, c)}</div>
        <div className={styles.previewBody} dangerouslySetInnerHTML={{ __html: personalizeForContact(body, c) }} />
      </div>
    </div>
  );
}

const AUTOSAVE_KEY = 'prospect-draft-autosave';

export function DraftEmailView({ prospects }) {
  // Restore auto-saved compose state
  const [subject, setSubject] = useState(() => {
    try { return JSON.parse(localStorage.getItem(AUTOSAVE_KEY))?.subject || ''; } catch { return ''; }
  });
  const [body, setBody] = useState(() => {
    try { return JSON.parse(localStorage.getItem(AUTOSAVE_KEY))?.body || ''; } catch { return ''; }
  });
  const [selectedContacts, setSelectedContacts] = useState(() => {
    try { return JSON.parse(localStorage.getItem(AUTOSAVE_KEY))?.contacts || []; } catch { return []; }
  });
  const [contactSearch, setContactSearch] = useState('');
  const [showSearch, setShowSearch] = useState(false);
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState(null);
  const [drafts, setDrafts] = useState([]);
  const [draftQueue, setDraftQueue] = useState([]); // contacts waiting to be opened
  const [draftsSent, setDraftsSent] = useState(0);
  const [outlookConnected, setOutlookConnected] = useState(false);
  const [showInsertMenu, setShowInsertMenu] = useState(false);
  const [lastFocused, setLastFocused] = useState('body'); // 'subject' or 'body'
  const [attachments, setAttachments] = useState([]);
  const [draftCc, setDraftCc] = useState(() => {
    try { return JSON.parse(localStorage.getItem(AUTOSAVE_KEY))?.cc || []; } catch { return []; }
  });
  const [draftCcInput, setDraftCcInput] = useState('');
  const [showDraftCcSuggestions, setShowDraftCcSuggestions] = useState(false);
  const DEFAULT_SIGNATURE = '<table cellpadding="0" cellspacing="0" border="0" style="font-family: Arial, sans-serif; font-size: 7.5pt; color: #5F5F5F; line-height: 1.5;"><tbody><tr><td style="vertical-align: top;"><table cellpadding="0" cellspacing="0" border="0" style="font-family: Arial, sans-serif; font-size: 7.5pt; color: #5F5F5F;"><tbody><tr><td colspan="3" style="font-family: Arial, sans-serif; padding-bottom: 2px;"><strong style="color: #82C168; font-size: 10pt; font-family: Arial, sans-serif;">Dan Baldauf</strong></td></tr><tr><td style="vertical-align: top; padding-right: 24px; font-family: Arial, sans-serif;">Senior Manager<br>Schneider Electric Advisory<br>Services</td><td style="vertical-align: top; padding-right: 24px; white-space: nowrap; font-family: Arial, sans-serif;">C&nbsp; +1 (917) 787 1701<br>E&nbsp; <a href="mailto:daniel.baldauf@se.com" style="color: #0000EE; text-decoration: underline; font-size: 7.5pt; font-family: Arial, sans-serif;">daniel.baldauf@se.com</a></td><td style="vertical-align: top; white-space: nowrap; text-align: right; font-family: Arial, sans-serif;">1216 Broadway<br>New York, NY<br>10001 USA</td></tr><tr><td colspan="3" style="padding-top: 8px; font-family: Arial, sans-serif; font-size: 9pt;">Here is a <a href="https://outlook.office.com/bookwithme/user/466302b21b9e46f08ce1a412c14e5573%40se.com/meetingtype/SVRwCe7HMUGxuT6WGxi68g2?anonymous&amp;ismsaljsauthenabled" style="color: #0000EE; text-decoration: underline; font-size: 9pt; font-family: Arial, sans-serif;">link</a> to schedule a meeting on my calendar</td></tr></tbody></table></td></tr></tbody></table>';
  const [signature, setSignature] = useState(() => localStorage.getItem('prospect-email-signature') || DEFAULT_SIGNATURE);
  const [showSignatureEditor, setShowSignatureEditor] = useState(false);
  const draftCcRef = useRef(null);
  const fileInputRef = useRef(null);
  const searchRef = useRef(null);
  const insertRef = useRef(null);
  const subjectRef = useRef(null);
  const bodyRef = useRef(null);

  // Auto-save compose state so it's never lost
  useEffect(() => {
    const timer = setTimeout(() => {
      localStorage.setItem(AUTOSAVE_KEY, JSON.stringify({ subject, body, contacts: selectedContacts, cc: draftCc }));
    }, 500);
    return () => clearTimeout(timer);
  }, [subject, body, selectedContacts, draftCc]);

  // Load HubSpot contacts from cache
  const [allContacts, setAllContacts] = useState([]);
  useEffect(() => {
    try {
      const cache = JSON.parse(localStorage.getItem('hubspot-sync-cache'));
      if (cache?.contacts) {
        setAllContacts(cache.contacts.filter(c => c.email).map(c => ({
          id: c.id,
          name: [c.firstname, c.lastname].filter(Boolean).join(' ') || c.email,
          firstName: c.firstname || '',
          lastName: c.lastname || '',
          email: c.email,
          company: c.company || '',
          title: c.jobtitle || '',
          phone: c.phone || '',
          city: c.city || '',
          state: c.state || '',
          linkedinUrl: c.hs_linkedin_url || c.linkedin_url || '',
        })));
      }
    } catch {}
  }, []);

  // Load saved drafts from localStorage
  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem('prospect-email-drafts') || '[]');
      setDrafts(saved);
    } catch {}
  }, []);

  // Check if Outlook is connected (encrypted token storage)
  useEffect(() => {
    (async () => {
      const token = await secureGet('outlook-access-token');
      const expiry = await secureGet('outlook-token-expiry');
      setOutlookConnected(!!token && (!expiry || Date.now() < Number(expiry)));
    })();
  }, []);

  // Listen for OAuth callback
  useEffect(() => {
    function handleMessage(e) {
      if (e.data?.type === 'outlook-auth-success') {
        (async () => {
          await secureSet('outlook-access-token', e.data.accessToken);
          if (e.data.refreshToken) await secureSet('outlook-refresh-token', e.data.refreshToken);
          await secureSet('outlook-token-expiry', String(Date.now() + (e.data.expiresIn || 3600) * 1000));
          setOutlookConnected(true);
          setResult({ type: 'success', message: 'Outlook connected!' });
        })();
      } else if (e.data?.type === 'outlook-auth-error') {
        setResult({ type: 'error', message: 'Outlook connection failed: ' + e.data.error });
      }
    }
    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, []);

  function connectOutlook() {
    window.open('/api/outlook-auth', 'outlook-auth', 'width=500,height=700,left=200,top=100');
  }

  function disconnectOutlook() {
    secureClear('outlook-access-token');
    secureClear('outlook-refresh-token');
    secureClear('outlook-token-expiry');
    setOutlookConnected(false);
  }

  // Close search dropdown on outside click
  useEffect(() => {
    if (!showSearch) return;
    const h = (e) => { if (searchRef.current && !searchRef.current.contains(e.target)) setShowSearch(false); };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [showSearch]);

  // Close insert menu on outside click
  useEffect(() => {
    if (!showInsertMenu) return;
    const h = (e) => { if (insertRef.current && !insertRef.current.contains(e.target)) setShowInsertMenu(false); };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [showInsertMenu]);

  useEffect(() => {
    if (!showDraftCcSuggestions) return;
    const h = (e) => { if (draftCcRef.current && !draftCcRef.current.contains(e.target)) setShowDraftCcSuggestions(false); };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [showDraftCcSuggestions]);

  const draftCcSuggestions = draftCcInput.trim()
    ? allContacts.filter(c => !draftCc.includes(c.email) && (c.email.toLowerCase().includes(draftCcInput.toLowerCase()) || c.name.toLowerCase().includes(draftCcInput.toLowerCase()))).slice(0, 6)
    : [];

  const INSERT_VARIABLES = [
    { token: '{firstName}', label: 'First Name', example: 'John' },
    { token: '{lastName}', label: 'Last Name', example: 'Smith' },
    { token: '{fullName}', label: 'Full Name', example: 'John Smith' },
    { token: '{email}', label: 'Email', example: 'john@company.com' },
    { token: '{company}', label: 'Company', example: 'Acme Corp' },
    { token: '{title}', label: 'Job Title', example: 'VP of Sales' },
    { token: '{phone}', label: 'Phone', example: '555-0100' },
    { token: '{city}', label: 'City', example: 'Denver' },
    { token: '{state}', label: 'State', example: 'CO' },
  ];

  function insertVariable(token) {
    if (lastFocused === 'subject') {
      const ref = subjectRef.current;
      if (ref) {
        const start = ref.selectionStart || subject.length;
        const end = ref.selectionEnd || subject.length;
        setSubject(subject.slice(0, start) + token + subject.slice(end));
        setShowInsertMenu(false);
        setTimeout(() => { ref.focus(); ref.selectionStart = ref.selectionEnd = start + token.length; }, 0);
      } else {
        setSubject(prev => prev + token);
        setShowInsertMenu(false);
      }
    } else {
      // Insert into Quill editor
      const quill = bodyRef.current?.getEditor?.();
      if (quill) {
        const range = quill.getSelection();
        const idx = range ? range.index : quill.getLength();
        quill.insertText(idx, token);
        quill.setSelection(idx + token.length);
      } else {
        setBody(prev => prev + token);
      }
      setShowInsertMenu(false);
    }
  }

  const filteredContacts = contactSearch.trim()
    ? allContacts.filter(c =>
        !selectedContacts.some(s => s.id === c.id) &&
        (c.name.toLowerCase().includes(contactSearch.toLowerCase()) ||
         c.email.toLowerCase().includes(contactSearch.toLowerCase()) ||
         c.company.toLowerCase().includes(contactSearch.toLowerCase()))
      ).slice(0, 10)
    : [];

  function addContact(contact) {
    setSelectedContacts(prev => [...prev, contact]);
    setContactSearch('');
    setShowSearch(false);
  }

  function removeContact(id) {
    setSelectedContacts(prev => prev.filter(c => c.id !== id));
  }

  function saveDraft() {
    // Quill wraps empty content in <p><br></p> — check for actual content
    const bodyText = body.replace(/<[^>]*>/g, '').trim();
    if (!subject.trim() && !bodyText) return;
    const draft = {
      id: Date.now().toString(),
      subject: subject.trim(),
      body,
      contacts: selectedContacts,
      cc: draftCc,
      createdAt: new Date().toISOString(),
    };
    const updated = [draft, ...drafts];
    setDrafts(updated);
    localStorage.setItem('prospect-email-drafts', JSON.stringify(updated));
    setResult({ type: 'success', message: 'Draft saved locally' });
    setTimeout(() => setResult(null), 3000);
  }

  function loadDraft(draft) {
    setSubject(draft.subject || '');
    setBody(draft.body || '');
    setSelectedContacts(draft.contacts || []);
    setDraftCc(draft.cc || []);
  }

  function deleteDraft(id) {
    const updated = drafts.filter(d => d.id !== id);
    setDrafts(updated);
    localStorage.setItem('prospect-email-drafts', JSON.stringify(updated));
  }

  async function createOutlookDrafts() {
    if (selectedContacts.length === 0) {
      setResult({ type: 'error', message: 'Add at least one contact' });
      return;
    }
    if (!subject.trim()) {
      setResult({ type: 'error', message: 'Add a subject line' });
      return;
    }

    const accessToken = await secureGet('outlook-access-token');
    if (!accessToken) {
      setResult({ type: 'info', message: 'Connect your Outlook account first' });
      setOutlookConnected(false);
      return;
    }

    setSending(true);
    setResult(null);

    // Load CC and To Also mappings
    let ccMap = {};
    let toAlsoMap = {};
    try { ccMap = JSON.parse(localStorage.getItem('prospect-cc-map') || '{}'); } catch {}
    try { toAlsoMap = JSON.parse(localStorage.getItem('prospect-to-also-map') || '{}'); } catch {}

    // Build personalized drafts for each contact
    const drafts = selectedContacts.map(c => {
      const pBodyHtml = personalizeForContact(body, c);
      const pSubject = personalizeForContact(subject, c);
      const contactCc = ccMap[c.email] || [];
      const allCc = [...new Set([...contactCc, ...draftCc])];
      const toAlso = toAlsoMap[c.email] || [];
      const allTo = [c.email, ...toAlso].join(';');
      return { to: allTo, name: c.name, subject: pSubject, body: pBodyHtml, cc: allCc };
    });

    try {
      const res = await fetch('/api/outlook-draft', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accessToken, drafts }),
      });
      const data = await res.json();
      if (data.success) {
        setResult({ type: 'success', message: `${data.created} draft${data.created !== 1 ? 's' : ''} created in Outlook!` });
        saveDraft();
      } else if (data.needsAuth) {
        setResult({ type: 'info', message: 'Connect your Outlook account first' });
        setOutlookConnected(false);
      } else {
        setResult({ type: 'error', message: data.error || 'Failed to create drafts' });
      }
    } catch (err) {
      setResult({ type: 'error', message: err.message });
    }
    setSending(false);
  }

  function htmlToPlainText(html) {
    return html
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/p>\s*<p[^>]*>/gi, '\n\n')
      .replace(/<\/li>\s*/gi, '\n')
      .replace(/<li[^>]*>/gi, '• ')
      .replace(/<\/?(ol|ul)[^>]*>/gi, '\n')
      .replace(/<\/?(strong|b)[^>]*>/gi, '')
      .replace(/<\/?(em|i)[^>]*>/gi, '')
      .replace(/<\/?(u)[^>]*>/gi, '')
      .replace(/<\/?(s|strike|del)[^>]*>/gi, '')
      .replace(/<a[^>]*href="([^"]*)"[^>]*>[^<]*<\/a>/gi, '$1')
      .replace(/<[^>]+>/g, '')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  function personalizeForContact(text, c) {
    let toAlsoMap = {};
    try { toAlsoMap = JSON.parse(localStorage.getItem('prospect-to-also-map') || '{}'); } catch {}
    const hasToAlso = (toAlsoMap[c.email] || []).length > 0;
    return text
      .replace(/\{firstName\}/gi, hasToAlso ? 'Team' : (c.firstName || c.name.split(' ')[0] || ''))
      .replace(/\{lastName\}/gi, hasToAlso ? '' : (c.lastName || ''))
      .replace(/\{fullName\}/gi, hasToAlso ? 'Team' : (c.name || ''))
      .replace(/\{email\}/gi, c.email || '')
      .replace(/\{company\}/gi, c.company || '')
      .replace(/\{title\}/gi, c.title || '')
      .replace(/\{phone\}/gi, c.phone || '')
      .replace(/\{city\}/gi, c.city || '')
      .replace(/\{state\}/gi, c.state || '');
  }

  function openDraftForContact(c) {
    const personalBodyHtml = personalizeForContact(body, c);
    const styledHtml = buildStyledHtml(personalBodyHtml);
    const personalBodyPlain = htmlToPlainText(personalBodyHtml);
    const personalSubject = personalizeForContact(subject, c);
    let trimmedBody = personalBodyPlain;
    const baseUrl = `https://outlook.office.com/mail/deeplink/compose?to=${encodeURIComponent(c.email)}&subject=${encodeURIComponent(personalSubject)}&body=`;
    if (baseUrl.length + encodeURIComponent(personalBodyPlain).length > 1900) {
      trimmedBody = personalBodyPlain.slice(0, 800) + '\n\n[Paste full message from clipboard: Ctrl+A then Ctrl+V]';
    }
    // Copy formatted HTML to clipboard so user can paste with Ctrl+V in Outlook
    try {
      const htmlBlob = new Blob([styledHtml], { type: 'text/html' });
      const textBlob = new Blob([personalBodyPlain], { type: 'text/plain' });
      navigator.clipboard.write([new ClipboardItem({ 'text/html': htmlBlob, 'text/plain': textBlob })]);
    } catch {
      navigator.clipboard.writeText(personalBodyPlain).catch(() => {});
    }
    window.open(baseUrl + encodeURIComponent(trimmedBody), '_blank');
  }

  function handleFileSelect(e) {
    const files = Array.from(e.target.files || []);
    files.forEach(file => {
      if (file.size > 10 * 1024 * 1024) {
        setResult({ type: 'error', message: `${file.name} is too large (max 10MB)` });
        return;
      }
      const reader = new FileReader();
      reader.onload = () => {
        setAttachments(prev => [...prev, {
          name: file.name,
          size: file.size,
          type: file.type,
          dataUrl: reader.result,
        }]);
      };
      reader.readAsDataURL(file);
    });
    e.target.value = '';
  }

  function removeAttachment(idx) {
    setAttachments(prev => prev.filter((_, i) => i !== idx));
  }

  function formatFileSize(bytes) {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  }

  function toQuotedPrintable(str) {
    // Encode each byte that needs encoding
    const encoded = str.replace(/[^\t\n\r\x20-\x3C\x3E-\x7E]/g, (ch) => {
      // This regex excludes = (0x3D) from the "safe" range, so = gets encoded
      const bytes = new TextEncoder().encode(ch);
      return Array.from(bytes).map(b => '=' + b.toString(16).toUpperCase().padStart(2, '0')).join('');
    });
    // Soft-wrap lines longer than 76 chars
    return encoded.split('\n').map(line => {
      const parts = [];
      while (line.length > 75) {
        let cut = 75;
        // Don't break in the middle of an encoded sequence (=XX)
        if (line[cut - 1] === '=') cut -= 1;
        else if (cut >= 2 && line[cut - 2] === '=') cut -= 2;
        parts.push(line.slice(0, cut) + '=');
        line = line.slice(cut);
      }
      parts.push(line);
      return parts.join('\r\n');
    }).join('\r\n');
  }

  function generateEmlFiles() {
    if (selectedContacts.length === 0 || !subject.trim()) return;

    // Load CC and To Also mappings
    let ccMap = {};
    let toAlsoMap = {};
    try { ccMap = JSON.parse(localStorage.getItem('prospect-cc-map') || '{}'); } catch {}
    try { toAlsoMap = JSON.parse(localStorage.getItem('prospect-to-also-map') || '{}'); } catch {}

    selectedContacts.forEach((c, i) => {
      const pBodyHtml = personalizeForContact(body, c);
      const pSubject = personalizeForContact(subject, c);
      const contactCc = ccMap[c.email] || [];
      const allCc = [...new Set([...contactCc, ...draftCc])];
      const toAlso = toAlsoMap[c.email] || [];
      const allTo = [c.email, ...toAlso];

      const toHeader = allTo.map((addr, j) => j === 0 ? `${c.name} <${addr}>` : `<${addr}>`).join(', ');
      const ccHeader = allCc.length > 0 ? `Cc: ${allCc.join(', ')}\r\n` : '';

      let htmlContent = pBodyHtml
        // Replace non-breaking spaces with regular spaces — pasted text often has &nbsp; for every space which prevents wrapping
        // First, mark double spaces (e.g. after periods) to preserve them
        .replace(/&nbsp;&nbsp;/g, '\x00DOUBLE\x00')
        .replace(/&nbsp;/g, ' ')
        .replace(/\x00DOUBLE\x00/g, '&nbsp;&nbsp;')
        .replace(/<p><br><\/p>\s*$/, '')
        .replace(/<\/p>\s*<ul>/gi, '</p><ul style="margin:0;padding-left:1.5em;">')
        .replace(/<\/p>\s*<ol>/gi, '</p><ol style="margin:0;padding-left:1.5em;">')
        .replace(/<ul>/gi, (m) => m.includes('style') ? m : '<ul style="margin:0;padding-left:1.5em;">')
        .replace(/<ol>/gi, (m) => m.includes('style') ? m : '<ol style="margin:0;padding-left:1.5em;">');
      // Insert line breaks after closing tags — Outlook's MIME parser can misrender very long single-line HTML
      htmlContent = htmlContent.replace(/<\/p>/gi, '</p>\n').replace(/<\/li>/gi, '</li>\n').replace(/<\/ul>/gi, '</ul>\n').replace(/<\/ol>/gi, '</ol>\n');
      htmlContent = `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word">\n<head>\n<!--[if gte mso 9]><xml><w:WordDocument><w:DontHyphenate/><w:DoNotHyphenateCaps/></w:WordDocument></xml><![endif]-->\n<style>\nbody,p,li,td{font-family:Aptos,Calibri,Arial,sans-serif;font-size:12pt;}\nul,ol{margin:0;padding-left:1.5em;}\n</style>\n</head>\n<body style="font-family:Aptos,Calibri,Arial,sans-serif;font-size:12pt;margin:0;padding:0;">\n${htmlContent}${signature ? '\n<br>\n' + signature : ''}\n</body>\n</html>`;

      let eml;
      if (attachments.length > 0) {
        const boundary = '----=_Part_' + Date.now() + '_' + Math.random().toString(36).slice(2);
        const headers = [
          'MIME-Version: 1.0',
          `Subject: ${pSubject}`,
          `To: ${toHeader}`,
          ccHeader ? ccHeader.trim() : null,
          'X-Unsent: 1',
          `Content-Type: multipart/mixed; boundary="${boundary}"`,
          '',
          `--${boundary}`,
          'Content-Type: text/html; charset=UTF-8',
          'Content-Transfer-Encoding: 8bit',
          '',
          htmlContent,
        ].filter(line => line !== null);

        const attachParts = attachments.map(att => {
          const base64Data = att.dataUrl.split(',')[1] || '';
          return [
            `--${boundary}`,
            `Content-Type: ${att.type || 'application/octet-stream'}; name="${att.name}"`,
            `Content-Disposition: attachment; filename="${att.name}"`,
            'Content-Transfer-Encoding: base64',
            '',
            base64Data,
          ].join('\r\n');
        });

        eml = headers.join('\r\n') + '\r\n' + attachParts.join('\r\n') + `\r\n--${boundary}--`;
      } else {
        eml = [
          'MIME-Version: 1.0',
          `Subject: ${pSubject}`,
          `To: ${toHeader}`,
          ccHeader ? ccHeader.trim() : null,
          'X-Unsent: 1',
          'Content-Type: text/html; charset=UTF-8',
          'Content-Transfer-Encoding: 8bit',
          '',
          htmlContent,
        ].filter(line => line !== null).join('\r\n');
      }

      const blob = new Blob([eml], { type: 'message/rfc822' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      const safeName = (c.name || c.email).replace(/[^a-zA-Z0-9]/g, '_');
      a.download = `draft_${safeName}.eml`;
      document.body.appendChild(a);
      setTimeout(() => { a.click(); document.body.removeChild(a); URL.revokeObjectURL(url); }, i * 300);
    });

    setResult({ type: 'success', message: `${selectedContacts.length} .eml file${selectedContacts.length !== 1 ? 's' : ''} downloading — double-click each to open in Outlook.` });
    saveDraft();
  }

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <h2 className={styles.title}>Draft Emails</h2>
        <p className={styles.desc}>Compose an email, tag contacts, and create drafts in Outlook.</p>
      </div>

      <div className={styles.layout}>
        {/* Compose area */}
        <div className={styles.composeCard}>
          <h3 className={styles.cardTitle}>Compose</h3>

          {/* Tagged contacts */}
          <div className={styles.field}>
            <label className={styles.label}>To {selectedContacts.length > 0 && <button onClick={() => setSelectedContacts([])} style={{ background: 'none', border: 'none', color: '#9CA3AF', fontSize: '0.65rem', cursor: 'pointer', fontFamily: 'inherit', fontWeight: 400, textTransform: 'none', letterSpacing: 0, padding: 0, marginLeft: '0.3rem' }}>Clear all</button>}</label>
            <div className={styles.contactsBox}>
              {selectedContacts.map(c => (
                <span key={c.id} className={styles.contactTag}>
                  {c.name} <span className={styles.contactEmail}>({c.email})</span>
                  <button className={styles.removeTag} onClick={() => removeContact(c.id)}>&times;</button>
                </span>
              ))}
              <div style={{ position: 'relative', flex: 1, minWidth: '150px' }} ref={searchRef}>
                <input
                  className={styles.contactSearchInput}
                  type="text"
                  value={contactSearch}
                  onChange={e => { setContactSearch(e.target.value); setShowSearch(true); }}
                  onFocus={() => setShowSearch(true)}
                  placeholder={selectedContacts.length === 0 ? "Search contacts by name, email, or company..." : "Add more..."}
                />
                {showSearch && filteredContacts.length > 0 && (
                  <div className={styles.searchDropdown}>
                    {filteredContacts.map(c => (
                      <button key={c.id} className={styles.searchResult} onClick={() => addContact(c)}>
                        <span className={styles.searchName}>{c.name}</span>
                        <span className={styles.searchMeta}>{c.email} {c.company && `· ${c.company}`}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Draft-level CC */}
          <div className={styles.field}>
            <label className={styles.label}>CC</label>
            <div className={styles.contactsBox}>
              {draftCc.map(email => (
                <span key={email} className={styles.contactTag} style={{ background: '#FEF3C7', borderColor: '#FDE68A', color: '#92400E' }}>
                  {email}
                  <button className={styles.removeTag} style={{ color: '#FCD34D' }} onClick={() => setDraftCc(prev => prev.filter(e => e !== email))}>&times;</button>
                </span>
              ))}
              <div style={{ position: 'relative', flex: 1, minWidth: '120px' }} ref={draftCcRef}>
                <input
                  className={styles.contactSearchInput}
                  value={draftCcInput}
                  onChange={e => { setDraftCcInput(e.target.value); setShowDraftCcSuggestions(true); }}
                  onFocus={() => setShowDraftCcSuggestions(true)}
                  onKeyDown={e => {
                    if (e.key === 'Enter' && draftCcInput.includes('@')) { e.preventDefault(); setDraftCc(prev => [...prev, draftCcInput.trim()]); setDraftCcInput(''); }
                    if (e.key === 'Backspace' && !draftCcInput && draftCc.length > 0) setDraftCc(prev => prev.slice(0, -1));
                  }}
                  placeholder={draftCc.length === 0 ? 'Add CC recipients...' : 'Add more...'}
                />
                {showDraftCcSuggestions && draftCcSuggestions.length > 0 && (
                  <div className={styles.searchDropdown}>
                    {draftCcSuggestions.map(c => (
                      <button key={c.id} className={styles.searchResult} onClick={() => { setDraftCc(prev => [...prev, c.email]); setDraftCcInput(''); setShowDraftCcSuggestions(false); }}>
                        <span className={styles.searchName}>{c.name}</span>
                        <span className={styles.searchMeta}>{c.email}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>

          <div className={styles.field}>
            <label className={styles.label}>Subject</label>
            <input
              ref={subjectRef}
              className={styles.input}
              type="text"
              value={subject}
              onChange={e => setSubject(e.target.value)}
              onFocus={() => setLastFocused('subject')}
              placeholder="Email subject line..."
            />
          </div>

          <div className={styles.field}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.3rem' }}>
              <label className={styles.label} style={{ marginBottom: 0 }}>Body</label>
              <div style={{ position: 'relative' }} ref={insertRef}>
                <button
                  className={styles.insertBtn}
                  onClick={() => setShowInsertMenu(p => !p)}
                  type="button"
                >
                  + Insert Variable
                </button>
                {showInsertMenu && (
                  <div className={styles.insertDropdown}>
                    {INSERT_VARIABLES.map(v => (
                      <button
                        key={v.token}
                        className={styles.insertOption}
                        onClick={() => insertVariable(v.token)}
                      >
                        <span className={styles.insertToken}>{v.token}</span>
                        <span className={styles.insertLabel}>{v.label}</span>
                        <span className={styles.insertExample}>e.g. {v.example}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
            <div className={styles.editorWrap} onClick={() => setLastFocused('body')}>
              <ReactQuill
                ref={bodyRef}
                theme="snow"
                value={body}
                onChange={setBody}
                placeholder="Hi {firstName}, I hope this message finds you well..."
                modules={{
                  toolbar: [
                    ['bold', 'italic', 'underline', 'strike'],
                    [{ 'list': 'ordered' }, { 'list': 'bullet' }],
                    ['link'],
                    ['clean'],
                  ],
                  clipboard: { matchVisual: false },
                }}
                formats={['bold', 'italic', 'underline', 'strike', 'list', 'link']}
              />
            </div>
          </div>

          {/* Attachments */}
          <div className={styles.field}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.3rem' }}>
              <label className={styles.label} style={{ marginBottom: 0 }}>Attachments</label>
              <input ref={fileInputRef} type="file" multiple style={{ display: 'none' }} onChange={handleFileSelect} />
              <button onClick={() => fileInputRef.current?.click()} style={{ padding: '0.25rem 0.6rem', border: '1px solid var(--color-border)', borderRadius: '6px', background: 'var(--color-surface)', fontSize: '0.72rem', fontWeight: 500, cursor: 'pointer', fontFamily: 'inherit', color: 'var(--color-text-secondary)' }}>
                + Add Files
              </button>
            </div>
            {attachments.length > 0 ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem' }}>
                {attachments.map((a, i) => (
                  <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.35rem 0.6rem', background: '#F8FAFC', border: '1px solid #E2E8F0', borderRadius: '6px' }}>
                    <span style={{ fontSize: '0.82rem' }}>📎</span>
                    <span style={{ flex: 1, fontSize: '0.78rem', fontWeight: 500, color: 'var(--color-text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{a.name}</span>
                    <span style={{ fontSize: '0.68rem', color: 'var(--color-text-muted)', flexShrink: 0 }}>{formatFileSize(a.size)}</span>
                    <button onClick={() => removeAttachment(i)} style={{ background: 'none', border: 'none', color: '#9CA3AF', fontSize: '0.9rem', cursor: 'pointer', padding: '0 2px', lineHeight: 1 }}>&times;</button>
                  </div>
                ))}
              </div>
            ) : (
              <p style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)', margin: 0 }}>No attachments. Files will be noted in the draft for manual attachment in Outlook.</p>
            )}
          </div>

          {/* Signature */}
          <div className={styles.field}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.3rem' }}>
              <label className={styles.label} style={{ marginBottom: 0 }}>
                Signature
                {signature && !showSignatureEditor && <span style={{ fontWeight: 400, textTransform: 'none', letterSpacing: 0, color: '#22C55E', marginLeft: '0.4rem' }}>✓ Saved</span>}
              </label>
              <button
                onClick={() => setShowSignatureEditor(p => !p)}
                style={{ padding: '0.25rem 0.6rem', border: '1px solid var(--color-border)', borderRadius: '6px', background: 'var(--color-surface)', fontSize: '0.72rem', fontWeight: 500, cursor: 'pointer', fontFamily: 'inherit', color: 'var(--color-text-secondary)' }}
              >
                {showSignatureEditor ? 'Done' : signature ? 'Edit' : '+ Add Signature'}
              </button>
            </div>
            {showSignatureEditor && (
              <div>
                <p style={{ fontSize: '0.72rem', color: 'var(--color-text-muted)', margin: '0 0 0.4rem' }}>
                  Paste your Outlook signature below. Tip: copy it from an existing email to keep formatting.
                </p>
                <div
                  contentEditable
                  suppressContentEditableWarning
                  onBlur={e => {
                    const html = e.currentTarget.innerHTML;
                    setSignature(html);
                    localStorage.setItem('prospect-email-signature', html);
                  }}
                  dangerouslySetInnerHTML={{ __html: signature }}
                  style={{ minHeight: '80px', padding: '0.6rem 0.75rem', border: '1px solid var(--color-border)', borderRadius: '6px', fontSize: '0.85rem', lineHeight: 1.5, color: 'var(--color-text)', outline: 'none', background: '#FAFAFA' }}
                />
              </div>
            )}
            {!showSignatureEditor && signature && (
              <div
                dangerouslySetInnerHTML={{ __html: signature }}
                style={{ padding: '0.5rem 0.75rem', background: '#FAFAFA', border: '1px solid #E5E5E5', borderRadius: '6px', fontSize: '0.82rem', lineHeight: 1.5, color: 'var(--color-text)', maxHeight: '120px', overflow: 'hidden' }}
              />
            )}
          </div>

          {result && (
            <div className={`${styles.result} ${styles[`result_${result.type}`]}`}>
              {result.message}
            </div>
          )}

          <div className={styles.actions}>
            <button className={styles.primaryBtn} onClick={generateEmlFiles} disabled={selectedContacts.length === 0 || !subject.trim()}>
              Download {selectedContacts.length || ''} Draft{selectedContacts.length !== 1 ? 's' : ''} for Outlook
            </button>
            <button className={styles.secondaryBtn} onClick={saveDraft} disabled={!subject.trim() && !body.trim()}>
              Save Draft
            </button>
          </div>

          {/* Preview — all contacts with tabs */}
          {selectedContacts.length > 0 && (subject.trim() || body.trim()) && (
            <PreviewTabs contacts={selectedContacts} subject={subject} body={body} personalizeForContact={personalizeForContact} draftCc={draftCc} />
          )}
        </div>

        {/* Right sidebar: Tag import + Saved drafts */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          {/* Import by Tag */}
          <div className={styles.draftsCard}>
            <h3 className={styles.cardTitle}>Import by Tag</h3>
            <TagContactPicker
              allContacts={allContacts}
              selectedContacts={selectedContacts}
              onAdd={addContact}
              onRemove={removeContact}
              onBulkAdd={(contacts) => setSelectedContacts(prev => {
                const ids = new Set(prev.map(c => c.id));
                return [...prev, ...contacts.filter(c => !ids.has(c.id))];
              })}
              onBulkRemove={(ids) => setSelectedContacts(prev => prev.filter(c => !ids.includes(c.id)))}
            />
          </div>

          {/* Saved drafts */}
          <div className={styles.draftsCard}>
            <h3 className={styles.cardTitle}>Saved Drafts ({drafts.length})</h3>
            {drafts.length === 0 ? (
              <p className={styles.emptyDrafts}>No saved drafts yet</p>
            ) : (
              <div className={styles.draftsList}>
                {drafts.map(d => (
                  <div key={d.id} className={styles.draftItem}>
                    <button className={styles.draftLoad} onClick={() => loadDraft(d)}>
                      <span className={styles.draftSubject}>{d.subject || '(No subject)'}</span>
                      <span className={styles.draftMeta}>
                        {d.contacts?.length || 0} contact{(d.contacts?.length || 0) !== 1 ? 's' : ''} · {new Date(d.createdAt).toLocaleDateString()}
                      </span>
                    </button>
                    <button className={styles.draftDelete} onClick={() => deleteDraft(d.id)}>&times;</button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
