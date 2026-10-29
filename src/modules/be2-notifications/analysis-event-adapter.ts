import type { AnalysisEvent } from '../be2-consultations/analysis-event.js';
import { normalizeAnalysisDomainType } from './event-mapping.js';
import type { DomainNotificationEvent } from './types.js';

/**
 * Adapts existing BE2 analysis.succeeded / analysis.failed receipts into
 * Phase 2 domain notification events. Does not claim analysis workflow ownership.
 */
export function analysisEventToNotificationEvent(
  receipt: AnalysisEvent,
): DomainNotificationEvent {
  return {
    event_id: receipt.event_id,
    event_type: normalizeAnalysisDomainType(receipt.type),
    occurred_at: receipt.occurred_at,
    person_id: receipt.person_id,
    resource_type: 'ANALYSIS',
    resource_id: receipt.analysis_id,
    event_version: 1,
    metadata: {
      consultation_id: receipt.consultation_id,
      record_version_id: receipt.record_version_id,
      analysis_outcome: receipt.type === 'analysis.succeeded' ? 'succeeded' : 'failed',
    },
  };
}
