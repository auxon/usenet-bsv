import React, { useState } from 'react';
import { copyText } from '../lib/format';

export default function CopyChip({ value, prefix, label }) {
  const [copied, setCopied] = useState(false);
  const shown = value?.length > 30 ? `${value.slice(0, 18)}…${value.slice(-8)}` : value;

  async function onCopy() {
    await copyText(value);
    setCopied(true);
    setTimeout(() => setCopied(false), 1400);
  }

  return (
    <span className="chip">
      {prefix ? <span style={{ color: 'var(--faint)' }}>{prefix}</span> : null}
      <span title={value}>{label ?? shown}</span>
      <button onClick={onCopy} title="Copy">
        {copied ? '✓' : '⧉'}
      </button>
    </span>
  );
}
