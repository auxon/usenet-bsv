import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '../lib/api';
import { buildThreads, countReplies, sats } from '../lib/format';
import Composer from '../components/Composer';

export default function Group() {
  const { name } = useParams();
  const navigate = useNavigate();
  const [group, setGroup] = useState(null);
  const [articles, setArticles] = useState(null);
  const [error, setError] = useState(null);
  const [composing, setComposing] = useState(false);

  const load = useCallback(() => {
    setError(null);
    Promise.all([api.group(name), api.feed(name, { limit: 200 })])
      .then(([g, f]) => {
        setGroup(g);
        setArticles(f.articles ?? []);
      })
      .catch((e) => setError(e.message));
  }, [name]);

  useEffect(() => {
    setGroup(null);
    setArticles(null);
    load();
  }, [load]);

  const threads = useMemo(() => (articles ? buildThreads(articles) : []), [articles]);

  if (error) {
    return (
      <div className="page page-narrow">
        <div className="alert alert-error">{error}</div>
        <Link className="btn btn-ghost" to="/groups">
          ← All groups
        </Link>
      </div>
    );
  }

  return (
    <div className="page">
      <div className="group-header">
        <div style={{ minWidth: 0 }}>
          <h1>
            <span>#</span>
            {name}
          </h1>
          {group ? <p className="desc">{group.description || 'No description yet.'}</p> : null}
          {group ? (
            <div className="facts">
              <span className="badge badge-amber">post {sats(group.postPriceSats)} sats</span>
              {group.readPriceDefault > 0 ? (
                <span className="badge badge-blue">default read {sats(group.readPriceDefault)} sats</span>
              ) : (
                <span className="badge badge-green">reads free by default</span>
              )}
              <span className="badge">{sats(group.articleCount)} posts</span>
              <span className="badge">
                owner {group.owner ? `${group.owner.slice(0, 12)}…` : '—'}
              </span>
            </div>
          ) : null}
        </div>
        <div className="actions">
          <button className="btn btn-ghost" onClick={load} title="Refresh">
            ↻ Refresh
          </button>
          <button className="btn btn-primary" onClick={() => setComposing(true)} disabled={!group}>
            New post · {group ? sats(group.postPriceSats) : '…'} sats
          </button>
        </div>
      </div>

      {articles === null ? (
        <div className="load-row">
          <div className="skeleton" /><div className="skeleton" /><div className="skeleton" />
        </div>
      ) : threads.length === 0 ? (
        <div className="empty">
          <h3>Nothing here yet</h3>
          <p>Start the first thread in #{name}.</p>
        </div>
      ) : (
        <div className="thread-list">
          {threads.map((t) => (
            <Link key={t.id} className="thread-row" to={`/g/${encodeURIComponent(name)}/a/${t.id}`}>
              <div className="thread-top">
                <span className="thread-subject">{t.subject}</span>
                <span className="badges">
                  {countReplies(t) > 0 ? (
                    <span className="badge">
                      {countReplies(t)} {countReplies(t) === 1 ? 'reply' : 'replies'}
                    </span>
                  ) : null}
                  {t.readPriceSats > 0 ? (
                    <span className="badge badge-amber">{sats(t.readPriceSats)} sats</span>
                  ) : (
                    <span className="badge badge-green">free</span>
                  )}
                </span>
              </div>
              <div className="thread-preview">{t.preview}</div>
              <div className="thread-meta">
                <span>{t.from}</span>
                <span className="sep" />
                <span>{new Date(t.createdAt).toLocaleDateString()}</span>
              </div>
            </Link>
          ))}
        </div>
      )}

      {composing && group ? (
        <Composer
          group={group}
          onClose={() => setComposing(false)}
          onPosted={(article) => {
            setComposing(false);
            navigate(`/g/${encodeURIComponent(name)}/a/${article.id}`);
          }}
        />
      ) : null}
    </div>
  );
}
