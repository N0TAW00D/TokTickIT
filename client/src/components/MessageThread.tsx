import { useEffect, useState, type FormEvent } from "react";
import { Button } from "./Button";
import { FormField } from "./FormField";
import { TextArea } from "./TextArea";
import { LoadingState } from "./LoadingState";
import { ErrorState } from "./ErrorState";
import { RoleBadge, type RoleValue } from "./RoleBadge";
import { formatDateTime } from "../tickets/formatDateTime";
import "./MessageThread.css";

export interface MessageThreadEntry {
  id: number;
  body: string;
  createdAt: string;
  author: { id: number; name: string; role: RoleValue };
}

export type MessageThreadVariant = "public" | "internal";

const BODY_MIN = 1;
const BODY_MAX = 2000;
const COUNTER_FROM = 1800;

interface VariantConfig {
  wrapperClass: string;
  heading: string;
  privacyBadge: string | null;
  placeholder: string;
  submitLabel: string;
  entryPrefix: string | null;
  /** ui-spec.md §13: only Internal Notes needs this — Public Comments has no non-visual privacy distinction to carry. */
  ariaLabel: string | undefined;
}

/** ui-spec.md §8's per-variant table — the only thing that differs between a Public Comments and an Internal Notes thread. */
const VARIANT_CONFIG: Record<MessageThreadVariant, VariantConfig> = {
  public: {
    wrapperClass: "thread--public",
    heading: "Comments",
    privacyBadge: null,
    placeholder: "Write a comment the requester can see…",
    submitLabel: "Post comment",
    entryPrefix: null,
    ariaLabel: undefined,
  },
  internal: {
    wrapperClass: "thread--internal",
    heading: "Internal notes",
    privacyBadge: "Private — not visible to the Requester",
    placeholder: "Write an internal note. The requester cannot see this.",
    submitLabel: "Save internal note",
    entryPrefix: "🔒",
    ariaLabel: "Internal notes, not visible to the requester",
  },
};

function validateBody(raw: string): string | undefined {
  const trimmed = raw.trim();
  if (trimmed.length < BODY_MIN) {
    return "Enter a message before posting.";
  }
  if (trimmed.length > BODY_MAX) {
    return `Message must be ${BODY_MAX} characters or fewer.`;
  }
  return undefined;
}

type ThreadState =
  | { phase: "loading" }
  | { phase: "loaded"; entries: MessageThreadEntry[] }
  | { phase: "error" };

export interface MessageThreadProps {
  /** Which thread this is (ui-spec.md §8) — drives every label/class below. */
  variant: MessageThreadVariant;
  /** Fetches the thread's entries, ordered `createdAt` ascending (oldest first). */
  fetchEntries: () => Promise<MessageThreadEntry[]>;
  /** Posts one new entry with the given already-trimmed body; resolves with the created entry. */
  postEntry: (body: string) => Promise<MessageThreadEntry>;
}

/**
 * Shared comment/note thread (ui-spec.md §8) — one component driven by
 * `variant`, the mechanism AC-42 asserts. Owns its own fetch-on-mount and
 * post-on-submit (the same self-contained pattern `AttachmentSection` uses
 * for uploads/removals), so the parent screen only supplies `ticketId`-bound
 * `fetchEntries`/`postEntry` functions — never Public-Comment- or
 * Internal-Note-specific API calls directly.
 *
 * Body is 1-2000 characters, a live counter appears from 1800, a
 * whitespace-only submission is blocked client-side (and would be rejected
 * server-side regardless), entries render newest-last (the order
 * `fetchEntries` returns, oldest first), and content always renders as
 * plain text — this file has no `dangerouslySetInnerHTML` (BR-18).
 */
export function MessageThread({ variant, fetchEntries, postEntry }: MessageThreadProps) {
  const config = VARIANT_CONFIG[variant];
  const [state, setState] = useState<ThreadState>({ phase: "loading" });
  const [value, setValue] = useState("");
  const [fieldError, setFieldError] = useState<string | undefined>();
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | undefined>();

  function load() {
    setState({ phase: "loading" });
    fetchEntries()
      .then((entries) => setState({ phase: "loaded", entries }))
      .catch(() => setState({ phase: "error" }));
  }

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(load, []);

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    const error = validateBody(value);
    if (error) {
      setFieldError(error);
      return;
    }
    setFieldError(undefined);
    setSubmitError(undefined);
    setSubmitting(true);

    postEntry(value.trim())
      .then((created) => {
        setState((current) =>
          current.phase === "loaded"
            ? { phase: "loaded", entries: [...current.entries, created] }
            : { phase: "loaded", entries: [created] },
        );
        setValue("");
      })
      .catch(() => {
        setSubmitError(
          "Could not post your message. Please check your connection and try again.",
        );
      })
      .finally(() => setSubmitting(false));
  }

  return (
    <section
      className={`zen-message-thread ${config.wrapperClass}`}
      aria-label={config.ariaLabel}
    >
      <div className="zen-message-thread__heading-row">
        <h2>{config.heading}</h2>
        {config.privacyBadge && (
          <span className="zen-message-thread__privacy-badge">
            {config.privacyBadge}
          </span>
        )}
      </div>

      {state.phase === "loading" && (
        <LoadingState label={`Loading ${config.heading.toLowerCase()}…`} />
      )}

      {state.phase === "error" && (
        <ErrorState
          message={`Could not load ${config.heading.toLowerCase()}. Please check your connection and try again.`}
          onRetry={load}
        />
      )}

      {state.phase === "loaded" && (
        <ul className="zen-message-thread__list">
          {state.entries.map((entry) => (
            <li key={entry.id} className="zen-message-thread__entry">
              <div className="zen-message-thread__entry-meta">
                {config.entryPrefix && (
                  <span aria-hidden="true">{config.entryPrefix}</span>
                )}
                <span className="zen-message-thread__author">{entry.author.name}</span>
                <RoleBadge value={entry.author.role} />
                <span className="zen-message-thread__timestamp">
                  {formatDateTime(entry.createdAt)}
                </span>
              </div>
              <p className="zen-message-thread__body">{entry.body}</p>
            </li>
          ))}
          {state.entries.length === 0 && (
            <li className="zen-message-thread__empty">
              No {config.heading.toLowerCase()} yet.
            </li>
          )}
        </ul>
      )}

      <form onSubmit={handleSubmit} noValidate className="zen-message-thread__composer">
        <FormField
          id={`message-thread-${variant}-body`}
          label={config.heading === "Comments" ? "Add a comment" : "Add an internal note"}
          error={fieldError}
          counter={value.length >= COUNTER_FROM ? { current: value.length, max: BODY_MAX } : undefined}
        >
          <TextArea
            placeholder={config.placeholder}
            value={value}
            disabled={submitting}
            onChange={(event) => setValue(event.target.value)}
          />
        </FormField>

        {submitError && (
          <div role="alert" className="zen-message-thread__submit-error">
            {submitError}
          </div>
        )}

        <div className="zen-message-thread__composer-actions">
          <Button type="submit" variant="primary" busy={submitting}>
            {config.submitLabel}
          </Button>
        </div>
      </form>
    </section>
  );
}
