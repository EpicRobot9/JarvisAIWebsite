import { IntegrationItem, IntegrationProvider, registerIntegrationProvider } from '../lib/integrations'
import { listStudySets, type StudySet } from '../lib/api'

async function loadMatchItems(): Promise<IntegrationItem[]> {
  const { items } = await listStudySets({ take: 50 })
  return items
    .filter((s: StudySet) => (s.tools||[]).includes('match'))
    .map((s: StudySet) => ({
      id: s.id,
      title: s.title || 'Untitled match',
      subtitle: s.subject || 'Match Game',
      href: `/study/sets/${encodeURIComponent(s.id)}/match`,
      kind: 'studySet',
      dragPayload: { type: 'integration', integration: 'study-sets', itemType: 'studySet', id: s.id, title: s.title, openMode: 'match' }
    }))
}

const MatchProvider: IntegrationProvider = {
  id: 'study-match',
  name: 'Match Game',
  icon: undefined,
  loadItems: loadMatchItems
}

registerIntegrationProvider(MatchProvider)
export default MatchProvider
