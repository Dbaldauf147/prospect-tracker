// The service popup, openable from anywhere that lists service names.
//
// The panel itself is the Services subtab's (ServiceDetailModal) — the same
// fields, the same dependency and auto-add sections, the same save-as-you-type
// behaviour. What kept it on that page was its props: a dozen derived lists
// assembled inside DropdownsView. Those come off settings alone
// (buildServiceDetail), and the writes are the four settings keys below, so
// this wrapper is everything a board needs to open the popup on a service.
//
// It edits, so it wants an updateSettings. A caller without one shouldn't
// open it: the fields would take typing and store none of it.

import { useMemo } from 'react';
import { ServiceDetailModal, ServiceDetailFields } from '../DropdownsView/ServiceDetailModal';
import { buildServiceDetail } from '../../utils/serviceDetailProps';
import { getServiceCategories, moveServiceToBucket } from '../../utils/serviceCategoriesStore';
import { deleteServiceUpdates } from '../../utils/serviceDelete';
import { serviceFieldOptions, serviceFieldOptionUpdates } from '../../utils/serviceFieldOptions';

export function ServiceDetailPopup({
  // The service to show, by name. By name rather than by row object because
  // every edit in the popup rewrites settings and rebuilds the rows: a
  // captured row goes stale the moment the user types in it.
  name,
  settings,
  updateSettings,
  onClose,
  // Lets a caller that is itself a modal put this one above it. Both
  // overlays sit at 9500 by default, and equal z-index leaves the order to
  // the DOM, which is not something a board should have to rely on.
  zIndex,
}) {
  const detail = useMemo(() => buildServiceDetail(settings, name), [settings, name]);
  const fieldOptions = useMemo(() => serviceFieldOptions(settings), [settings]);

  const h = serviceDetailHandlers(settings, updateSettings, onClose);

  if (!detail) return null;

  return (
    <ServiceDetailModal
      service={detail.service}
      url={detail.url}
      hidden={detail.hidden}
      dependents={detail.dependents}
      autoAddedBy={detail.autoAddedBy}
      autoNaedBy={detail.autoNaedBy}
      options={detail.options}
      templates={detail.templates}
      bucket={detail.bucket}
      bucketOptions={detail.bucketOptions}
      onSaveBucket={h.onSaveBucket}
      onSaveField={h.onSaveField}
      fieldOptions={fieldOptions}
      onEditFieldOption={h.onEditFieldOption}
      onSaveUrl={h.onSaveUrl}
      onToggleHide={h.onToggleHide}
      // Only offered for a name that is on the list: an unlisted one (typed
      // straight into a Scope cell) has nothing to delete.
      onDelete={deleteServiceUpdates(settings, detail.service.name) ? h.onDelete : undefined}
      onSaveTemplates={h.onSaveTemplates}
      zIndex={zIndex}
      onClose={onClose}
    />
  );
}

// The popup's fields as a tab inside another panel: the Services Pricing
// popup's "Service details". Same derived props, same writes; no overlay,
// header or footer of its own, since the panel carrying it has those.
export function ServiceDetailTab({ name, settings, updateSettings }) {
  const detail = useMemo(() => buildServiceDetail(settings, name), [settings, name]);
  const fieldOptions = useMemo(() => serviceFieldOptions(settings), [settings]);
  const h = serviceDetailHandlers(settings, updateSettings);
  if (!detail) return null;
  return (
    <ServiceDetailFields
      service={detail.service}
      url={detail.url}
      dependents={detail.dependents}
      autoAddedBy={detail.autoAddedBy}
      autoNaedBy={detail.autoNaedBy}
      options={detail.options}
      templates={detail.templates}
      bucket={detail.bucket}
      bucketOptions={detail.bucketOptions}
      onSaveBucket={h.onSaveBucket}
      onSaveField={h.onSaveField}
      fieldOptions={fieldOptions}
      onEditFieldOption={h.onEditFieldOption}
      onSaveUrl={h.onSaveUrl}
      onSaveTemplates={h.onSaveTemplates}
    />
  );
}

// The writes behind both, each one a settings key. Plain functions rather
// than useCallback, as on the Services subtab: neither caller is memoized, so
// a stable identity buys nothing, and the compiler reads a `settings?.x`
// dependency as one it can't verify.
function serviceDetailHandlers(settings, updateSettings, onClose) {
  function onSaveField(service, field, value) {
    const current = (settings?.serviceOverrides && typeof settings.serviceOverrides === 'object')
      ? settings.serviceOverrides
      : {};
    const next = { ...current };
    const row = { ...(next[service] || {}) };
    // A blank clears the override, so the field falls back to the seed
    // catalog value rather than storing an empty string over it.
    if (value == null || value === '') delete row[field];
    else row[field] = value;
    if (Object.keys(row).length === 0) delete next[service];
    else next[service] = row;
    updateSettings?.({ serviceOverrides: next });
  }

  function onSaveUrl(service, url) {
    const current = (settings?.serviceLinks && typeof settings.serviceLinks === 'object')
      ? settings.serviceLinks
      : {};
    const next = { ...current };
    const trimmed = (url || '').trim();
    if (trimmed) next[service] = trimmed;
    else delete next[service];
    updateSettings?.({ serviceLinks: next });
  }

  function onSaveBucket(service, bucket) {
    const next = moveServiceToBucket(
      getServiceCategories(settings), service, bucket, settings?.serviceRenames,
    );
    // null means it is already in that box: nothing to write.
    if (next) updateSettings?.({ customServiceCategories: next });
  }

  function onToggleHide(service) {
    const current = settings?.hiddenServices || [];
    const next = current.includes(service)
      ? current.filter(s => s !== service)
      : [...current, service];
    updateSettings?.({ hiddenServices: next });
  }

  // Closes the popup too: an unlisted name still opens (with empty fields),
  // so left open it would read as if the delete hadn't happened.
  function onDelete(service) {
    const updates = deleteServiceUpdates(settings, service);
    if (updates) updateSettings?.(updates);
    onClose?.();
  }

  function onEditFieldOption(kind, field, a, b) {
    updateSettings?.(s => serviceFieldOptionUpdates(s, kind, field, a, b));
  }

  function onSaveTemplates(next) {
    updateSettings?.({ timelineTemplates: next });
  }

  return {
    onSaveField, onSaveUrl, onSaveBucket, onToggleHide, onDelete,
    onEditFieldOption, onSaveTemplates,
  };
}
