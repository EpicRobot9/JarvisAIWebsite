import React from 'react'

// Generic integration item that can be dragged into the board
export type IntegrationItem = {
  id: string
  title: string
  subtitle?: string
  href?: string // optional deep link to open when clicked
  kind: string  // e.g., 'studySet'
  // Serialized payload placed on dataTransfer under 'application/x-board-integration'
  dragPayload: any
}

export type IntegrationProvider = {
  id: string
  name: string
  icon?: React.ReactNode
  // Load latest items to show in the drawer
  loadItems: () => Promise<IntegrationItem[]>
}

// Registry pattern to allow easy future additions
const providers: IntegrationProvider[] = []

export function registerIntegrationProvider(p: IntegrationProvider) {
  providers.push(p)
}

export function getIntegrationProviders(): IntegrationProvider[] {
  return providers.slice()
}
