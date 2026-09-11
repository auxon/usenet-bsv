import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api';
import ArticleRow from '../components/ArticleRow';

export default function Latest() {
  const [articles, setArticles] = useState(null);
  const [error, setError] = useState(null);
  const [limit, setLimit] = useState(30);

  useEffect(() => {
    api
      .latest(limit)
      .then((d) => setArticles(d.articles ?? []))
      .catch((e) => setError(e.message));
  }, [limit]);

  return (
    <div className="page page-narrow">
      <div className="section-head" style={{ marginTop: 0 }}>
        <h2 style={{ fontSize: '1.7rem' }}>Latest posts</h2>
        <select className="select" style={{ width: 130 }} value={limit} onChange={(e) => setLimit(Number(e.target.value))}>
          <option value={15}>15</option>
          <option value={30}>30</option>
          <option value={50}>50</option>
        </select>
      </div>
      <p style={{ color: 'var(--muted)', fontSize: '0.9rem', marginBottom: '1.2rem' }}>
        Newest articles across every group. Preview text is always free; priced posts ask for sats when you open
        them.
      </p>

      {error ? <div className="alert alert-error">{error}</div> : null}

      {articles === null ? (
        <div className="load-row">
          <div className="skeleton" /><div className="skeleton" /><div className="skeleton" />
        </div>
      ) : articles.length === 0 ? (
        <div className="empty">
          <h3>Nothing yet</h3>
          <p>
            <Link to="/groups">Create a group</Link> and make the first post.
          </p>
        </div>
      ) : (
        <div className="thread-list">
          {articles.map((a) => (
            <ArticleRow key={a.id} article={a} groupName={a.groupName} showGroup replies={a.replyCount ?? 0} />
          ))}
        </div>
      )}
    </div>
  );
}
