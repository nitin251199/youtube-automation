import type { Job } from '@/lib/api';

const TITLES: Record<string, string> = {
  flow_sign_in: 'Sign in to Google Flow',
  flow_verification: 'Google Flow needs verification',
  flow_queue: 'Flow is busy',
  ai_studio_sign_in: 'Sign in to Google AI Studio',
  ai_studio_run: 'Click Run in Google AI Studio',
};

export function AttentionBanner({ attention }: { attention: NonNullable<Job['needsAttention']> }) {
  return (
    <div className="attention" role="alert">
      <span className="attention-pulse" aria-hidden />
      <div>
        <strong>{TITLES[attention.type] ?? 'Your action is needed'}</strong>
        <p>{attention.message}</p>
        <small>Switch to the Chrome window that the automation opened on this computer.</small>
      </div>
    </div>
  );
}
