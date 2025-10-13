import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import './index.css'
import App from './App'
import SignIn from './pages/SignIn'
import SignUp from './pages/SignUp'
import Admin from './pages/Admin'
import AwaitingApproval from './pages/AwaitingApproval'
import InterstellarManager from './pages/InterstellarManager'
import InterstellarAdmin from './pages/InterstellarAdmin'
import Page from '../app/(ui)/page'
import JarvisNotes from './pages/JarvisNotes'
import NotesSettings from './pages/NotesSettings'
import StudyDashboard from './pages/StudyDashboard'
import StudySetView from './pages/StudySetView'
import FlashcardsGame from './pages/FlashcardsGame'
import FlashcardsView from './pages/FlashcardsView'
import TestMode from './pages/TestMode'
import MatchGame from './pages/MatchGame'
import ImportPage from './pages/Import'
import Bookmarks from './pages/Bookmarks'
import RoleplayPage from './pages/Roleplay'
import GraphPage from './pages/Graph'
import SharedSetsPage from './pages/SharedSets'
import SharedSetViewPage from './pages/SharedSetView'
import QuizHostPage from './pages/QuizHost'
import QuizJoinPage from './pages/QuizJoin'
import QuizSummaryPage from './pages/QuizSummary'
import PastGamesPage from './pages/PastGames'
import EnhancedStudyGuideView from './pages/EnhancedStudyGuideView'
import { ToastProvider } from './components/ToastHost'

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
      <ToastProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<Page />} />
          <Route path="/portal" element={<App />} />
          <Route path="/admin" element={<Admin />} />
          <Route path="/admin/interstellar" element={<InterstellarAdmin />} />
          <Route path="/interstellar" element={<InterstellarManager />} />
          <Route path="/notes" element={<JarvisNotes />} />
          <Route path="/notes/settings" element={<NotesSettings />} />
          <Route path="/study" element={<StudyDashboard />} />
          <Route path="/study/sets/:id" element={<StudySetView />} />
          <Route path="/study/sets/:id/enhanced" element={<EnhancedStudyGuideView />} />
          <Route path="/study/sets/:id/flashcards" element={<FlashcardsView />} />
          <Route path="/study/sets/:id/study" element={<FlashcardsGame />} />
          {/* Legacy route redirect */}
          <Route path="/study/sets/:id/cards" element={<Navigate to="../flashcards" replace />} />
          <Route path="/study/sets/:id/test" element={<TestMode />} />
          <Route path="/study/sets/:id/match" element={<MatchGame />} />
          <Route path="/import" element={<ImportPage />} />
          <Route path="/bookmarks" element={<Bookmarks />} />
          <Route path="/roleplay" element={<RoleplayPage />} />
          <Route path="/graph" element={<GraphPage />} />
          <Route path="/shared" element={<SharedSetsPage />} />
          <Route path="/study/shared/:id" element={<SharedSetViewPage />} />
          <Route path="/quiz/host/:setId" element={<QuizHostPage />} />
          <Route path="/quiz/join" element={<QuizJoinPage />} />
          <Route path="/quiz/join/:roomId" element={<QuizJoinPage />} />
          <Route path="/quiz/summary/:roomId" element={<QuizSummaryPage />} />
          <Route path="/quiz/past" element={<PastGamesPage />} />
          <Route path="/signin" element={<SignIn />} />
          <Route path="/signup" element={<SignUp />} />
          <Route path="/awaiting" element={<AwaitingApproval />} />
          {/** Dashboard removed; portal is the only app surface */}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
      </ToastProvider>
  </React.StrictMode>
)

// Register service worker (production only)
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {/* no-op */})
  })
}
