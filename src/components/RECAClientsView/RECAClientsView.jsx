import { UploadedListView } from '../UploadedListView/UploadedListView';

// Thin wrapper around UploadedListView so RECA Clients inherits the
// shared upload + My Account mapping behavior. The localStorage key
// stays reca-clients-override so any existing uploaded list is
// preserved across this refactor.
export function RECAClientsView({ prospects = [], onSelectProspect }) {
  return (
    <UploadedListView
      storageKey="reca-clients-override"
      tableIdPrefix="reca-clients"
      title="RECA Clients"
      singular="client"
      plural="clients"
      prospects={prospects}
      onSelectProspect={onSelectProspect}
    />
  );
}
