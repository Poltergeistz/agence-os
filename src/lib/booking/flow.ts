// Étapes de la page publique de réservation.
// Pur (aucun import) : testé avec node --experimental-strip-types --test src/lib/booking/tests/

export type Step = "info" | "pick" | "form" | "submitting" | "done";
export type FlowEvent = "INFO_SUBMITTED" | "SLOT_CHOSEN" | "EDIT_INFO" | "SUBMIT" | "BACK_TO_PICK" | "BOOKED" | "SLOT_TAKEN" | "FAILED";
export interface FlowConfig {
  contactFirst: boolean;
  reschedule: boolean;
}

const infoFirst = (cfg: FlowConfig) => cfg.contactFirst && !cfg.reschedule;

export const initialStep = (cfg: FlowConfig): Step => (infoFirst(cfg) ? "info" : "pick");

export function nextStep(step: Step, event: FlowEvent, cfg: FlowConfig): Step {
  switch (step) {
    case "info":
      return event === "INFO_SUBMITTED" ? "pick" : step;
    case "pick":
      if (event === "SLOT_CHOSEN") return infoFirst(cfg) ? "submitting" : "form";
      if (event === "EDIT_INFO" && infoFirst(cfg)) return "info";
      return step;
    case "form":
      if (event === "SUBMIT") return "submitting";
      if (event === "BACK_TO_PICK") return "pick";
      return step;
    case "submitting":
      if (event === "BOOKED") return "done";
      if (event === "SLOT_TAKEN") return "pick";
      if (event === "FAILED") return infoFirst(cfg) ? "pick" : "form";
      return step;
    default:
      return step;
  }
}

export const calendarLocked = (step: Step, cfg: FlowConfig) => infoFirst(cfg) && step === "info";

export function stepIndex(step: Step, cfg: FlowConfig): 1 | 2 | null {
  if (!infoFirst(cfg)) return null;
  if (step === "info") return 1;
  return step === "pick" || step === "submitting" ? 2 : null;
}
