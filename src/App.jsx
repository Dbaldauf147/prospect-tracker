import { useState } from 'react';
import { useAuth } from './contexts/AuthContext';
import { useProspects } from './hooks/useProspects';
import { useFilters } from './hooks/useFilters';
import { Sidebar } from './components/Sidebar';
import { LoginPage } from './components/LoginPage';
import { FilterBar } from './components/FilterBar/FilterBar';
import { TableView } from './components/TableView/TableView';
import { KanbanView } from './components/KanbanView/KanbanView';
import { ProspectModal } from './components/ProspectModal/ProspectModal';
import './App.css';

function App() {
  const { user, loading: authLoading, signInWithGoogle, logout } = useAuth();
  const { prospects, loading: dataLoading, addProspect, updateProspect, deleteProspect } = useProspects(user);
  const {
    filtered, searchTerm, setSearchTerm,
    filters, toggleFilter, clearFilters, activeFilterCount,
    sortConfig, toggleSort,
  } = useFilters(prospects);

  const [view, setView] = useState('table');
  const [modal, setModal] = useState(null); // null | { prospect, isNew }

  if (authLoading) {
    return <div className="loading">Loading...</div>;
  }

  if (!user) {
    return <LoginPage onSignIn={signInWithGoogle} />;
  }

  function handleAddNew() {
    setModal({ prospect: null, isNew: true });
  }

  function handleSelect(prospect) {
    setModal({ prospect, isNew: false });
  }

  async function handleModalSave(data) {
    if (modal.isNew) {
      await addProspect(data);
    } else {
      await updateProspect(modal.prospect.id, data);
    }
    setModal(null);
  }

  return (
    <div className="layout">
      <Sidebar view={view} setView={setView} user={user} onLogout={logout} />
      <div className="main">
        <FilterBar
          searchTerm={searchTerm}
          setSearchTerm={setSearchTerm}
          filters={filters}
          toggleFilter={toggleFilter}
          clearFilters={clearFilters}
          activeFilterCount={activeFilterCount}
          view={view}
          setView={setView}
          onAddNew={handleAddNew}
          resultCount={filtered.length}
          totalCount={prospects.length}
        />
        <div className="content">
          {dataLoading ? (
            <div className="loading">Loading prospects...</div>
          ) : view === 'table' ? (
            <TableView
              prospects={filtered}
              sortConfig={sortConfig}
              toggleSort={toggleSort}
              onUpdate={updateProspect}
              onDelete={deleteProspect}
              onSelect={handleSelect}
            />
          ) : (
            <KanbanView
              prospects={filtered}
              onUpdate={updateProspect}
              onSelect={handleSelect}
            />
          )}
        </div>
      </div>

      {modal && (
        <ProspectModal
          prospect={modal.prospect}
          isNew={modal.isNew}
          onSave={handleModalSave}
          onClose={() => setModal(null)}
        />
      )}
    </div>
  );
}

export default App;
