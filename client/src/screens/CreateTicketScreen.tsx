import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { AppShell } from "../shell/AppShell";
import { Button } from "../components/Button";
import { FormField } from "../components/FormField";
import { SelectField } from "../components/SelectField";
import { TextInput } from "../components/TextInput";
import { TextArea } from "../components/TextArea";
import { LoadingState } from "../components/LoadingState";
import { ErrorState } from "../components/ErrorState";
import { useRequester } from "../requester/RequesterContext";
import {
  fetchCategories,
  fetchRelatedSystems,
  type ReferenceOption,
  type RequestedPriority,
} from "../tickets/api";
import "./CreateTicketScreen.css";

const SUMMARY_MAX = 140;
const DESCRIPTION_MAX = 5000;

const PRIORITY_OPTIONS: { value: RequestedPriority; label: string }[] = [
  { value: "LOW", label: "Low" },
  { value: "MEDIUM", label: "Medium" },
  { value: "HIGH", label: "High" },
];

interface FormValues {
  categoryId: string;
  relatedSystemId: string;
  requestedPriority: RequestedPriority;
  summary: string;
  description: string;
}

const INITIAL_VALUES: FormValues = {
  categoryId: "",
  relatedSystemId: "",
  requestedPriority: "MEDIUM",
  summary: "",
  description: "",
};

type FieldName = keyof FormValues;

const FIELD_IDS: Record<FieldName, string> = {
  categoryId: "create-ticket-category",
  relatedSystemId: "create-ticket-related-system",
  requestedPriority: "create-ticket-priority",
  summary: "create-ticket-summary",
  description: "create-ticket-description",
};

type ReferenceState =
  | { phase: "loading" }
  | { phase: "loaded"; categories: ReferenceOption[]; relatedSystems: ReferenceOption[] }
  | { phase: "error"; message: string };

/**
 * Create Ticket screen (ui-spec.md §8, `/tickets/new`). This slice adds the
 * layout, the read-only "Ticket information" block, and the Classification
 * selects backed by live reference data (C-09). Client validation and
 * submit handling land in the next two slices; attachments are a
 * placeholder here — the real `AttachmentUploader` belongs to Issue #17.
 */
export function CreateTicketScreen() {
  const navigate = useNavigate();
  const { requesterName } = useRequester();

  const [referenceState, setReferenceState] = useState<ReferenceState>({
    phase: "loading",
  });
  const [values, setValues] = useState<FormValues>(INITIAL_VALUES);

  const loadReferenceData = useCallback(() => {
    setReferenceState({ phase: "loading" });
    Promise.all([fetchCategories(), fetchRelatedSystems()])
      .then(([categories, relatedSystems]) => {
        setReferenceState({ phase: "loaded", categories, relatedSystems });
      })
      .catch(() => {
        setReferenceState({
          phase: "error",
          message:
            "Could not load categories and related systems. Please check your connection and try again.",
        });
      });
  }, []);

  useEffect(() => {
    loadReferenceData();
  }, [loadReferenceData]);

  function setValue<K extends FieldName>(name: K, value: FormValues[K]) {
    setValues((current) => ({ ...current, [name]: value }));
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    // Client validation and the actual POST are added in later slices.
    event.preventDefault();
  }

  function handleCancel() {
    navigate("/tickets");
  }

  const referenceLoaded = referenceState.phase === "loaded";

  return (
    <AppShell>
      <nav aria-label="Breadcrumb" className="zen-create-ticket__breadcrumb">
        <Link to="/tickets">My Tickets</Link>
        <span aria-hidden="true"> &rsaquo; </span>
        <span>Create Ticket</span>
      </nav>

      <h1>Create Ticket</h1>

      <div className="zen-create-ticket__card">
        <form onSubmit={handleSubmit} noValidate>
          <section className="zen-create-ticket__section">
            <h2>Ticket information</h2>
            <div className="zen-create-ticket__row-2">
              <FormField id="create-ticket-number" label="Ticket No.">
                <TextInput readOnly value="Generated on submit" />
              </FormField>
              <FormField id="create-ticket-date" label="Ticket Date">
                <TextInput readOnly value="Set on submit" />
              </FormField>
            </div>
            <FormField id="create-ticket-requester" label="Requester">
              <TextInput readOnly value={requesterName ?? ""} />
            </FormField>
          </section>

          <section className="zen-create-ticket__section">
            <h2>Classification</h2>

            {referenceState.phase === "loading" && (
              <LoadingState label="Loading reference data…" />
            )}

            {referenceState.phase === "error" && (
              <ErrorState
                message={referenceState.message}
                onRetry={loadReferenceData}
              />
            )}

            {referenceState.phase === "loaded" && (
              <div className="zen-create-ticket__row-3">
                <SelectField
                  id={FIELD_IDS.categoryId}
                  label="Category"
                  required
                  placeholder="Select…"
                  value={values.categoryId}
                  onChange={(value) => setValue("categoryId", value)}
                  options={referenceState.categories.map((category) => ({
                    value: String(category.id),
                    label: category.name,
                  }))}
                />
                <SelectField
                  id={FIELD_IDS.relatedSystemId}
                  label="Related System"
                  required
                  placeholder="Select…"
                  value={values.relatedSystemId}
                  onChange={(value) => setValue("relatedSystemId", value)}
                  options={referenceState.relatedSystems.map((system) => ({
                    value: String(system.id),
                    label: system.name,
                  }))}
                />
                <SelectField
                  id={FIELD_IDS.requestedPriority}
                  label="Requested Priority"
                  required
                  value={values.requestedPriority}
                  onChange={(value) =>
                    setValue("requestedPriority", value as RequestedPriority)
                  }
                  options={PRIORITY_OPTIONS}
                />
              </div>
            )}
          </section>

          <section className="zen-create-ticket__section">
            <h2>Details</h2>
            <FormField
              id={FIELD_IDS.summary}
              label="Ticket Summary"
              required
              counter={{ current: values.summary.length, max: SUMMARY_MAX }}
            >
              <TextInput
                value={values.summary}
                onChange={(event) => setValue("summary", event.target.value)}
              />
            </FormField>
            <FormField
              id={FIELD_IDS.description}
              label="Description"
              required
              counter={{
                current: values.description.length,
                max: DESCRIPTION_MAX,
              }}
            >
              <TextArea
                value={values.description}
                onChange={(event) =>
                  setValue("description", event.target.value)
                }
              />
            </FormField>
          </section>

          <section className="zen-create-ticket__section">
            <h2>Attachments (0/5)</h2>
            <p className="zen-create-ticket__attachments-placeholder">
              Attachments are added after the ticket is created.
            </p>
          </section>

          <div className="zen-create-ticket__actions">
            <Button variant="secondary" type="button" onClick={handleCancel}>
              Cancel
            </Button>
            <Button variant="primary" type="submit" disabled={!referenceLoaded}>
              Submit ticket
            </Button>
          </div>
        </form>
      </div>
    </AppShell>
  );
}
