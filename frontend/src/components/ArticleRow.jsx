import React from 'react';
import { Link } from 'react-router-dom';
import { sats, shortAddr, timeAgo } from '../lib/format';

export default function ArticleRow({ article, groupName, showGroup = false, replies = 0 }) {
  return (
    <Link className="thread-row" to={groupName ? `/g/${encodeURIComponent(groupName)}/a/${article.id}` : '#'}>
      <div className="thread-top">
        <span className="thread-subject">{article.subject}</span>
        <span className="badges">
          {showGroup && article.groupName ? <span className="badge badge-blue">#{article.groupName}</span> : null}
          {replies > 0 ? (
            <span className="badge">
              {replies} {replies === 1 ? 'reply' : 'replies'}
            </span>
          ) : null}
          {article.readPriceSats > 0 ? (
            <span className="badge badge-amber">{sats(article.readPriceSats)} sats</span>
          ) : (
            <span className="badge badge-green">free</span>
          )}
        </span>
      </div>
      <div className="thread-preview">{article.preview}</div>
      <div className="thread-meta">
        <span>{shortAddr(article.from ?? article.author)}</span>
        <span className="sep" />
        <span>{timeAgo(article.createdAt)}</span>
      </div>
    </Link>
  );
}
