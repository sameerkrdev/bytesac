import { BASKET_SECTION_LABEL } from "@repo/app-core";
import type { BasketReviewView, BasketSection } from "@repo/validator";

/** The latest reviewer feedback on a version: the message overall, or the comments left on one `section`. Internal notes never reach here. */
export function ReviewFeedback({ reviews, versionId, section }: { reviews: BasketReviewView[]; versionId: string; section?: BasketSection }) {
  const latest = reviews.filter((r) => r.versionId === versionId).sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
  if (!latest) return null;
  const comments = latest.sectionComments.filter((c) => (section ? c.section === section : true));
  const message = section ? null : latest.messageToManager;
  if (!message && comments.length === 0) return null;
  return (
    <div role="status" className="space-y-2 rounded-xl border border-warning/40 bg-warning/5 p-4 text-sm text-ivory">
      <p className="font-medium text-warning">{section ? `Reviewer comments on ${BASKET_SECTION_LABEL[section]}` : "Message from the reviewer"}</p>
      {message && <p className="whitespace-pre-wrap">{message}</p>}
      {!section && comments.length > 0 && <p className="text-xs text-stone">Comments on individual sections appear beside them.</p>}
      {section && comments.map((c, i) => <p key={i} className="whitespace-pre-wrap">{c.comment}</p>)}
    </div>
  );
}
