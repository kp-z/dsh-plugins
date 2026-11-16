/** Destination tasklist selection helper. No field contract is enforced: fields are
 *  resolved/created lazily at write time by the backend, and legacy text/duplicate
 *  fields are used as-is rather than failing initialization. */
export const DEFAULT_TASKLIST_NAME = 'DSH 任务清单'

export function selectTaskList(rawLists, managedGuid) {
  const ids = [...new Set((rawLists || []).map(row => row?.tasklist_guid).filter(Boolean))]
  if (managedGuid && ids.includes(managedGuid)) return { guid: managedGuid, ambiguous: false }
  return { guid: ids.length === 1 ? ids[0] : '', ambiguous: ids.length > 1 }
}
