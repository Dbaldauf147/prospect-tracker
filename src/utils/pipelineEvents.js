// Pipeline page Events table helpers (components/PipelineView/PipelineEvents.jsx).

export const newEventId = () => `ev-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;

export const fmtEventDate = (iso) => {
  if (!iso) return '';
  const d = new Date(`${iso}T00:00:00`);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
};

export const todayIso = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

// Saved rows as a clean list, so a corrupt saved value can't crash the table.
export function sanitizeEvents(saved) {
  if (!Array.isArray(saved)) return [];
  return saved
    .filter(r => r && typeof r === 'object')
    .map(r => ({
      id: typeof r.id === 'string' && r.id ? r.id : newEventId(),
      name: typeof r.name === 'string' ? r.name : '',
      date: typeof r.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(r.date) ? r.date : '',
    }));
}

