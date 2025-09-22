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

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
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
          <Route path="/study/sets/:id/flashcards" element={<FlashcardsGame />} />
          <Route path="/signin" element={<SignIn />} />
          <Route path="/signup" element={<SignUp />} />
          <Route path="/awaiting" element={<AwaitingApproval />} />
          {/** Dashboard removed; portal is the only app surface */}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
  </React.StrictMode>
)
