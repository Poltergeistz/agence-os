"use client";

import { AlertCircle } from "lucide-react";

import { fieldsFor, type ContactField, type ContactMode } from "@/lib/booking/contact";
import type { Question } from "@/lib/booking/shared";
import { QuestionField } from "./question-field";

export interface ContactFormProps {
  mode: ContactMode;
  phoneRequired: boolean;
  values: Record<string, string>;
  setValue: (key: string, v: string) => void;
  questions: Question[];
  errors: Partial<Record<ContactField, string>>;
  formError: string | null;
  busy: boolean;
  hp: string;
  setHp: (v: string) => void;
  termsUrl: string;
  privacyUrl: string;
  onBlurField: () => void;
  onSubmit: () => void;
}

const LABEL: Record<ContactField, string> = { name: "Prénom et nom", email: "Email", phone: "Téléphone" };

function Consent({ termsUrl, privacyUrl }: { termsUrl: string; privacyUrl: string }) {
  const link = (href: string, label: string) => (
    <a href={href} target="_blank" rel="noreferrer" style={{ color: "var(--accent)" }}>{label}</a>
  );
  return (
    <p className="bk-legal">
      En saisissant vos informations, vous acceptez que vos données soient enregistrées
      {termsUrl && privacyUrl ? <> conformément à nos {link(termsUrl, "conditions")} et à la {link(privacyUrl, "politique de confidentialité")}</> : termsUrl ? <> conformément à nos {link(termsUrl, "conditions")}</> : privacyUrl ? <> conformément à notre {link(privacyUrl, "politique de confidentialité")}</> : null}.
    </p>
  );
}

export function ContactForm(p: ContactFormProps) {
  const field = (key: ContactField, required: boolean) => {
    const id = `bk-${key}`;
    const err = p.errors[key];
    return (
      <div className="field" key={key}>
        <label htmlFor={id}>
          {LABEL[key]}
          {required && <span className="req">*</span>}
        </label>
        {key === "phone" ? (
          <div className={`bk-phone${err ? " bad" : ""}`}>
            <span className="bk-cc"><i className="bk-flag" aria-hidden />+33</span>
            <input id={id} type="tel" inputMode="tel" autoComplete="tel-national" placeholder="6 12 34 56 78" aria-invalid={!!err} aria-describedby={err ? `${id}-e` : undefined} value={p.values.phone ?? ""} onChange={(e) => p.setValue("phone", e.target.value)} onBlur={p.onBlurField} />
          </div>
        ) : (
          <input
            id={id}
            className="input"
            type={key === "email" ? "email" : "text"}
            inputMode={key === "email" ? "email" : undefined}
            autoComplete={key === "email" ? "email" : "name"}
            aria-invalid={!!err}
            aria-describedby={err ? `${id}-e` : undefined}
            value={p.values[key] ?? ""}
            onChange={(e) => p.setValue(key, e.target.value)}
            onBlur={p.onBlurField}
          />
        )}
        {err && <span className="bk-ferr" id={`${id}-e`} role="alert">{err}</span>}
      </div>
    );
  };

  return (
    <form
      className="bk-cf"
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        p.onSubmit();
      }}
    >
      {p.formError && (
        <div className="bk-err" role="alert">
          <AlertCircle size={15} /> {p.formError}
        </div>
      )}
      {fieldsFor(p.mode).map((f) => field(f.key, f.required || (f.key === "phone" && p.phoneRequired)))}
      {p.questions.map((q) => (
        <QuestionField key={q.key} q={q} value={p.values[q.key] ?? ""} onChange={(v) => p.setValue(q.key, v)} onBlur={p.onBlurField} />
      ))}
      <div className="bk-hp" aria-hidden>
        <label>
          Ne pas remplir
          <input tabIndex={-1} autoComplete="off" value={p.hp} onChange={(e) => p.setHp(e.target.value)} />
        </label>
      </div>
      <button type="submit" className="btn btn-primary btn-lg btn-block" disabled={p.busy}>
        {p.busy ? "Enregistrement…" : "Continuer"}
      </button>
      <Consent termsUrl={p.termsUrl} privacyUrl={p.privacyUrl} />
    </form>
  );
}
