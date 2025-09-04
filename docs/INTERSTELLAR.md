# Interstellar Manager

## Overview
The Interstellar Manager is a UI for managing Interstellar codespaces through n8n integrations. It provides granular control over current and backup codespaces, with separate production and test environments.

## Endpoints & Modes

Interstellar Manager uses four configurable n8n webhook endpoints, editable via the Admin Panel:

1. **GET (Sheets)**
   - Prod: `https://n8n.srv955268.hstgr.cloud/webhook/1611dc49-d04f-418f-9252-d8af42370ade`
   - Test: `https://n8n.srv955268.hstgr.cloud/webhook-test/1611dc49-d04f-418f-9252-d8af42370ade`

2. **POST (Actions)**
   - Prod: `https://n8n.srv955268.hstgr.cloud/webhook/59b49ae8-76dc-4ba2-848d-16d728fe136d`
   - Test: `https://n8n.srv955268.hstgr.cloud/webhook-test/59b49ae8-76dc-4ba2-848d-16d728fe136d`

To edit endpoints:
1. Go to Admin → "Interstellar Webhook URLs"
2. Enter URLs for both Prod and Test environments
3. Click "Save URLs"

The UI respects the Prod/Test toggle state, which persists across sessions.

## Actions & Behavior

- **Start All**: Starts all current Interstellar codespaces
- **Stop All**: Stops all running codespaces (including backups)
- **New Backups** (admin only): Creates two backup codespaces. This will stop current links during the process.
- **Swap**: Updates current links to point to backup links
- **Report Blocked**: Reports a blocked codespace by full name

## Request/Response Shapes

### GET Request
```json
{ "TypeOfInfo": "Sheets" }
```

### GET Response
```json
[
  {
    "CurrentCodespaces": [
      {
        "row_number": 2,
        "display_name": "...",
        "full_codespace_name": "...",
        "repository": "Interstellar",
        "start_url": "...",
        "stop_url": "...",
        "public_url": "..."  // Note: normalized from "Public URL"
      }
    ],
    "BackUpCodespaces": [
      // Same shape as CurrentCodespaces
    ]
  }
]
```

### POST Request Bodies
```json
// Start all current codespaces
[{ "TypeOfAction": "Start" }]

// Stop all codespaces (current & backup)
[{ "TypeOfAction": "Stop" }]

// Create new backups (admin only)
[{ "TypeOfAction": "NewBackUp" }]

// Update current links to backup links
[{ "TypeOfAction": "Swap" }]

// Report a blocked codespace
[{ "TypeOfAction": "Blocked", "BlockedCodespaceFullName": "..." }]
```

### POST Response
```json
[{ "Success": true }]
// or
[{ "Success": false }]
```

## Permissions

- Most actions are available to all authenticated users
- **New Backups** action requires admin role

## UI Map

1. Access Interstellar Manager from the Jarvis Manager view
2. Return via "Back to Jarvis Manager" button in the header
3. Environment toggle (Prod/Test) affects all API calls

## Error Handling

- Network failures show error toast/banner
- Success responses trigger brief success message
- All successful POST actions auto-refresh the GET data
- Failed POST requests allow retry
- Validation errors (e.g. missing codespace name) show inline

## Changelog

**August 31, 2025**
- Added Interstellar Manager UI with n8n integration
- Added editable endpoints in Admin Panel (Prod/Test for GET/POST)
- Added admin-gated NewBackUp action with confirmation
- Added Swap and Blocked codespace flows
- Added documentation and updated Admin Panel
