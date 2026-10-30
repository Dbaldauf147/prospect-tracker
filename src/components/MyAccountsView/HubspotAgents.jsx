// Hubspot Mapping > Agents: prompts for a browser agent working in HubSpot,
// each copied together with the rows it should work through, the way the
// Agents page copies its prompts. Two come built in (Map Activity on My
// Accounts, Update HubSpot Company Owners); "+ New agent" adds your own.
// The list is saved in settings.hubspotMappingAgents (utils/hubspotAgents.js).
import { useState } from 'react';
import { DataTable } from '../common/DataTable';
import {
  AGENT_DATA, AGENT_DATA_LABELS, builtInAgent, agentDataBlock, fullAgentPrompt, moveAgent,
} from '../../utils/hubspotAgents';

const fmt = (n) => Number(n || 0).toLocaleString();
const blank = <span style={{ color: '#CBD5E1' }}>-</span>;
const btn = { padding: '0.25rem 0.7rem', borderRadius: 6, border: '1px solid #1D4ED8', background: '#1D4ED8', color: '#fff', fontSize: '0.72rem', fontWeight: 600, fontFamily: 'inherit', cursor: 'pointer', whiteSpace: 'nowrap' };
const ghost = { ...btn, background: '#fff', color: '#334155', border: '1px solid #CBD5E1' };
const card = { border: '1px solid #E2E8F0', borderRadius: 8, background: '#fff', padding: '0.75rem 0.9rem', display: 'flex', flexDirection: 'column', gap: '0.5rem' };
const input = { width: '100%', boxSizing: 'border-box', padding: '0.4rem 0.5rem', border: '1px solid #CBD5E1', borderRadius: 6, fontFamily: 'inherit', fontSize: '0.8rem' };

const col = (key, label, width) => ({ key, label, defaultWidth: width, getFilterValue: r => r[key] || '', exportValue: r => r[key] || '', render: r => r[key] || blank });
const TABLE_COLUMNS = {
  [AGENT_DATA.activity]: [
    col('company', 'My Accounts Company', 220), col('hubspotName', 'HubSpot Company', 220), col('recordId', 'Record ID', 120),
    col('domain', 'Domain', 160), col('owner', 'Company Owner', 140), col('lastActivity', 'Last Activity', 130),
  ],
  [AGENT_DATA.owners]: [
    col('company', 'My Accounts Company', 220), col('hubspotName', 'HubSpot Company', 240), col('recordId', 'Record ID', 120), col('domain', 'Domain', 160),
    col('owner', 'Current Owner', 140), col('newOwner', 'New Owner', 140), col('why', 'Why', 260),
  ],
};

const arrowBtn = { border: '1px solid #CBD5E1', background: '#fff', color: '#475569', borderRadius: 4, padding: '0 6px', fontSize: '0.72rem', lineHeight: '1.3rem', fontFamily: 'inherit', cursor: 'pointer' };

function AgentCard({ agent, rows, blurb, onSave, onDelete, settings, updateSettings, order }) {
  // A new agent opens ready to write its prompt.
  const [editing, setEditing] = useState(() => !agent.prompt);
  const [draft, setDraft] = useState(agent);
  const [showRows, setShowRows] = useState(false);
  const [flash, setFlash] = useState('');
  const builtIn = builtInAgent(agent.id);
  const hasData = agent.data !== AGENT_DATA.none;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(fullAgentPrompt(agent.prompt, agentDataBlock(agent.data, rows)));
      setFlash('Copied!');
    } catch {
      setFlash('Copy failed');
    }
    window.setTimeout(() => setFlash(''), 1500);
  };
  const startEdit = () => { setDraft(agent); setEditing(true); };
  const save = () => { onSave({ ...draft, title: draft.title.trim() || 'Untitled agent' }); setEditing(false); };

  return (
    <section
      style={{ ...card, ...(order.dragging ? { opacity: 0.5 } : null), ...(order.over ? { boxShadow: '0 -3px 0 #1D4ED8' } : null) }}
      onDragOver={order.onDragOver}
      onDragLeave={order.onDragLeave}
      onDrop={order.onDrop}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
        {/* Drag the handle to reorder; the arrows move one place. */}
        <span
          draggable
          onDragStart={order.onDragStart}
          onDragEnd={order.onDragEnd}
          title="Drag to reorder the agents"
          style={{ cursor: 'grab', color: '#94A3B8', fontSize: '0.95rem', userSelect: 'none', lineHeight: 1 }}
        >{'\u283F'}</span>
        <h2 style={{ margin: 0, fontSize: '0.95rem', fontWeight: 700, color: '#1E293B' }}>{agent.title}</h2>
        {hasData && (
          <span style={{ fontSize: '0.68rem', fontWeight: 700, color: '#1D4ED8', background: '#EFF6FF', border: '1px solid #BFDBFE', padding: '0 7px', borderRadius: 999 }}>
            {fmt(rows.length)} row{rows.length === 1 ? '' : 's'}
          </span>
        )}
        <span style={{ fontSize: '0.7rem', color: '#64748B' }}>{AGENT_DATA_LABELS[agent.data]}</span>
        <span style={{ marginLeft: 'auto', display: 'inline-flex', gap: 4 }}>
          <button type="button" style={{ ...arrowBtn, opacity: order.first ? 0.35 : 1, cursor: order.first ? 'default' : 'pointer' }} disabled={order.first} onClick={order.onUp} title="Move up" aria-label={`Move ${agent.title} up`}>{'\u2191'}</button>
          <button type="button" style={{ ...arrowBtn, opacity: order.last ? 0.35 : 1, cursor: order.last ? 'default' : 'pointer' }} disabled={order.last} onClick={order.onDown} title="Move down" aria-label={`Move ${agent.title} down`}>{'\u2193'}</button>
        </span>
      </div>
      {blurb && <div style={{ fontSize: '0.74rem', color: '#64748B', lineHeight: 1.45 }}>{blurb}</div>}

      {editing && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
          <input style={input} value={draft.title} placeholder="Agent name" onChange={e => setDraft(d => ({ ...d, title: e.target.value }))} />
          <label style={{ fontSize: '0.74rem', color: '#334155', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
            Rows copied with the prompt
            <select value={draft.data} onChange={e => setDraft(d => ({ ...d, data: e.target.value }))} style={{ ...input, width: 'auto' }}>
              {Object.values(AGENT_DATA).map(v => <option key={v || 'none'} value={v}>{AGENT_DATA_LABELS[v]}</option>)}
            </select>
          </label>
          <textarea style={{ ...input, fontFamily: 'ui-monospace, monospace', fontSize: '0.74rem', resize: 'vertical' }} rows={10} spellCheck={false}
            value={draft.prompt} placeholder="What the agent should do in HubSpot" onChange={e => setDraft(d => ({ ...d, prompt: e.target.value }))} />
        </div>
      )}

      <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', flexWrap: 'wrap' }}>
        {editing ? (
          <>
            <button type="button" style={btn} onClick={save} disabled={!draft.prompt.trim()}>Save</button>
            <button type="button" style={ghost} onClick={() => setEditing(false)}>Cancel</button>
            {builtIn && (
              <button type="button" style={ghost} onClick={() => setDraft(d => ({ ...d, title: builtIn.title, data: builtIn.data, prompt: builtIn.prompt }))}
                title="Put the built-in name, rows and prompt back in the boxes above. Save to keep them.">Reset to default</button>
            )}
          </>
        ) : (
          <>
            <button type="button" style={btn} onClick={copy} disabled={!agent.prompt.trim()}
              title={hasData ? 'Copy the prompt with its rows underneath, ready to paste into the browser agent.' : 'Copy the prompt.'}
            >Copy full prompt</button>
            <button type="button" style={ghost} onClick={startEdit}>Edit prompt</button>
            {hasData && <button type="button" style={ghost} onClick={() => setShowRows(v => !v)}>{showRows ? 'Hide rows' : 'Show rows'}</button>}
            <button type="button" style={ghost} onClick={() => { if (window.confirm(`Delete the ${agent.title} agent?`)) onDelete(); }}>Delete</button>
            {flash && <span style={{ fontSize: '0.72rem', fontWeight: 600, color: flash === 'Copied!' ? '#15803D' : '#B91C1C' }}>{flash}</span>}
          </>
        )}
      </div>

      {hasData && showRows && !editing && (
        rows.length ? (
          <div style={{ height: 360, display: 'flex', flexDirection: 'column', border: '1px solid #E2E8F0', borderRadius: 8, overflow: 'hidden' }}>
            <DataTable
              tableId={`hubspot-agent-rows-${agent.data}`}
              exportFileName={agent.title}
              columns={TABLE_COLUMNS[agent.data]}
              rows={rows.map(r => ({ ...r, id: r.key }))}
              defaultSort={{ key: TABLE_COLUMNS[agent.data][0].key, direction: 'asc' }}
              emptyMessage="Nothing matches"
              settings={settings}
              updateSettings={updateSettings}
            />
          </div>
        ) : <div style={{ fontSize: '0.78rem', color: '#64748B' }}>No rows right now, so the prompt copies on its own.</div>
      )}
    </section>
  );
}

export function HubspotAgents({ agents, onChange, rowsByData, blurbs = {}, hasExport, settings, updateSettings }) {
  // The order is the saved list's order, so moving an agent is a save.
  const [dragId, setDragId] = useState(null);
  const [overId, setOverId] = useState(null);
  const move = (id, to) => { const next = moveAgent(agents, id, to); if (next !== agents) onChange(next); };
  const orderFor = (a, i) => ({
    first: i === 0,
    last: i === agents.length - 1,
    dragging: dragId === a.id,
    over: overId === a.id && dragId && dragId !== a.id,
    onUp: () => move(a.id, i - 1),
    onDown: () => move(a.id, i + 1),
    onDragStart: (e) => { setDragId(a.id); e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', a.id); },
    onDragEnd: () => { setDragId(null); setOverId(null); },
    onDragOver: (e) => { if (!dragId) return; e.preventDefault(); if (overId !== a.id) setOverId(a.id); },
    onDragLeave: () => { if (overId === a.id) setOverId(null); },
    // Dropped on a card: the dragged agent takes that card's place.
    onDrop: (e) => {
      e.preventDefault();
      if (dragId && dragId !== a.id) move(dragId, i);
      setDragId(null); setOverId(null);
    },
  });
  const add = () => {
    const id = `a_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
    onChange([...agents, { id, title: 'New agent', data: AGENT_DATA.none, prompt: '' }]);
  };
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem', overflowY: 'auto', minHeight: 0, flex: 1 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
        <div style={{ fontSize: '0.78rem', color: '#475569', lineHeight: 1.45 }}>
          Prompts for a browser agent working in HubSpot. <strong>Copy full prompt</strong> copies the prompt with the rows it should work through underneath, read off the HubSpot export on the Mapping subtab. Edit any prompt, or add your own. Drag {'\u283F'} or use the arrows to change the order. They sync across your devices.
          {!hasExport && <> <strong style={{ color: '#B45309' }}>Drop a HubSpot companies export on the Mapping subtab first, or the agents have no rows.</strong></>}
        </div>
        <button type="button" style={{ ...btn, marginLeft: 'auto' }} onClick={add}>+ New agent</button>
      </div>
      {agents.length === 0 && <div style={{ fontSize: '0.8rem', color: '#64748B' }}>No agents. Click + New agent to add one.</div>}
      {agents.map((a, i) => (
        <AgentCard
          key={a.id}
          agent={a}
          rows={rowsByData[a.data] || []}
          blurb={blurbs[a.data]}
          onSave={(next) => onChange(agents.map(x => (x.id === a.id ? next : x)))}
          onDelete={() => onChange(agents.filter(x => x.id !== a.id))}
          order={orderFor(a, i)}
          settings={settings}
          updateSettings={updateSettings}
        />
      ))}
    </div>
  );
}
