# Flashcard System Documentation

## Overview

The flashcard system provides a comprehensive learning experience with two main interfaces:
1. **Flashcard Viewer** - Browse and review cards
2. **Study Mode** - Interactive game-based learning

## Routing Structure

### Updated Routes (September 2025)

The flashcard system has been restructured to provide better user experience:

```
/study/sets/:id/flashcards   → Main flashcard viewer (browse cards)
/study/sets/:id/study        → Interactive study mode (game)
```

**Previous routes (now removed):**
- `/study/sets/:id/cards` → Redirected to `/study/sets/:id/flashcards`

## User Experience Flow

### From Study Dashboard
1. User sees flashcard sets in "My Flash Card Sets" section
2. **"Study"** button → Goes directly to interactive study mode (`/study/sets/:id/study`)
3. **"View Cards"** button → Goes to flashcard viewer (`/study/sets/:id/flashcards`)
4. **"Open"** button → Removed (no longer needed)

### From Flashcard Viewer (`/study/sets/:id/flashcards`)
- **Primary interface** for browsing flashcards
- Shows all cards with front/back reveal functionality
- **"Study Mode"** button → Links to interactive study game
- **Bidirectional linking** → Shows link to source study guide if applicable
- **Back button** → Returns to main study set page

### From Study Mode (`/study/sets/:id/study`)
- Interactive game with lives, scoring, timer
- AI grading and feedback
- **Different end screens** based on performance:
  - **Win scenario**: Green theme, congratulations, suggestions for continued learning
  - **Lose scenario**: Orange theme, supportive feedback, specific study tips
- **Back button** → Returns to flashcard viewer (not main study set)

## Features

### Flashcard Viewer Features
- **Card Browsing**: View all flashcards with click-to-reveal functionality
- **Responsive Design**: Cards displayed in grid layout
- **Navigation**: Easy access to study mode and source materials
- **Linked Content**: Shows connection to source study guide when applicable

### Study Mode Features
- **Lives System**: Start with 3 lives, lose one for each incorrect answer
- **Scoring**: 10 points per correct answer
- **Timer**: Configurable time limit per question (5-180 seconds)
- **AI Grading**: Intelligent assessment of free-form answers
- **Spaced Repetition**: Optional SRS mode for optimized learning
- **Performance Tracking**: Tracks wrong answers for personalized feedback

### AI Feedback System
The system provides different AI-generated feedback based on performance:

#### When All Lives Are Lost
- **Supportive tone** with encouraging language
- **Specific study tips** based on actual wrong answers
- **Actionable advice** like mnemonics, concept breakdown, focused review
- **Motivation** to try again with confidence

#### When Successfully Completing
- **Celebratory tone** with congratulations
- **Achievement recognition** for the score and effort
- **Growth suggestions** for continued learning
- **Next steps** for building on success

#### For Mixed Results
- **Balanced feedback** acknowledging progress
- **Gentle improvement suggestions** based on mistakes
- **Encouragement** for continued practice

## Technical Implementation

### Components
- **FlashcardsView.tsx** → Main card viewer interface
- **FlashcardsGame.tsx** → Interactive study mode
- **StudyDashboard.tsx** → Entry point with updated buttons

### State Management
- **Wrong Answer Tracking**: Stores incorrect responses for AI feedback
- **Performance Metrics**: Lives, score, time tracking
- **Bidirectional Links**: LocalStorage-based linking to source guides

### Routing Updates
Updated `main.jsx` routing:
```javascript
<Route path="/study/sets/:id/flashcards" element={<FlashcardsView />} />
<Route path="/study/sets/:id/study" element={<FlashcardsGame />} />
```

## Benefits of New Structure

1. **Clearer User Journey**: Distinct interfaces for browsing vs. studying
2. **Reduced Confusion**: No more redundant "Open" buttons
3. **Better Performance**: Focused components for specific tasks
4. **Enhanced Feedback**: AI-powered personalized learning guidance
5. **Improved Navigation**: Logical flow between related interfaces

## Migration Notes

- All existing flashcard sets automatically work with new routes
- Old `/cards` routes redirect to new `/flashcards` routes
- Study mode now accessible via `/study` instead of `/flashcards`
- Enhanced AI feedback requires no migration - works with existing data