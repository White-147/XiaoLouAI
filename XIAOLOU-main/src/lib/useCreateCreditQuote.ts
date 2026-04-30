import { useEffect, useMemo, useState } from "react";
import {
  getCreateCreditQuote,
  type CreditQuote,
  type CreditQuoteRequestInput,
} from "./api";

type CreateCreditQuoteState = {
  quote: CreditQuote | null;
  isLoading: boolean;
  error: unknown | null;
};

function normalizePositiveNumber(value: number | undefined) {
  return Number.isFinite(value) && Number(value) > 0 ? Number(value) : undefined;
}

function normalizeQuoteInput(input?: CreditQuoteRequestInput): CreditQuoteRequestInput {
  return {
    projectId: input?.projectId || undefined,
    sourceText: input?.sourceText || undefined,
    text: input?.text || undefined,
    count: normalizePositiveNumber(input?.count),
    shotCount: normalizePositiveNumber(input?.shotCount),
    storyboardId: input?.storyboardId || undefined,
    model: input?.model || undefined,
    aspectRatio: input?.aspectRatio || undefined,
    resolution: input?.resolution || undefined,
  };
}

export function useCreateCreditQuote(
  actionCode: string | null | undefined,
  input?: CreditQuoteRequestInput,
  enabled = true,
): CreateCreditQuoteState {
  const request = useMemo(() => {
    if (!enabled || !actionCode) return null;
    return {
      actionCode,
      input: normalizeQuoteInput(input),
    };
  }, [
    enabled,
    actionCode,
    input?.projectId,
    input?.sourceText,
    input?.text,
    input?.count,
    input?.shotCount,
    input?.storyboardId,
    input?.model,
    input?.aspectRatio,
    input?.resolution,
  ]);

  const [state, setState] = useState<CreateCreditQuoteState>({
    quote: null,
    isLoading: false,
    error: null,
  });

  useEffect(() => {
    if (!request) {
      setState({ quote: null, isLoading: false, error: null });
      return;
    }

    let cancelled = false;
    setState({ quote: null, isLoading: true, error: null });

    getCreateCreditQuote(request.actionCode, request.input)
      .then((quote) => {
        if (!cancelled) {
          setState({ quote, isLoading: false, error: null });
        }
      })
      .catch((error) => {
        console.warn("[useCreateCreditQuote] Failed to load credit quote:", error);
        if (!cancelled) {
          setState({ quote: null, isLoading: false, error });
        }
      });

    return () => {
      cancelled = true;
    };
  }, [request]);

  return state;
}
