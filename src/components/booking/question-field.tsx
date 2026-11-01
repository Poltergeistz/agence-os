"use client";

import type { Question } from "@/lib/booking/shared";

export function QuestionField({ q, value, onChange, onBlur }: { q: Question; value: string; onChange: (v: string) => void; onBlur?: () => void }) {
  const id = `bk-q-${q.key}`;
  const common = { id, required: q.required, value, onBlur };
  return (
    <div className="field">
      <label htmlFor={id}>
        {q.label}
        {q.required && <span className="req">*</span>}
      </label>
      {q.type === "textarea" ? (
        <textarea {...common} className="textarea" rows={4} onChange={(e) => onChange(e.target.value)} />
      ) : q.type === "select" ? (
        <select {...common} className="select" onChange={(e) => onChange(e.target.value)}>
          <option value="">Choisir…</option>
          {(q.options ?? []).map((o) => (
            <option key={o} value={o}>{o}</option>
          ))}
        </select>
      ) : (
        <input
          {...common}
          className="input"
          type={q.type === "phone" ? "tel" : "text"}
          inputMode={q.type === "url" ? "url" : undefined}
          autoComplete={q.type === "phone" ? "tel" : q.key === "company" ? "organization" : q.type === "url" ? "url" : undefined}
          placeholder={q.type === "url" ? "exemple.fr" : undefined}
          onChange={(e) => onChange(e.target.value)}
        />
      )}
    </div>
  );
}
