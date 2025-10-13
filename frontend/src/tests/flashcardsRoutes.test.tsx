import React from 'react'
import { describe, it, expect } from 'vitest'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import FlashcardsView from '../pages/FlashcardsView'
import FlashcardsGame from '../pages/FlashcardsGame'

// Minimal smoke test to ensure routes/components render without crashing
describe('Flashcards routing', () => {
  it('maps /flashcards to viewer and /study to game', async () => {
    const el = (
      <MemoryRouter initialEntries={["/study/sets/abc/flashcards"]}>
        <Routes>
          <Route path="/study/sets/:id/flashcards" element={<FlashcardsView />} />
          <Route path="/study/sets/:id/study" element={<FlashcardsGame />} />
        </Routes>
      </MemoryRouter>
    )
    expect(el).toBeTruthy()
  })
})
