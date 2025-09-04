import { type ReactNode } from 'react';

interface InterstellarUrlsType {
  prod: { get: string; post: string };
  test: { get: string; post: string };
}

interface Props {
  interstellarUrls: InterstellarUrlsType;
  setInterstellarUrls: (urls: InterstellarUrlsType) => void;
  savingUrls: boolean;
  savedUrls: boolean;
  saveInterstellarUrls: () => Promise<void>;
}

export function WebhookUrlsSection({
  interstellarUrls,
  setInterstellarUrls,
  savingUrls,
  savedUrls,
  saveInterstellarUrls
}: Props) {
  return (
    <div className="mb-6">
      <h2 className="text-lg font-semibold mb-2 text-cyan-300">Interstellar Webhook URLs</h2>
      <div className="grid md:grid-cols-2 gap-3">
        <div className="p-3 rounded-xl border border-cyan-200/20">
          <div className="flex items-start justify-between gap-3">
            <div className="flex-1">
              <div className="font-medium">Prod GET URL</div>
              <div className="text-xs jarvis-subtle">Used for fetching codespace status in Prod mode.</div>
              <input
                type="url"
                className="mt-2 w-full px-2 py-1 rounded bg-black/20 border border-cyan-200/20 font-mono text-xs"
                placeholder="https://n8n.example.com/webhook/sheets"
                value={interstellarUrls.prod.get}
                onChange={e=>setInterstellarUrls({
                  ...interstellarUrls,
                  prod: { ...interstellarUrls.prod, get: e.target.value }
                })}
              />
            </div>
          </div>
        </div>
        <div className="p-3 rounded-xl border border-cyan-200/20">
          <div className="flex items-start justify-between gap-3">
            <div className="flex-1">
              <div className="font-medium">Prod POST URL</div>
              <div className="text-xs jarvis-subtle">Used for codespace actions in Prod mode.</div>
              <input
                type="url"
                className="mt-2 w-full px-2 py-1 rounded bg-black/20 border border-cyan-200/20 font-mono text-xs"
                placeholder="https://n8n.example.com/webhook/actions"
                value={interstellarUrls.prod.post}
                onChange={e=>setInterstellarUrls({
                  ...interstellarUrls,
                  prod: { ...interstellarUrls.prod, post: e.target.value }
                })}
              />
            </div>
          </div>
        </div>
        <div className="p-3 rounded-xl border border-cyan-200/20">
          <div className="flex items-start justify-between gap-3">
            <div className="flex-1">
              <div className="font-medium">Test GET URL</div>
              <div className="text-xs jarvis-subtle">Used for fetching codespace status in Test mode.</div>
              <input
                type="url"
                className="mt-2 w-full px-2 py-1 rounded bg-black/20 border border-cyan-200/20 font-mono text-xs"
                placeholder="https://n8n.example.com/webhook-test/sheets"
                value={interstellarUrls.test.get}
                onChange={e=>setInterstellarUrls({
                  ...interstellarUrls,
                  test: { ...interstellarUrls.test, get: e.target.value }
                })}
              />
            </div>
          </div>
        </div>
        <div className="p-3 rounded-xl border border-cyan-200/20">
          <div className="flex items-start justify-between gap-3">
            <div className="flex-1">
              <div className="font-medium">Test POST URL</div>
              <div className="text-xs jarvis-subtle">Used for codespace actions in Test mode.</div>
              <input
                type="url"
                className="mt-2 w-full px-2 py-1 rounded bg-black/20 border border-cyan-200/20 font-mono text-xs"
                placeholder="https://n8n.example.com/webhook-test/actions"
                value={interstellarUrls.test.post}
                onChange={e=>setInterstellarUrls({
                  ...interstellarUrls,
                  test: { ...interstellarUrls.test, post: e.target.value }
                })}
              />
            </div>
          </div>
        </div>
      </div>
      <div className="mt-2 flex items-center gap-2">
        <button
          className="px-3 py-1 rounded-xl border border-cyan-200/20 disabled:opacity-50"
          disabled={savingUrls}
          onClick={saveInterstellarUrls}>
          Save URLs
        </button>
        {savingUrls && <span className="text-xs jarvis-subtle">Saving…</span>}
        {savedUrls && <span className="text-xs text-green-400">Saved</span>}
      </div>
    </div>
  )
}
