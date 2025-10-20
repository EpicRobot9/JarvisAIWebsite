import { IntegrationItem, IntegrationProvider, registerIntegrationProvider } from '../lib/integrations'
import { listStudySets, type StudySet } from '../lib/api'

async function loadFlashcardItems(): Promise<IntegrationItem[]> {
  const { items } = await listStudySets({ take: 50 })
  return items
    .filter((s: StudySet) => (s.tools||[]).includes('flashcards'))
    .map((s: StudySet) => ({
      id: s.id,
      title: (s.title || 'Untitled set') + ' — Flashcards',
      subtitle: s.subject || 'Flashcards',
      href: `/study/sets/${encodeURIComponent(s.id)}/flashcards`,
      kind: 'studySet',
      dragPayload: { type: 'integration', integration: 'study-sets', itemType: 'studySet', id: s.id, title: s.title, openMode: 'flashcards' }
    }))
}

const FlashcardsProvider: IntegrationProvider = {
  id: 'study-flashcards',
  name: 'Flashcards',
  icon: undefined,
  loadItems: loadFlashcardItems
}

registerIntegrationProvider(FlashcardsProvider)
export default FlashcardsProvider
