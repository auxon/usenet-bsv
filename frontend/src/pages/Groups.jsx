import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api';
import { sats } from '../lib/format';
import CreateGroupModal from '../components/CreateGroupModal';

export default function Groups() {
  const [groups, setGroups] = useState(null);
  const [error, setError] = useState(null);
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState('posts');
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    api
      .groups()
      .then((d) => setGroups(d.groups ?? []))
      .catch((e) => setError(e.message));
  }, []);

  const filtered = useMemo(() => {
    let list = groups ?? [];
    const q = query.trim().toLowerCase();
    if (q) list = list.filter((g) => g.name.toLowerCase().includes(q) || (g.description ?? '').toLowerCase().includes(q));
    const sorted = [...list];
    if (sort === 'posts') sorted.sort((a, b) => b.articleCount - a.articleCount || a.name.localeCompare(b.name));
    if (sort === 'new') sorted.sort((a, b) => b.createdAt - a.createdAt);
    if (sort === 'name') sorted.sort((a, b) => a.name.localeCompare(b.name));
    return sorted;
  }, [groups, query, sort]);

  return (
    <div className="page">
      <div className="group-header">
        <div>
          <h1 style={{ fontFamily: 'var(--font-display)', fontSize: '1.9rem', letterSpacing: '-0.025em' }}>Groups</h1>
          <p className="desc">Every group sets its own post and read prices. Creating one costs 500 sats.</p>
        </div>
        <div className="actions">
          <button className="btn btn-primary" onClick={() => setCreating(true)}>
            Create group
          </button>
        </div>
      </div>

      <div className="panel" style={{ display: 'flex', gap: '0.7rem', flexWrap: 'wrap', marginBottom: '1.2rem', padding: '0.9rem' }}>
        <input
          className="input"
          style={{ flex: 1, minWidth: 220 }}
          placeholder="Search groups…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <select className="select" style={{ width: 170 }} value={sort} onChange={(e) => setSort(e.target.value)}>
          <option value="posts">Most posts</option>
          <option value="new">Newest</option>
          <option value="name">A → Z</option>
        </select>
      </div>

      {error ? <div className="alert alert-error">{error}</div> : null}

      {groups === null ? (
        <div className="grid-cards">
          <div className="skeleton" style={{ height: 130 }} />
          <div className="skeleton" style={{ height: 130 }} />
          <div className="skeleton" style={{ height: 130 }} />
        </div>
      ) : filtered.length === 0 ? (
        <div className="empty">
          <h3>{query ? 'No matches' : 'No groups yet'}</h3>
          <p>{query ? 'Try a different search.' : 'Be the first to create one.'}</p>
        </div>
      ) : (
        <div className="grid-cards">
          {filtered.map((g) => (
            <Link key={g.id} to={`/g/${encodeURIComponent(g.name)}`} className="card card-hover group-card">
              <div className="name">{g.name}</div>
              <div className="desc">{g.description || 'No description yet.'}</div>
              <div className="meta">
                <span className="badge badge-amber">post {sats(g.postPriceSats)}</span>
                {g.readPriceDefault > 0 ? (
                  <span className="badge badge-blue">read {sats(g.readPriceDefault)}</span>
                ) : (
                  <span className="badge badge-green">read free</span>
                )}
                <span className="count">{sats(g.articleCount)} posts</span>
              </div>
            </Link>
          ))}
        </div>
      )}

      {creating ? (
        <CreateGroupModal
          onClose={() => setCreating(false)}
          onCreated={(g) => {
            setCreating(false);
            setGroups((list) => [g, ...(list ?? [])]);
          }}
        />
      ) : null}
    </div>
  );
}
