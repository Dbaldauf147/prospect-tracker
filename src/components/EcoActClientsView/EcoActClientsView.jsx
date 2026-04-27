import { UploadedListView } from '../UploadedListView/UploadedListView';

// Thin wrapper around UploadedListView so EcoAct Clients inherits the
// shared upload + My Account mapping behavior, mirroring RECA Clients.
export function EcoActClientsView({ prospects = [], onSelectProspect }) {
  return (
    <UploadedListView
      storageKey="ecoact-clients-override"
      tableIdPrefix="ecoact-clients"
      title="EcoAct Clients"
      singular="client"
      plural="clients"
      prospects={prospects}
      onSelectProspect={onSelectProspect}
      textColumn={{ key: 'ecoact-cdm', label: 'EcoAct CDM', placeholder: 'Add CDM…' }}
    />
  );
}
