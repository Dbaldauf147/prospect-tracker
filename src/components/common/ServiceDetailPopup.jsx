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
import { ServiceDetailModal } from '../DropdownsView/ServiceDetailModal';
import { buildServiceDetail } from '../../utils/serviceDetailProps';
import { getServiceCategories, moveServiceToBucket } from '../../utils/serviceCategoriesStore';

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

  // Plain functions rather than useCallback, as on the Services subtab: the
  // popup isn't memoized, so a stable identity buys nothing, and the compiler
  // reads a `settings?.x` dependency as one it can't verify.
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

  function onSaveTemplates(next) {
    updateSettings?.({ timelineTemplates: next });
  }

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
      onSaveBucket={onSaveBucket}
      onSaveField={onSaveField}
      onSaveUrl={onSaveUrl}
      onToggleHide={onToggleHide}
      onSaveTemplates={onSaveTemplates}
      zIndex={zIndex}
      onClose={onClose}
    />
  );
}
