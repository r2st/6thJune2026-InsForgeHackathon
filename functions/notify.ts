// functions/notify.ts
// Notifications & integrations — route a shipped run to the right humans/channels.
//
// Ticket:  agents/tasks/0063-notifications-integrations.md
// Defends: a fix PR no one sees is a fix that doesn't ship. The whole value prop
//          ("before the user finishes the support ticket") depends on the team
//          being notified the moment Hush acts — in the tool they already use, with
//          enough context to act in one click.
//
// Pure, testable core: build the tier-aware MESSAGE (pr = "review this fix",
// draft_pr = "needs a human", issue = "we found something we can't auto-fix"),
// ROUTE it to the channels per the workspace's tier→channel rules, and decide
// whether to deliver now or fold into a DIGEST for a noisy workspace. Delivery is
// best-effort + retried and never affects the run outcome. The Slack/email/webhook
// transports + routing UI are the integration seam.

export type DispatchTier = 'pr' | 'draft_pr' | 'issue';
export type Channel = 'slack' | 'email' | 'webhook';

/** The run facts a notification renders. Counts/links only — no raw rows. */
export interface RunNotice {
  runId: string;
  tier: DispatchTier;
  summary: string;          // the diagnosis summary, ≤200 chars
  confidence: number;       // 0..100
  vetoReason?: string;      // when a single weak signal limited the tier
  verdict: { prodRows: number; forkRows: number };
  runUrl: string;
  outputUrl?: string;       // the PR or issue URL
}

export interface NotificationMessage {
  /** Short headline — the actionable verb for this tier. */
  headline: string;
  body: string;
  /** Primary call-to-action link. */
  ctaUrl: string;
  ctaLabel: string;
}

/**
 * Build a tier-aware, actionable message. Each tier gets a DISTINCT call to action
 * so the reader knows what's expected: review a confident fix, look at a draft, or
 * triage something Hush couldn't safely auto-fix.
 */
export function buildMessage(notice: RunNotice): NotificationMessage {
  const conf = `confidence ${notice.confidence}${notice.vetoReason ? ` (limited by ${notice.vetoReason})` : ''}`;
  const verdict = `prod ${notice.verdict.prodRows} rows → fork ${notice.verdict.forkRows} rows`;
  const body = `${notice.summary}\n${conf} · ${verdict}`;
  const cta = notice.outputUrl ?? notice.runUrl;
  switch (notice.tier) {
    case 'pr':
      return { headline: 'Hush opened a fix PR — review this fix', body, ctaUrl: cta, ctaLabel: 'Review PR' };
    case 'draft_pr':
      return { headline: 'Hush drafted a fix — needs a human', body, ctaUrl: cta, ctaLabel: 'Open draft PR' };
    case 'issue':
      return { headline: "Hush found something it can't auto-fix", body, ctaUrl: cta, ctaLabel: 'View issue' };
  }
}

// ── routing ────────────────────────────────────────────────────────────────────────

/** Per-workspace rule: a tier routes to a set of channels. */
export interface RoutingRule {
  tier: DispatchTier;
  channels: Channel[];
}

/**
 * Resolve which channels a run's tier should notify, from the workspace's rules.
 * Deduped; empty when no rule matches (the workspace chose not to be notified for
 * this tier — silence is a valid configuration, not an error).
 */
export function routeChannels(tier: DispatchTier, rules: RoutingRule[]): Channel[] {
  const match = rules.find((r) => r.tier === tier);
  return match ? [...new Set(match.channels)] : [];
}

// ── digest vs immediate ─────────────────────────────────────────────────────────────

export type DeliveryMode = 'immediate' | 'digest';

export interface DigestPolicy {
  /** When the workspace opted into digest mode for routine tiers. */
  digestEnabled: boolean;
  /** Tiers that always go out immediately regardless of digest (e.g. 'pr'). */
  alwaysImmediate: DispatchTier[];
}

export const DEFAULT_DIGEST_POLICY: DigestPolicy = {
  digestEnabled: false,
  alwaysImmediate: ['pr'],
};

/**
 * Decide immediate vs digest. A confident `pr` (or any `alwaysImmediate` tier)
 * always goes out now — that's the "before the support ticket" promise. With
 * digest mode on, the routine tiers roll up so a noisy workspace gets a summary,
 * not a firehose (complements the confidence-tier "don't spam the queue" thesis).
 */
export function deliveryMode(tier: DispatchTier, policy: DigestPolicy = DEFAULT_DIGEST_POLICY): DeliveryMode {
  if (!policy.digestEnabled) return 'immediate';
  if (policy.alwaysImmediate.includes(tier)) return 'immediate';
  return 'digest';
}

// ── delivery planning (best-effort, retried, never affects the run) ──────────────────

export interface DeliveryTask {
  channel: Channel;
  mode: DeliveryMode;
  message: NotificationMessage;
}

export interface DeliveryPlan {
  runId: string;
  tasks: DeliveryTask[];
  /** True when no channel is configured for this tier — nothing to send, not a failure. */
  silent: boolean;
}

/**
 * Build the full delivery plan for a run: the message, the channels, and the mode
 * per channel. Pure — the caller dispatches each task best-effort with retry
 * (reliability.retryDecision) and MUST NOT let a delivery failure change the run's
 * outcome. An empty plan is silence-by-config, surfaced honestly as `silent`.
 */
export function planDelivery(notice: RunNotice, rules: RoutingRule[], policy: DigestPolicy = DEFAULT_DIGEST_POLICY): DeliveryPlan {
  const channels = routeChannels(notice.tier, rules);
  const message = buildMessage(notice);
  const mode = deliveryMode(notice.tier, policy);
  return {
    runId: notice.runId,
    tasks: channels.map((channel) => ({ channel, mode, message })),
    silent: channels.length === 0,
  };
}
