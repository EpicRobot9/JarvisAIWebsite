import { IntegrationItem, IntegrationProvider, registerIntegrationProvider } from '../lib/integrations'
import { listStudySets, type StudySet } from '../lib/api'

async function loadStudySetItems(): Promise<IntegrationItem[]> {
  const { items } = await listStudySets({ take: 20 })
  return items.map((s: StudySet) => ({
    id: s.id,
    title: (s.title || 'Untitled set') + (s.tools?.includes('flashcards') ? ' — Flashcards' : ''),
    subtitle: s.subject || (s.tools?.join(', ') || ''),
    href: `/study/sets/${encodeURIComponent(s.id)}`,
    kind: 'studySet',
  dragPayload: { type: 'integration', integration: 'study-sets', itemType: 'studySet', id: s.id, title: s.title, openMode: 'flashcards' }
  }))
}

const StudySetsProvider: IntegrationProvider = {
  id: 'study-sets',
  name: 'Study Sets',
  icon: undefined,
  loadItems: loadStudySetItems
}

// Auto-register on import
registerIntegrationProvider(StudySetsProvider)

export default StudySetsProvider
