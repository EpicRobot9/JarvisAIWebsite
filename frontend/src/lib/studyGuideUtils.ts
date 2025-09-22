// Utility functions for parsing and processing study guide content

export interface StudyGuideSection {
  id: string
  title: string
  content: string
  type: 'overview' | 'concepts' | 'details' | 'questions' | 'summary'
  difficulty?: 'beginner' | 'intermediate' | 'advanced'
  estimatedTime?: number
  importance?: number
  keywords?: string[]
}

/**
 * Parse markdown study guide content into structured sections
 */
export function parseStudyGuideContent(markdownContent: string): StudyGuideSection[] {
  if (!markdownContent) return []

  const sections: StudyGuideSection[] = []

  // First, extract study guide requirements if they exist
  const userRequirements = extractStudyGuideRequirements(markdownContent)
  console.log('🔍 parseStudyGuideContent: Extracted requirements:', userRequirements)
  console.log('🔍 parseStudyGuideContent: Full content preview:', markdownContent.substring(0, 800))

  // More reliable parsing using explicit section markers
  const lines = markdownContent.split('\n')
  let currentSection: Partial<StudyGuideSection> | null = null
  let contentBuffer: string[] = []

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    
    // Skip Study Guide Requirements section content
    if (line.startsWith('### Study Guide Requirements:') || 
        (currentSection && currentSection.title === 'Study Guide Requirements')) {
      if (line.startsWith('### Study Guide Requirements:')) {
        // Skip this entire section - it's metadata, not content
        while (i < lines.length && !lines[i + 1]?.match(/^#{1,3}\s|^---SECTION---/)) {
          i++
        }
        continue
      }
    }
    
    // Check for explicit section markers first (new method)
    if (line.trim() === '---SECTION---') {
      // Next line should be the section title
      if (i + 1 < lines.length) {
        const nextLine = lines[i + 1]
        const title = nextLine.replace(/^#+\s*/, '').trim() // Remove any hash marks
        
        // Save previous section if it exists
        if (currentSection && contentBuffer.length > 0 && currentSection.title !== 'Study Guide Requirements') {
          const sectionContent = contentBuffer.join('\n').trim()
          if (sectionContent) {
            sections.push({
              id: currentSection.id!,
              title: currentSection.title!,
              content: sectionContent,
              type: currentSection.type!,
              difficulty: currentSection.difficulty,
              estimatedTime: currentSection.estimatedTime || 5,
              importance: currentSection.importance || 3,
              keywords: extractKeywords(sectionContent)
            })
          }
        }
        
        // Create new section
        console.log(`🏗️ Creating section from marker: "${title}"`)
        
        let finalTitle = title
        if (title.toLowerCase().includes('practical examples') || 
            title.toLowerCase().includes('real-world applications') ||
            title.toLowerCase().includes('examples and real-world')) {
          finalTitle = 'Practical Examples and Real-World Applications'
        }
        
        const sectionId = finalTitle.toLowerCase()
          .replace(/[^a-z0-9]+/g, '-')
          .replace(/^-+|-+$/g, '')
        
        const { type, difficulty, importance, estimatedTime } = classifySection(finalTitle, 1, userRequirements)
        
        currentSection = {
          id: sectionId,
          title: finalTitle,
          type,
          difficulty,
          importance,
          estimatedTime
        }
        contentBuffer = []
        i++ // Skip the title line since we processed it
        continue
      }
    }
    
    // Fallback: Check if this line is a header (for backward compatibility)
    const headerMatch = line.match(/^(#{1,3})\s*(.+)$/)
    
    if (headerMatch) {
      const headerLevel = headerMatch[1].length
      const title = headerMatch[2].trim()
      
      // Skip Study Guide Requirements section
      if (title === 'Study Guide Requirements') {
        currentSection = { title }
        contentBuffer = []
        continue
      }

      // Only create new sections for h1 headers when no explicit markers are used
      if (headerLevel === 1) {
        // Save previous section if it exists
        if (currentSection && contentBuffer.length > 0 && currentSection.title !== 'Study Guide Requirements') {
          const sectionContent = contentBuffer.join('\n').trim()
          if (sectionContent) {
            sections.push({
              id: currentSection.id!,
              title: currentSection.title!,
              content: sectionContent,
              type: currentSection.type!,
              difficulty: currentSection.difficulty,
              estimatedTime: currentSection.estimatedTime || 5,
              importance: currentSection.importance || 3,
              keywords: extractKeywords(sectionContent)
            })
          }
        }
        
        console.log(`🏗️ Creating section from h1: "${title}"`)
        
        let finalTitle = title
        if (title.toLowerCase().includes('practical examples') || 
            title.toLowerCase().includes('real-world applications') ||
            title.toLowerCase().includes('examples and real-world')) {
          finalTitle = 'Practical Examples and Real-World Applications'
        }
        
        const sectionId = finalTitle.toLowerCase()
          .replace(/[^a-z0-9]+/g, '-')
          .replace(/^-+|-+$/g, '')
        
        const { type, difficulty, importance, estimatedTime } = classifySection(finalTitle, headerLevel, userRequirements)
        
        currentSection = {
          id: sectionId,
          title: finalTitle,
          type,
          difficulty,
          importance,
          estimatedTime
        }
        contentBuffer = []
      } else {
        // h2/h3 headers get added as content to the current section
        contentBuffer.push(line)
      }
    } else if (currentSection && currentSection.title !== 'Study Guide Requirements') {
      // Add content to current section (but skip requirements section content)
      contentBuffer.push(line)
    } else if (line.trim() && sections.length === 0 && !line.includes('Study Guide Requirements')) {
      // This is content before any headers - create an introduction section
      if (!currentSection) {
        currentSection = {
          id: 'introduction',
          title: 'Introduction',
          type: 'overview',
          importance: 5,
          estimatedTime: Math.ceil((userRequirements.duration || 30) * 0.1), // 10% of total time for intro
          difficulty: userRequirements.difficulty || 'intermediate'
        }
        contentBuffer = []
      }
      contentBuffer.push(line)
    }
  }
  
  // Don't forget the last section
  if (currentSection && contentBuffer.length > 0 && currentSection.title !== 'Study Guide Requirements') {
    sections.push({
      id: currentSection.id!,
      title: currentSection.title!,
      content: contentBuffer.join('\n').trim(),
      type: currentSection.type!,
      difficulty: currentSection.difficulty,
      estimatedTime: currentSection.estimatedTime || 5,
      importance: currentSection.importance || 3,
      keywords: extractKeywords(contentBuffer.join('\n'))
    })
  }
  
  // Scale time estimates to match user's target duration
  if (userRequirements.duration && sections.length > 0) {
    const totalCurrentTime = sections.reduce((sum, s) => sum + (s.estimatedTime || 0), 0)
    const scaleFactor = userRequirements.duration / (totalCurrentTime || 1)
    
    sections.forEach(section => {
      section.estimatedTime = Math.max(1, Math.round((section.estimatedTime || 5) * scaleFactor))
    })
  }
  
  return sections
}

/**
 * Extract study guide requirements from the markdown content
 */
export function extractStudyGuideRequirements(content: string): {
  duration?: number
  difficulty?: StudyGuideSection['difficulty']
  style?: string
  includeExamples?: boolean
  includePracticeQuestions?: boolean
  includeKeyTerms?: boolean
  includeSummary?: boolean
} {
  const requirements: any = {}
  
  // Look for the requirements section - try multiple patterns
  // 1) Flexible header level (## to ######) and optional colon
  const requirementsMatch = content.match(/#{2,6}\s*Study\s+Guide\s+Requirements:?[\t ]*\n([\s\S]*?)(?=\n#{1,6}\s|\n---SECTION---|\n\Z)/i)
  console.log('🔍 Requirements regex match:', requirementsMatch ? 'Found' : 'Not found')
  
  const difficultyRegex = /(?:Target\s*difficulty|Difficulty)\s*(?:level)?\s*:?\s*(beginner|intermediate|advanced)/i
  
  if (!requirementsMatch) {
    // Fallback: look for any requirements-like content
    const fallbackMatch = content.match(/(Target\s+study\s+duration.*?\n.*?(?:Difficulty|Target\s*difficulty).*?\n.*?Study\s+style.*?\n)/si)
    if (fallbackMatch) {
      console.log('🔍 Using fallback requirements pattern')
      const requirementsText = fallbackMatch[1]
      console.log('🔍 Fallback requirements text:', requirementsText)
      
      // Extract from fallback
      const durationMatch = requirementsText.match(/Target study duration:\s*(\d+)\s*minutes/i)
      if (durationMatch) requirements.duration = parseInt(durationMatch[1])
      
      const difficultyMatch = requirementsText.match(difficultyRegex)
      if (difficultyMatch) requirements.difficulty = difficultyMatch[1].toLowerCase()
      
      return requirements
    }
    // Last-resort global extraction from entire content
    const globalDifficulty = content.match(difficultyRegex)
    if (globalDifficulty) {
      requirements.difficulty = globalDifficulty[1].toLowerCase()
    }
    const globalDuration = content.match(/Target\s*study\s*duration\s*:?\s*(\d+)\s*minutes/i)
    if (globalDuration) {
      requirements.duration = parseInt(globalDuration[1])
    }
    const globalStyle = content.match(/Study\s*style\s*:?\s*(\w+)/i)
    if (globalStyle) {
      requirements.style = globalStyle[1]
    }
    return requirements
  }
  
  const requirementsText = requirementsMatch[1]
  console.log('🔍 Requirements text found:', requirementsText)
  
  // Extract duration
  const durationMatch = requirementsText.match(/Target study duration:\s*(\d+)\s*minutes/i)
  if (durationMatch) {
    requirements.duration = parseInt(durationMatch[1])
    console.log('🔍 Found duration:', requirements.duration)
  }
  
  // Extract difficulty (robust)
  const difficultyMatch = requirementsText.match(difficultyRegex)
  if (difficultyMatch) {
    requirements.difficulty = difficultyMatch[1].toLowerCase()
    console.log('🔍 Found difficulty:', requirements.difficulty)
  }
  
  // Extract style
  const styleMatch = requirementsText.match(/Study\s*style\s*:?\s*(\w+)/i)
  if (styleMatch) {
    requirements.style = styleMatch[1]
  }
  
  // Extract boolean flags
  requirements.includeExamples = requirementsText.includes('Include practical examples')
  requirements.includePracticeQuestions = requirementsText.includes('Include practice questions')
  requirements.includeKeyTerms = requirementsText.includes('Highlight key terms')
  requirements.includeSummary = requirementsText.includes('Provide a comprehensive summary')
  
  return requirements
}

/**
 * Classify section based on title and header level, using user requirements when available
 */
function classifySection(title: string, headerLevel: number, userRequirements: any = {}): {
  type: StudyGuideSection['type']
  difficulty?: StudyGuideSection['difficulty']
  importance: number
  estimatedTime: number
} {
  const titleLower = title.toLowerCase()
  
  // Use user-specified difficulty as default, fallback to auto-detection
  let difficulty: StudyGuideSection['difficulty'] | undefined = userRequirements.difficulty
  
  // Default values
  let type: StudyGuideSection['type'] = 'details'
  let importance = 3
  let estimatedTime = 5
  
  // Header level influences importance
  if (headerLevel === 1) importance = 5
  else if (headerLevel === 2) importance = 4
  else importance = 3
  
  // Title-based classification
  if (titleLower.includes('overview') || titleLower.includes('introduction') || titleLower.includes('getting started')) {
    type = 'overview'
    importance = 5
    estimatedTime = 4
    if (!difficulty) difficulty = 'beginner'
  } else if (titleLower.includes('concept') || titleLower.includes('definition') || titleLower.includes('key') || titleLower.includes('term') || titleLower.includes('basic')) {
    type = 'concepts'
    importance = 4
    estimatedTime = 6
    if (!difficulty) difficulty = 'beginner'
  } else if (titleLower.includes('detail') || titleLower.includes('example') || titleLower.includes('application') || titleLower.includes('process') || titleLower.includes('how to') || titleLower.includes('advanced')) {
    type = 'details'
    importance = 3
    estimatedTime = 8
    // If title explicitly says advanced, honor it
    if (!difficulty) difficulty = titleLower.includes('advanced') ? 'advanced' : 'intermediate'
  } else if (titleLower.includes('question') || titleLower.includes('practice') || titleLower.includes('review') || titleLower.includes('quiz') || titleLower.includes('test') || titleLower.includes('exercise')) {
    type = 'questions'
    importance = 4
    estimatedTime = 10
    if (!difficulty) difficulty = 'intermediate'
  } else if (titleLower.includes('summary') || titleLower.includes('conclusion') || titleLower.includes('recap') || titleLower.includes('wrap up')) {
    type = 'summary'
    importance = 4
    estimatedTime = 3
    if (!difficulty) difficulty = 'beginner'
  } else {
    // Default classification based on user's overall difficulty preference
    if (!difficulty) {
      if (userRequirements.difficulty === 'advanced') difficulty = 'advanced'
      else if (userRequirements.difficulty === 'beginner') difficulty = 'beginner' 
      else difficulty = 'intermediate'
    }
  }
  
  return { type, difficulty, importance, estimatedTime }
}

/**
 * Extract keywords from content for search and categorization
 */
function extractKeywords(content: string): string[] {
  // Remove markdown formatting
  const cleanContent = content.replace(/[#*_`\[\]()]/g, ' ')
  
  // Extract potential keywords (capitalize words, technical terms, etc.)
  const keywords: string[] = []
  
  // Find capitalized words
  const capitalizedWords = cleanContent.match(/\b[A-Z][a-z]+\b/g) || []
  keywords.push(...capitalizedWords)
  
  // Find technical terms (CamelCase, abbreviations)
  const technicalTerms = cleanContent.match(/\b[A-Z]{2,}\b|\b[A-Z][a-z]*[A-Z]\w*\b/g) || []
  keywords.push(...technicalTerms)
  
  // Find important phrases in quotes or bold
  const importantPhrases = cleanContent.match(/"([^"]+)"|`([^`]+)`/g) || []
  keywords.push(...importantPhrases.map(phrase => phrase.replace(/["`]/g, '')))
  
  // Remove duplicates and filter out common words
  const commonWords = new Set(['the', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for', 'of', 'with', 'by', 'is', 'are', 'was', 'were', 'be', 'been', 'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could', 'should', 'may', 'might', 'can', 'this', 'that', 'these', 'those'])
  
  return [...new Set(keywords)]
    .filter(keyword => keyword.length > 2 && !commonWords.has(keyword.toLowerCase()))
    .slice(0, 10) // Limit to top 10 keywords
}

/**
 * Calculate estimated reading time for content
 */
export function calculateReadingTime(content: string): number {
  const wordsPerMinute = 200 // Average reading speed
  const words = content.split(/\s+/).length
  return Math.max(1, Math.round(words / wordsPerMinute))
}

/**
 * Generate study recommendations based on content analysis
 */
export function generateStudyRecommendations(sections: StudyGuideSection[], progress?: any): string[] {
  const recommendations: string[] = []
  
  // Check for overview section
  const hasOverview = sections.some(s => s.type === 'overview')
  if (!hasOverview) {
    recommendations.push("Consider starting with an overview to understand the big picture")
  }
  
  // Check section balance
  const conceptSections = sections.filter(s => s.type === 'concepts').length
  const detailSections = sections.filter(s => s.type === 'details').length
  
  if (conceptSections === 0) {
    recommendations.push("Focus on understanding key concepts and definitions")
  }
  
  if (detailSections > conceptSections * 2) {
    recommendations.push("Make sure you understand the concepts before diving into details")
  }
  
  // Difficulty recommendations
  const advancedSections = sections.filter(s => s.difficulty === 'advanced').length
  const totalSections = sections.length
  
  if (advancedSections > totalSections * 0.6) {
    recommendations.push("This is complex material - take breaks and review concepts regularly")
  }
  
  // Time recommendations
  const totalTime = sections.reduce((sum, s) => sum + (s.estimatedTime || 5), 0)
  if (totalTime > 45) {
    recommendations.push("Consider breaking this into multiple study sessions")
  }
  
  return recommendations
}

/**
 * Insert a mermaid diagram code block into the specified section of the guide markdown.
 * If explicit markers are present, we locate by section id; otherwise, fall back to H1 headers.
 */
export function insertMermaidDiagramIntoGuide(guideMarkdown: string, sectionId: string, mermaidCode: string): string {
  if (!guideMarkdown || !sectionId || !mermaidCode) return guideMarkdown
  const sections = parseStudyGuideContent(guideMarkdown)
  const target = sections.find(s => s.id === sectionId)
  if (!target) return guideMarkdown

  // Build the snippet to append within the target section
  const snippet = `\n\n#### Diagram\n\n\`\`\`mermaid\n${mermaidCode.trim()}\n\`\`\`\n`

  const lines = guideMarkdown.split('\n')
  let out: string[] = []
  let i = 0
  let inTarget = false
  let inserted = false
  while (i < lines.length) {
    const line = lines[i]
    // Detect explicit section marker boundaries
    if (line.trim() === '---SECTION---') {
      // Peek next line as title
      const next = lines[i + 1] || ''
      const title = next.replace(/^#+\s*/, '').trim()
      const id = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
      if (inTarget && !inserted) {
        out.push(snippet)
        inserted = true
      }
      inTarget = id === sectionId
      out.push(line)
      i++
      out.push(lines[i] || '') // push title line
      i++
      continue
    }
    // Fallback: h1 headers as section boundaries
    const h1 = line.match(/^(#)\s*(.+)$/)
    if (h1) {
      const id = h1[2].trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
      if (inTarget && !inserted) {
        out.push(snippet)
        inserted = true
      }
      inTarget = id === sectionId
      out.push(line)
      i++
      continue
    }
    out.push(line)
    i++
  }
  // If guide ended while still in target, append snippet at end
  if (inTarget && !inserted) {
    out.push(snippet)
    inserted = true
  }
  return out.join('\n')
}

/**
 * Create a study plan based on sections and user preferences
 */
export function createStudyPlan(sections: StudyGuideSection[], timeAvailable: number = 60): {
  sessions: { sections: StudyGuideSection[], estimatedTime: number }[]
  totalTime: number
} {
  const sortedSections = [...sections].sort((a, b) => {
    // Sort by importance then by type priority
    const typePriority = { overview: 1, concepts: 2, details: 3, questions: 4, summary: 5 }
    const aPriority = (a.importance || 3) * 100 + (typePriority[a.type] || 6)
    const bPriority = (b.importance || 3) * 100 + (typePriority[b.type] || 6)
    return bPriority - aPriority
  })
  
  const sessions: { sections: StudyGuideSection[], estimatedTime: number }[] = []
  let currentSession: StudyGuideSection[] = []
  let currentSessionTime = 0
  
  for (const section of sortedSections) {
    const sectionTime = section.estimatedTime || 5
    
    if (currentSessionTime + sectionTime > timeAvailable && currentSession.length > 0) {
      sessions.push({
        sections: [...currentSession],
        estimatedTime: currentSessionTime
      })
      currentSession = [section]
      currentSessionTime = sectionTime
    } else {
      currentSession.push(section)
      currentSessionTime += sectionTime
    }
  }
  
  if (currentSession.length > 0) {
    sessions.push({
      sections: currentSession,
      estimatedTime: currentSessionTime
    })
  }
  
  const totalTime = sessions.reduce((sum, s) => sum + s.estimatedTime, 0)
  
  return { sessions, totalTime }
}