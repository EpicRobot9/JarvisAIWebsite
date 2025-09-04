#!/usr/bin/env node

// Test script to verify Interstellar HTTP requests
const fetch = require('node-fetch');

const BASE_URL = 'http://localhost:8080';

async function testInterstellarAPIs() {
  console.log('Testing Interstellar APIs...\n');

  try {
    // Test 1: Get Interstellar URLs
    console.log('1. Testing /api/interstellar-urls');
    const urlsResponse = await fetch(`${BASE_URL}/api/interstellar-urls`);
    if (urlsResponse.ok) {
      const urls = await urlsResponse.json();
      console.log('✓ URLs retrieved:', JSON.stringify(urls, null, 2));
      
      // Check if URLs are configured
      if (!urls.prod.get || !urls.prod.post) {
        console.log('⚠️  Production URLs not configured');
      }
      if (!urls.test.get || !urls.test.post) {
        console.log('⚠️  Test URLs not configured');
      }
    } else {
      console.log('✗ Failed to get URLs:', urlsResponse.status);
    }

    // Test 2: Test get-codespaces endpoint
    console.log('\n2. Testing /api/interstellar/get-codespaces');
    const codespacesResponse = await fetch(`${BASE_URL}/api/interstellar/get-codespaces`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ env: 'test' })
    });
    
    if (codespacesResponse.ok) {
      const data = await codespacesResponse.json();
      console.log('✓ Codespaces request successful:', data);
    } else {
      const error = await codespacesResponse.text();
      console.log('✗ Codespaces request failed:', codespacesResponse.status, error);
    }

    // Test 3: Test control endpoint
    console.log('\n3. Testing /api/interstellar/control');
    const controlResponse = await fetch(`${BASE_URL}/api/interstellar/control`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'Start', env: 'test' })
    });
    
    if (controlResponse.ok) {
      const data = await controlResponse.json();
      console.log('✓ Control request successful:', data);
    } else {
      const error = await controlResponse.text();
      console.log('✗ Control request failed:', controlResponse.status, error);
    }

  } catch (error) {
    console.error('Test error:', error);
  }
}

testInterstellarAPIs();
