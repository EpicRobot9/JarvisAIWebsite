// Study guide preset configurations for quick setup

export interface StudyGuidePreset {
  name: string
  icon: string
  description: string
  duration: number
  difficulty: 'beginner' | 'intermediate' | 'advanced'
  style: 'comprehensive' | 'outline' | 'visual' | 'interactive'
  includeExamples: boolean
  includePracticeQuestions: boolean
  includeKeyTerms: boolean
  includeSummary: boolean
  focusAreas?: string[]
  customInstructions?: string
}

export const STUDY_GUIDE_PRESETS: StudyGuidePreset[] = [
  {
    name: 'Quick Review',
    icon: '⚡',
    description: 'Fast overview for last-minute studying',
    duration: 15,
    difficulty: 'beginner',
    style: 'outline',
    includeExamples: false,
    includePracticeQuestions: false,
    includeKeyTerms: true,
    includeSummary: true,
    customInstructions: 'Focus on key points and essential concepts. Use bullet points and concise explanations.'
  },
  {
    name: 'Deep Dive',
    icon: '🔬',
    description: 'Comprehensive study for thorough understanding',
    duration: 90,
    difficulty: 'advanced',
    style: 'comprehensive',
    includeExamples: true,
    includePracticeQuestions: true,
    includeKeyTerms: true,
    includeSummary: true,
    customInstructions: 'Provide detailed explanations, multiple examples, and challenging practice questions. Include real-world applications and edge cases.'
  },
  {
    name: 'Exam Prep',
    icon: '🎯',
    description: 'Test-focused preparation with practice questions',
    duration: 45,
    difficulty: 'intermediate',
    style: 'interactive',
    includeExamples: true,
    includePracticeQuestions: true,
    includeKeyTerms: true,
    includeSummary: true,
    customInstructions: 'Emphasize testable concepts and common exam topics. Include varied question types and detailed answer explanations.'
  },
  {
    name: 'Visual Learner',
    icon: '🎨',
    description: 'Diagram-heavy guide with visual explanations',
    duration: 60,
    difficulty: 'intermediate',
    style: 'visual',
    includeExamples: true,
    includePracticeQuestions: false,
    includeKeyTerms: true,
    includeSummary: true,
    customInstructions: 'Use diagrams, flowcharts, and visual metaphors. Describe concepts in visual terms and suggest drawing exercises.'
  },
  {
    name: 'Beginner Friendly',
    icon: '🌱',
    description: 'Gentle introduction for newcomers',
    duration: 45,
    difficulty: 'beginner',
    style: 'comprehensive',
    includeExamples: true,
    includePracticeQuestions: true,
    includeKeyTerms: true,
    includeSummary: true,
    customInstructions: 'Use simple language and build concepts gradually. Provide plenty of context and avoid jargon.'
  },
  {
    name: 'Reference Guide',
    icon: '📖',
    description: 'Structured reference for future lookup',
    duration: 30,
    difficulty: 'intermediate',
    style: 'outline',
    includeExamples: true,
    includePracticeQuestions: false,
    includeKeyTerms: true,
    includeSummary: false,
    customInstructions: 'Create a well-organized reference with clear sections, definitions, and examples. Focus on searchability and quick lookup.'
  },
  {
    name: 'Interactive Session',
    icon: '🎮',
    description: 'Hands-on learning with exercises',
    duration: 75,
    difficulty: 'intermediate',
    style: 'interactive',
    includeExamples: true,
    includePracticeQuestions: true,
    includeKeyTerms: true,
    includeSummary: true,
    customInstructions: 'Include step-by-step exercises, interactive elements, and "try it yourself" sections. Make it engaging and hands-on.'
  }
]

export function applyPreset(preset: StudyGuidePreset) {
  return {
    studyDuration: preset.duration,
    targetDifficulty: preset.difficulty,
    studyStyle: preset.style,
    includeExamples: preset.includeExamples,
    includePracticeQuestions: preset.includePracticeQuestions,
    includeKeyTerms: preset.includeKeyTerms,
    includeSummary: preset.includeSummary,
    focusAreas: preset.focusAreas || [],
    customInstructions: preset.customInstructions || ''
  }
}