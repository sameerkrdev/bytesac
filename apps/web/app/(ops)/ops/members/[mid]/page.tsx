import { MemberReview } from "@/components/ops/member-review";

export default async function OpsMemberPage({ params }: { params: Promise<{ mid: string }> }) {
  return <MemberReview mid={(await params).mid} />;
}
