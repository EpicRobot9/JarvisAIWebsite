import { IntegrationItem, IntegrationProvider, registerIntegrationProvider } from '../lib/integrations'
import { listStudySets, type StudySet } from '../lib/api'

async function loadStudyGuideItems(): Promise<IntegrationItem[]> {
  const { items } = await listStudySets({ take: 50 })
  return items
    .filter((s: StudySet) => (s.tools||[]).includes('guide'))
    .map((s: StudySet) => ({
      id: s.id,
      title: s.title || 'Untitled guide',
      subtitle: s.subject || 'Guide',
      href: `/study/sets/${encodeURIComponent(s.id)}/enhanced`,
      kind: 'studySet',
      dragPayload: { type: 'integration', integration: 'study-sets', itemType: 'studySet', id: s.id, title: s.title, openMode: 'guide' }
    }))
}

const StudyGuidesProvider: IntegrationProvider = {
  id: 'study-guides',
  name: 'Study Guides',
  icon: undefined,
  loadItems: loadStudyGuideItems
}

registerIntegrationProvider(StudyGuidesProvider)
export default StudyGuidesProvider
