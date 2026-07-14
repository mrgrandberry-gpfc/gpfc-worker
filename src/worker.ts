// GPFC Automation Worker — 13 endpoints
// Grandberry Private Funding & Consulting

const WHOP_URL = "https://whop.com/grandberry-private-funding";
const PAYHIP_URL = "https://payhip.com/grandberryprivatefundingconsulting";
const CONTACT_EMAIL = "grandberryprivatefunding@gmail.com";
const BOOKING_APPS = ["Google Calendar", "Calendly", "Zoom"];

const FINANCIAL_DISCLAIMER =
  "DISCLAIMER: The information provided is for educational purposes only and does not constitute financial, legal, or investment advice. Results may vary. Grandberry Private Funding & Consulting, LLC is not a licensed financial advisor. Always consult a qualified professional before making financial decisions.";

const COMPLIANCE_KEYWORDS = [
  "guaranteed",
  "guarantee",
  "risk-free",
  "risk free",
  "100% success",
  "no risk",
  "certain returns",
  "definitely will",
  "always works",
  "never fails",
];

type ContentFormat =
  | "linkedin_post"
  | "facebook_post"
  | "instagram_caption"
  | "tiktok_script"
  | "youtube_script"
  | "youtube_short"
  | "email_newsletter"
  | "twitter_thread"
  | "carousel_caption";

type Platform =
  | "linkedin"
  | "facebook"
  | "instagram"
  | "tiktok"
  | "youtube"
  | "email"
  | "twitter";

interface ContentItem {
  id: string;
  topic: string;
  content_format: ContentFormat;
  platforms: Platform[];
  is_financial: boolean;
  brain_version: string;
  prompt: string;
  draft_text: string;
  media_urls: string[];
  compliance_status: string;
  compliance_reasons: string[];
  approval_status: string;
  reviewer_notes: string;
  publish_status: string;
  source_attribution: string;
  status: string;
  crm_logged: boolean;
  created_at: string;
  updated_at: string;
}

const MEDIA_REQUIRED_FORMATS: ContentFormat[] = [
  "tiktok_script",
  "youtube_script",
  "youtube_short",
  "instagram_caption",
  "carousel_caption",
];

const BUFFER_PLATFORMS: Platform[] = ["linkedin", "facebook", "twitter"];

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Content-Type": "application/json",
  };
}

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: corsHeaders(),
  });
}

function buildGroundingPrompt(
  item: ContentItem,
  brainContent: string,
  ctaLink: string
): string {
  const platformList = item.platforms.join(", ");
  const disclaimerNote = item.is_financial
    ? `\n\nIMPORTANT: This is financial content. You MUST include this disclaimer at the end:\n${FINANCIAL_DISCLAIMER}`
    : "";

  return `You are the content writer for Grandberry Private Funding & Consulting (GPFC).

BRAND BRAIN:
${brainContent}

TASK: Write a ${item.content_format} about: "${item.topic}"
TARGET PLATFORMS: ${platformList}
CTA LINK: ${ctaLink}
${disclaimerNote}

REQUIREMENTS:
- Match the voice, tone, and style defined in the Brand Brain above
- Write for the specified format and platforms
- Include a clear call to action pointing to: ${ctaLink}
- Keep it authentic, educational, and conversion-focused
- Do NOT use generic AI language or filler phrases

OUTPUT: Return only the finished content, ready to publish. No preamble, no notes.`;
}

// ── SCENARIO 1: Ingest & Ground ──────────────────────────────────────────────
async function handleGround(item: ContentItem, commitSha: string, ctaLink: string, brainContent?: string, brainUrl?: string): Promise<Response> {
  // If brainContent not passed directly, fetch from brainUrl
  let brain = brainContent || "";
  if ((!brain || brain.trim().length < 50) && brainUrl) {
    try {
      const res = await fetch(brainUrl);
      if (res.ok) brain = await res.text();
    } catch {
      brain = "";
    }
  }

  if (!brain || brain.trim().length < 50) {
    return json({
      item: { ...item, status: "blocked_brain_unavailable" },
      grounded: false,
      notifyOperator: true,
      notification: `BRAIN.md unavailable or too short for item: ${item.topic}. Check brainUrl in Scenario 1.`,
    });
  }

  const prompt = buildGroundingPrompt(item, brain, ctaLink || WHOP_URL);

  return json({
    item: {
      ...item,
      status: "prompt_ready",
      prompt,
      brain_version: commitSha || "main",
    },
    grounded: true,
    notifyOperator: false,
  });
}

// ── SCENARIO 2: Draft Content ────────────────────────────────────────────────
function handleDraft(item: ContentItem, draftText: string, source: string) {
  if (!draftText || draftText.trim().length < 100) {
    return json({
      item: { ...item },
      drafted: false,
      notifyOperator: true,
      notification: `Empty or too-short draft returned for: ${item.topic}. Check Anthropic API key in Scenario 2.`,
    });
  }

  return json({
    item: {
      ...item,
      status: "drafted",
      draft_text: draftText.trim(),
    },
    drafted: true,
    chainToCompliance: true,
    notifyOperator: false,
    source,
  });
}

// ── SCENARIO 3: Compliance Gate ──────────────────────────────────────────────
function handleCompliance(item: ContentItem, mediaRequired?: boolean) {
  const reasons: string[] = [];
  let draft = item.draft_text || "";

  // Bind disclaimer for financial content
  if (item.is_financial && !draft.includes("educational purposes only")) {
    draft = `${draft}\n\n${FINANCIAL_DISCLAIMER}`;
  }

  // Check for compliance violations
  const lowerDraft = draft.toLowerCase();
  for (const kw of COMPLIANCE_KEYWORDS) {
    if (lowerDraft.includes(kw)) {
      reasons.push(`Contains prohibited phrase: "${kw}"`);
    }
  }

  // Check CTA present
  if (!lowerDraft.includes("whop.com") && !lowerDraft.includes("payhip.com") && !lowerDraft.includes("grandberry")) {
    reasons.push("Missing GPFC call-to-action or brand reference");
  }

  const compliant = reasons.length === 0;
  const needsMedia =
    mediaRequired !== undefined
      ? mediaRequired
      : MEDIA_REQUIRED_FORMATS.includes(item.content_format);

  const nextStatus = compliant
    ? needsMedia
      ? "awaiting_media"
      : "awaiting_approval"
    : "compliance_failed";

  return json({
    item: {
      ...item,
      draft_text: draft,
      status: nextStatus,
      compliance_status: compliant ? "passed" : "failed",
      compliance_reasons: reasons,
    },
    compliant,
    mediaRequired: needsMedia,
    notifyOperator: !compliant,
    notification: !compliant
      ? `Compliance failed for: ${item.topic}\nReasons: ${reasons.join("; ")}`
      : null,
  });
}

// ── SCENARIO 4: Media Handoff ────────────────────────────────────────────────
function handleMediaTask(item: ContentItem) {
  const mediaMap: Record<ContentFormat, string> = {
    tiktok_script: "M-1: HeyGen AI Avatar Video (vertical 9:16, 30-60s)",
    youtube_script: "M-1: HeyGen AI Avatar Video (horizontal 16:9, 8-12min) + M-3: Higgsfield b-roll",
    youtube_short: "M-1: HeyGen AI Avatar Video (vertical 9:16, 60s max)",
    instagram_caption: "M-2: Gemini image generation (1080x1080) OR M-3: Higgsfield motion graphic",
    carousel_caption: "M-2: Gemini image generation x3-5 slides (1080x1080)",
    linkedin_post: "Optional: M-2 image (1200x627)",
    facebook_post: "Optional: M-2 image (1200x630)",
    twitter_thread: "Optional: M-2 image (1200x675)",
    email_newsletter: "Optional: M-2 header image (600x200)",
  };

  const requiredMedia = mediaMap[item.content_format] || "M-2: Generate supporting image";

  return json({
    itemId: item.id,
    title: `🎬 MEDIA TASK — ${item.content_format.toUpperCase()}: ${item.topic}`,
    requiredMedia,
    approvedScript: item.draft_text,
    resumeInstruction: `After creating media, POST to the S4 resume webhook:\n{"item_id": "${item.id}", "media_urls": ["https://your-url-here.com/media.mp4"]}`,
  });
}

function handleAttachMedia(item: ContentItem, mediaUrls: string[]) {
  const validUrls = (mediaUrls || []).filter(
    (u) => typeof u === "string" && u.startsWith("http")
  );

  if (validUrls.length === 0) {
    return json({
      item,
      advanced: false,
      notifyOperator: true,
      notification: `No valid media URLs submitted for: ${item.topic}. URLs must start with https://`,
    });
  }

  return json({
    item: {
      ...item,
      status: "awaiting_approval",
      media_urls: validUrls,
    },
    advanced: true,
    notifyOperator: false,
  });
}

// ── SCENARIO 5: Approval Gate ────────────────────────────────────────────────
function handleApprovalRequest(item: ContentItem) {
  const checklist = [
    "1. Voice & tone matches GPFC brand",
    "2. Financial disclaimer present (if financial content)",
    "3. CTA is clear and links to correct destination",
    "4. No guaranteed results or misleading claims",
    "5. Media assets are on-brand (if applicable)",
  ];

  return json({
    id: item.id,
    topic: item.topic,
    draft_text: item.draft_text,
    media_urls: item.media_urls,
    checklist: checklist.join("\n"),
  });
}

function handleApprovalResume(item: ContentItem, decision: string, notes: string) {
  if (!["approved", "rejected"].includes(decision)) {
    return json({ error: "decision must be 'approved' or 'rejected'" }, 400);
  }

  const nextStatus = decision === "approved" ? "approved" : "returned_for_revision";

  return json({
    item: {
      ...item,
      status: nextStatus,
      approval_status: decision,
      reviewer_notes: notes || "",
    },
    decision,
    publishEligible: decision === "approved",
  });
}

// ── SCENARIO 6: Schedule & Publish ──────────────────────────────────────────
function handleSchedule(item: ContentItem, bufferChannelLimit = 3, validateCta = true) {
  // Guard: must be approved
  if (item.compliance_status !== "passed") {
    return json({
      item,
      scheduled: false,
      blocked: true,
      reason: `Cannot schedule: compliance_status is "${item.compliance_status}", must be "passed"`,
      plan: null,
    });
  }

  if (item.approval_status !== "approved") {
    return json({
      item,
      scheduled: false,
      blocked: true,
      reason: `Cannot schedule: approval_status is "${item.approval_status}", must be "approved"`,
      plan: null,
    });
  }

  // CTA validation
  if (validateCta) {
    const draft = item.draft_text.toLowerCase();
    if (!draft.includes("whop.com") && !draft.includes("payhip.com") && !draft.includes("grandberry")) {
      return json({
        item,
        scheduled: false,
        blocked: true,
        reason: "CTA validation failed: draft must reference whop.com, payhip.com, or grandberry",
        plan: null,
      });
    }
  }

  // Build publish plan
  const platforms = item.platforms || [];
  const bufferTargets = platforms
    .filter((p) => BUFFER_PLATFORMS.includes(p))
    .slice(0, bufferChannelLimit);

  const socialPostTargets = platforms.filter(
    (p) => !BUFFER_PLATFORMS.includes(p) && p !== "youtube" && p !== "tiktok" && p !== "email"
  );

  const manualPlatformTargets = platforms.filter(
    (p) => p === "youtube" || p === "tiktok" || p === "email"
  );

  return json({
    item: {
      ...item,
      status: "scheduled",
      publish_status: "scheduled",
    },
    scheduled: true,
    blocked: false,
    plan: {
      bufferTargets,
      socialPostTargets,
      manualPlatformTargets,
      totalPlatforms: platforms.length,
    },
  });
}

function handleConfirmPublished(item: ContentItem) {
  return json({
    item: {
      ...item,
      status: "published",
      publish_status: "published",
    },
    published: true,
  });
}

// ── SCENARIO 7: CRM & Booking ────────────────────────────────────────────────
function handlePublishEvent(item: ContentItem, occurredAt: string) {
  return json({
    eventType: "content_published",
    contentId: item.id,
    sourceAttribution: item.source_attribution,
    occurredAt: occurredAt || new Date().toISOString(),
    crm: {
      content_format: item.content_format,
      topic: item.topic,
      platforms: item.platforms,
      compliance_status: item.compliance_status,
      approval_status: item.approval_status,
    },
    note: `GPFC Content Published\nID: ${item.id}\nTopic: ${item.topic}\nFormat: ${item.content_format}\nPlatforms: ${(item.platforms || []).join(", ")}\nPublished: ${occurredAt || new Date().toISOString()}\nSource: ${item.source_attribution}`,
  });
}

function handleBooking(webhook: Record<string, unknown>) {
  const bookingApp = webhook.bookingApp as string;
  const contactEmail = webhook.contactEmail as string;
  const contactName = webhook.contactName as string;
  const scheduledTime = webhook.scheduledTime as string;
  const eventName = (webhook.eventName as string) || "GPFC Consultation";
  const meetingUrl = (webhook.meetingUrl as string) || "";

  if (!BOOKING_APPS.includes(bookingApp)) {
    return json({
      valid: false,
      reason: `Unknown booking app: "${bookingApp}". Must be one of: ${BOOKING_APPS.join(", ")}`,
    });
  }

  if (!contactEmail || !contactEmail.includes("@")) {
    return json({
      valid: false,
      reason: `Invalid or missing contactEmail: "${contactEmail}"`,
    });
  }

  return json({
    valid: true,
    payload: {
      bookingApp,
      contact: { email: contactEmail, name: contactName || "" },
      scheduledTime: scheduledTime || new Date().toISOString(),
      eventName,
      meetingUrl,
      sourceAttribution: `booking_${bookingApp.toLowerCase().replace(" ", "_")}`,
      note: `New Booking via ${bookingApp}\nName: ${contactName || "Unknown"}\nEmail: ${contactEmail}\nEvent: ${eventName}\nTime: ${scheduledTime}\nMeeting URL: ${meetingUrl || "N/A"}`,
    },
  });
}

// ── Base44 Callback ──────────────────────────────────────────────────────────
function handleBase44Callback(item: ContentItem, callback: { decision: string; notes?: string }) {
  return handleApprovalResume(item, callback.decision, callback.notes || "");
}

// ── Helpers ──────────────────────────────────────────────────────────────────
function normalizeItem(raw: Record<string, unknown>): ContentItem {
  return {
    id: String(raw.id ?? ""),
    topic: String(raw.topic ?? ""),
    content_format: String(raw.content_format ?? "linkedin_post") as ContentFormat,
    platforms: Array.isArray(raw.platforms) ? raw.platforms as Platform[] : [],
    is_financial: raw.is_financial === true || raw.is_financial === "true" || raw.is_financial === "1",
    brain_version: String(raw.brain_version ?? ""),
    prompt: String(raw.prompt ?? ""),
    draft_text: String(raw.draft_text ?? ""),
    media_urls: Array.isArray(raw.media_urls) ? raw.media_urls as string[] : [],
    compliance_status: String(raw.compliance_status ?? "pending"),
    compliance_reasons: Array.isArray(raw.compliance_reasons) ? raw.compliance_reasons as string[] : [],
    approval_status: String(raw.approval_status ?? "pending"),
    reviewer_notes: String(raw.reviewer_notes ?? ""),
    publish_status: String(raw.publish_status ?? "unpublished"),
    source_attribution: String(raw.source_attribution ?? ""),
    status: String(raw.status ?? "topic_ready"),
    crm_logged: raw.crm_logged === true || raw.crm_logged === "true" || raw.crm_logged === "1",
    created_at: String(raw.created_at ?? new Date().toISOString()),
    updated_at: String(raw.updated_at ?? new Date().toISOString()),
  };
}

// ── Router ───────────────────────────────────────────────────────────────────
export default {
  async fetch(request: Request): Promise<Response> {
    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders() });
    }

    const url = new URL(request.url);
    const path = url.pathname;

    if (path === "/health" && request.method === "GET") {
      return json({ status: "ok", worker: "gpfc-automation", ts: new Date().toISOString() });
    }

    if (request.method !== "POST") {
      return json({ error: "Method not allowed" }, 405);
    }

    let body: Record<string, unknown>;
    try {
      body = await request.json();
    } catch {
      return json({ error: "Invalid JSON body" }, 400);
    }

    try {
      switch (path) {
        case "/scenario/1/ground":
          return await handleGround(
            normalizeItem(body.item as Record<string, unknown>),
            body.commitSha as string,
            body.ctaLink as string,
            body.brainContent as string | undefined,
            body.brainUrl as string | undefined
          );

        case "/scenario/2/draft":
          return handleDraft(
            normalizeItem(body.item as Record<string, unknown>),
            body.draftText as string,
            body.source as string
          );

        case "/scenario/3/compliance":
          return handleCompliance(
            normalizeItem(body.item as Record<string, unknown>),
            body.mediaRequired as boolean | undefined
          );

        case "/scenario/4/media-task":
          return handleMediaTask(normalizeItem(body.item as Record<string, unknown>));

        case "/scenario/4/attach-media":
          return handleAttachMedia(
            normalizeItem(body.item as Record<string, unknown>),
            body.mediaUrls as string[]
          );

        case "/scenario/5/approval-request":
          return handleApprovalRequest(normalizeItem(body.item as Record<string, unknown>));

        case "/scenario/5/resume":
          return handleApprovalResume(
            normalizeItem(body.item as Record<string, unknown>),
            body.decision as string,
            body.notes as string
          );

        case "/scenario/6/schedule":
          return handleSchedule(
            normalizeItem(body.item as Record<string, unknown>),
            body.bufferChannelLimit as number,
            body.validateCta as boolean
          );

        case "/scenario/6/confirm":
          return handleConfirmPublished(normalizeItem(body.item as Record<string, unknown>));

        case "/scenario/7/publish-event":
          return handlePublishEvent(
            normalizeItem(body.item as Record<string, unknown>),
            body.occurredAt as string
          );

        case "/scenario/7/booking":
          return handleBooking(body.webhook as Record<string, unknown>);

        case "/base44/callback":
          return handleBase44Callback(
            normalizeItem(body.item as Record<string, unknown>),
            body.callback as { decision: string; notes?: string }
          );

        default:
          return json({ error: `Unknown endpoint: ${path}` }, 404);
      }
    } catch (err) {
      return json({ error: String(err) }, 500);
    }
  },
};
