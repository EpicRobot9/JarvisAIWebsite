import React from 'react'
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom'
import App from './App'
import Admin from './pages/Admin'
import SignIn from './pages/SignIn'
import SignUp from './pages/SignUp'
import InterstellarManager from './pages/InterstellarManager'
import InterstellarAdmin from './pages/InterstellarAdmin'
import AwaitingApproval from './pages/AwaitingApproval'

export default function AppRoutes() {
  return (
    <Router>
      <Routes>
        <Route path="/" element={<App />} />
        <Route path="/admin" element={<Admin />} />
        <Route path="/interstellar" element={<InterstellarManager />} />
        <Route path="/admin/interstellar" element={<InterstellarAdmin />} />
        <Route path="/signin" element={<SignIn />} />
        <Route path="/signup" element={<SignUp />} />
        <Route path="/awaiting-approval" element={<AwaitingApproval />} />
      </Routes>
    </Router>
  )
}
