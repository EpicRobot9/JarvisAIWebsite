import { useEffect, useState } from 'react'
import { useNavigate, Link } from 'react-router-dom'

export default function Admin() {
  const nav = useNavigate()
  const [me, setMe] = useState(null)
  const [users, setUsers] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    ;(async () => {
      try {
        const r = await fetch('/api/auth/me', { credentials: 'include', cache: 'no-store' })
        const t = await r.text()
        const m = t ? JSON.parse(t) : null
        setMe(m)
        if (!m || m.role !== 'admin') {
          nav('/signin')
          return
        }
        const u = await fetch('/api/admin/users', { credentials: 'include' })
        if (!u.ok) throw new Error(`Failed to load users: ${u.status}`)
        setUsers(await u.json())
      } catch (e) {
        setError(String(e))
      } finally {
        setLoading(false)
      }
    })()
  }, [])

  async function setRole(userId, role) {
    try {
      const r = await fetch('/api/admin/set-role', { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify({ userId, role }) })
      if (!r.ok) throw new Error('set-role failed')
      setUsers(u => u.map(x => x.id === userId ? { ...x, role } : x))
    } catch (e) { setError(String(e)) }
  }
  async function delUser(userId) {
    if (!confirm('Delete this user? This cannot be undone.')) return
    try {
      const r = await fetch('/api/admin/delete', { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify({ userId }) })
      if (!r.ok) throw new Error('delete failed')
      setUsers(u => u.filter(x => x.id !== userId))
    } catch (e) { setError(String(e)) }
  }
  async function resetPw(userId) {
    const newPassword = prompt('Enter a new password (min 6 chars):')
    if (!newPassword) return
    try {
      const r = await fetch('/api/admin/reset-password', { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify({ userId, newPassword }) })
      if (!r.ok) throw new Error('reset-password failed')
      alert('Password reset.')
    } catch (e) { setError(String(e)) }
  }

  return (
    <div className="p-4 max-w-5xl mx-auto">
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-xl font-semibold text-cyan-300">Admin Panel</h1>
        <div className="flex gap-2 text-sm">
          <Link to="/" className="px-3 py-2 rounded-xl border border-cyan-200/20">Home</Link>
          <Link to="/portal" className="px-3 py-2 rounded-xl border border-cyan-200/20">Portal</Link>
        </div>
      </div>
      {loading && <div>Loading…</div>}
      {error && <div className="text-red-400 text-sm mb-2">{error}</div>}
      {!loading && !error && (
        <div className="glass rounded-2xl p-4">
          <table className="w-full text-sm">
            <thead className="text-left text-slate-400">
              <tr>
                <th className="py-2">Email</th>
                <th>Role</th>
                <th>Status</th>
                <th>Joined</th>
                <th className="text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {users.map(u => (
                <tr key={u.id} className="border-t border-cyan-200/10">
                  <td className="py-2">{u.email}</td>
                  <td>{u.role}</td>
                  <td>{u.status}</td>
                  <td>{new Date(u.createdAt).toLocaleString()}</td>
                  <td className="text-right">
                    {u.role === 'admin' ? (
                      <button className="px-2 py-1 rounded-xl border border-cyan-200/20 mr-2" onClick={()=>setRole(u.id,'user')}>Make user</button>
                    ) : (
                      <button className="px-2 py-1 rounded-xl border border-cyan-200/20 mr-2" onClick={()=>setRole(u.id,'admin')}>Make admin</button>
                    )}
                    <button className="px-2 py-1 rounded-xl border border-cyan-200/20 mr-2" onClick={()=>resetPw(u.id)}>Reset PW</button>
                    <button className="px-2 py-1 rounded-xl border border-red-400/30 text-red-300" onClick={()=>delUser(u.id)}>Delete</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
