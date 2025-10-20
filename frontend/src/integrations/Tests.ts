import { IntegrationItem, IntegrationProvider, registerIntegrationProvider } from '../lib/integrations'
import { listStudySets, type StudySet } from '../lib/api'

async function loadTestItems(): Promise<IntegrationItem[]> {
  const { items } = await listStudySets({ take: 50 })
  return items
    .filter((s: StudySet) => (s.tools||[]).includes('test'))
    .map((s: StudySet) => ({
      id: s.id,
      title: s.title || 'Untitled test',
      subtitle: s.subject || 'Test Mode',
      href: `/study/sets/${encodeURIComponent(s.id)}/test`,
      kind: 'studySet',
      dragPayload: { type: 'integration', integration: 'study-sets', itemType: 'studySet', id: s.id, title: s.title, openMode: 'test' }
    }))
}

const TestsProvider: IntegrationProvider = {
  id: 'study-tests',
  name: 'Tests',
  icon: undefined,
  loadItems: loadTestItems
}

registerIntegrationProvider(TestsProvider)
export default TestsProvider
