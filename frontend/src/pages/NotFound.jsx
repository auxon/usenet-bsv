import React from 'react';
import { Link } from 'react-router-dom';

export default function NotFound() {
  return (
    <div className="page page-narrow">
      <div className="empty">
        <h3>Not found</h3>
        <p>
          That route does not exist. <Link to="/">← Back home</Link>
        </p>
      </div>
    </div>
  );
}
